const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 3030);

// This app lives on Desktop next to gabeztaylor.github.io
const STUDYING_MD_PATH = path.resolve(
  __dirname,
  "../gabeztaylor.github.io/docs/Studying.md",
);

const ASSETS_DIR = path.resolve(__dirname, "../gabeztaylor.github.io/assets/study-journal");

function send(res, status, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": buf.length,
    ...headers,
  });
  res.end(buf);
}

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj, null, 2));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
  });
  res.end(body);
}

function safePublicPath(urlPath) {
  const publicDir = path.resolve(__dirname, "public");
  const decoded = decodeURIComponent(urlPath);
  const rel = decoded === "/" ? "/index.html" : decoded;
  const full = path.resolve(publicDir, "." + rel);
  if (!full.startsWith(publicDir + path.sep) && full !== publicDir) return null;
  return full;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toMDDate(dateISO) {
  // dateISO: YYYY-MM-DD
  const [y, m, d] = dateISO.split("-").map((x) => Number(x));
  const yy = String(y).slice(-2);
  return `${m}/${d}/${yy}`;
}

function mdDateToKey(mdDate) {
  // mdDate: M/D/YY
  const m = mdDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const yy = Number(m[3]);
  const year = 2000 + yy;
  return `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

function formatTime12h(date) {
  let h = date.getHours();
  const min = date.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  const mm = String(min).padStart(2, "0");
  return `${h}:${mm} ${ampm}`;
}

function parseLocalDateTime(dateISO, timeHHMM) {
  // Local time (not UTC)
  const [y, m, d] = dateISO.split("-").map((x) => Number(x));
  const [hh, mm] = timeHHMM.split(":").map((x) => Number(x));
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

function computeStartEnd({ dateISO, startTimeHHMM, endTimeHHMM, durationMinutes }) {
  const end = parseLocalDateTime(dateISO, endTimeHHMM);
  if (startTimeHHMM) {
    const start = parseLocalDateTime(dateISO, startTimeHHMM);
    if (!(end > start)) {
      const err = new Error("endTime must be after startTime");
      err.status = 400;
      throw err;
    }
    const computedMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000));
    return { start, end, durationMinutes: computedMinutes };
  }

  const start = new Date(end.getTime() - durationMinutes * 60_000);
  return { start, end, durationMinutes };
}

function buildEntryBlock({ start, end, description, tags, sources, notes, screenshots }) {
  const desc = String(description || "").trim().replace(/\s+/g, " ");
  const entryLine = `- **${formatTime12h(start)} – ${formatTime12h(end)}**: ${desc}`;

  const tagLines = (Array.isArray(tags) ? tags : [])
    .map((t) => String(t).trim())
    .filter(Boolean);

  const srcLines = (Array.isArray(sources) ? sources : [])
    .map((s) => String(s).trim())
    .filter(Boolean);

  const noteLines = (Array.isArray(notes) ? notes : [])
    .map((s) => String(s).trim())
    .filter(Boolean);

  const shotLines = (Array.isArray(screenshots) ? screenshots : [])
    .map((u) => String(u).trim())
    .filter(Boolean);

  const blocks = [entryLine];

  if (tagLines.length > 0) {
    blocks.push(`  - **Tags**\n${tagLines.map((t) => `    - #${t.replace(/^#/, "")}`).join("\n")}`);
  }
  if (srcLines.length > 0) {
    blocks.push(`  - **Sources**\n${srcLines.map((s) => `    - ${s}`).join("\n")}`);
  }
  if (noteLines.length > 0) {
    blocks.push(`  - **Notes**\n${noteLines.map((n) => `    - ${n}`).join("\n")}`);
  }
  if (shotLines.length > 0) {
    blocks.push(`  - **Screenshots**\n${shotLines.map((u) => `    - ![](${u})`).join("\n")}`);
  }

  return blocks.join("\n") + "\n";
}

function splitFrontmatter(md) {
  // If present, return { frontmatter, rest }. Otherwise, { frontmatter: "", rest: md }.
  const m = md.match(/^---\n[\s\S]*?\n---\n/);
  if (!m) return { frontmatter: "", rest: md };
  return { frontmatter: m[0], rest: md.slice(m[0].length) };
}

function parseDateSections(content) {
  // Returns { preamble, sections: [{mdDate, key, body}] }
  const re = /^###\s+(\d{1,2}\/\d{1,2}\/\d{2})\s*$/gm;
  const sections = [];
  let preamble = "";
  let lastBodyStart = 0;
  let lastSection = null;

  while (true) {
    const match = re.exec(content);
    if (!match) break;

    if (!lastSection) {
      preamble = content.slice(0, match.index);
    } else {
      lastSection.body = content.slice(lastBodyStart, match.index);
    }

    const mdDate = match[1].replace(/\s+/g, "");
    const key = mdDateToKey(mdDate);
    lastSection = { mdDate, key, body: "" };
    sections.push(lastSection);
    lastBodyStart = re.lastIndex;
  }

  if (lastSection) {
    lastSection.body = content.slice(lastBodyStart);
  } else {
    preamble = content;
  }

  for (const s of sections) {
    s.body = s.body.replace(/^\s*\n+/, "").replace(/\n+$/, "\n");
  }

  return { preamble, sections };
}

function rebuildStudyingMd({ frontmatter, preamble, sections }) {
  const parts = [];
  if (frontmatter) parts.push(frontmatter.trimEnd() + "\n");
  parts.push((preamble || "").trimEnd());

  const sorted = [...sections].sort((a, b) => {
    // Newest (larger key) first; null keys go last
    if (!a.key && !b.key) return 0;
    if (!a.key) return 1;
    if (!b.key) return -1;
    return b.key.localeCompare(a.key);
  });

  // Ensure exactly one blank line before first heading
  let out = parts.join("");
  out = ensureAtLeastNewlines(out, 2);

  for (const s of sorted) {
    out += `### ${s.mdDate}\n\n`;
    const body = (s.body || "").trimEnd();
    if (body) out += body + "\n\n";
    else out += "\n";
  }

  return out.replace(/\n{3,}$/g, "\n\n");
}

function ensureAtLeastNewlines(s, n) {
  let out = s;
  const want = "\n".repeat(n);
  if (out.endsWith(want)) return out;
  // ensure at least n newlines (but don't strip existing whitespace)
  let count = 0;
  for (let i = out.length - 1; i >= 0 && out[i] === "\n"; i--) count++;
  if (count >= n) return out;
  out += "\n".repeat(n - count);
  return out;
}

function insertOrAppendStudyingMd({
  dateISO,
  startTimeHHMM,
  endTimeHHMM,
  durationMinutes,
  description,
  tags,
  sources,
  notes,
  screenshots,
  dryRun = false,
}) {
  if (!fs.existsSync(STUDYING_MD_PATH)) {
    const err = new Error(`Studying.md not found at ${STUDYING_MD_PATH}`);
    err.status = 500;
    throw err;
  }

  const md = fs.readFileSync(STUDYING_MD_PATH, "utf8");
  const mdDate = toMDDate(dateISO);

  const { start, end } = computeStartEnd({ dateISO, startTimeHHMM, endTimeHHMM, durationMinutes });
  const entryBlock = ensureAtLeastNewlines(
    buildEntryBlock({ start, end, description, tags, sources, notes, screenshots }),
    2,
  );

  const { frontmatter, rest } = splitFrontmatter(md);
  const parsed = parseDateSections(rest);
  let insertedIntoExistingDate = false;

  const existing = parsed.sections.find((s) => s.mdDate === mdDate);
  if (existing) {
    insertedIntoExistingDate = true;
    const body = (existing.body || "").replace(/^\s*\n+/, "");
    existing.body = entryBlock + body;
  } else {
    parsed.sections.push({ mdDate, key: mdDateToKey(mdDate), body: entryBlock });
  }

  const rebuilt = rebuildStudyingMd({
    frontmatter,
    preamble: parsed.preamble,
    sections: parsed.sections,
  });

  if (!dryRun) fs.writeFileSync(STUDYING_MD_PATH, rebuilt, "utf8");
  const rebuiltRest = splitFrontmatter(rebuilt).rest;
  const order = parseDateSections(rebuiltRest).sections.map((s) => s.mdDate);
  return {
    mdDate,
    insertedIntoExistingDate,
    entryPreview: entryBlock.trimEnd(),
    dateOrder: order,
    dryRun,
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(Object.assign(new Error("Request too large"), { status: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(Object.assign(new Error("Invalid JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function sanitizeFilename(name) {
  const base = path.basename(String(name || "image"));
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return cleaned.length > 0 ? cleaned : "image";
}

function dataUrlToBuffer(dataUrl) {
  const m = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const b64 = m[2];
  return { mime, buffer: Buffer.from(b64, "base64") };
}

function extensionForMime(mime) {
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  return null;
}

function validateEntry(payload) {
  const dateISO = String(payload.date || "").trim();
  const startTimeHHMM = String(payload.startTime || "").trim();
  const endTimeHHMM = String(payload.endTime || "").trim();
  const durationMinutes = Number(payload.durationMinutes);
  const description = String(payload.description || "");
  const tags = Array.isArray(payload.tags) ? payload.tags : [];
  const sources = Array.isArray(payload.sources) ? payload.sources : [];
  const notes = Array.isArray(payload.notes) ? payload.notes : [];
  const screenshots = Array.isArray(payload.screenshots) ? payload.screenshots : [];
  const dryRun = Boolean(payload.dryRun);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
    throw Object.assign(new Error("date must be YYYY-MM-DD"), { status: 400 });
  }
  if (!/^\d{2}:\d{2}$/.test(endTimeHHMM)) {
    throw Object.assign(new Error("endTime must be HH:MM"), { status: 400 });
  }
  if (startTimeHHMM.length > 0) {
    if (!/^\d{2}:\d{2}$/.test(startTimeHHMM)) {
      throw Object.assign(new Error("startTime must be HH:MM"), { status: 400 });
    }
  } else {
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0 || durationMinutes > 24 * 60) {
      throw Object.assign(new Error("durationMinutes must be between 1 and 1440"), { status: 400 });
    }
  }
  if (description.trim().length === 0) {
    throw Object.assign(new Error("description is required"), { status: 400 });
  }

  return {
    dateISO,
    startTimeHHMM: startTimeHHMM.length > 0 ? startTimeHHMM : undefined,
    endTimeHHMM,
    durationMinutes,
    description,
    tags: tags.map((t) => String(t)).slice(0, 24),
    sources,
    notes,
    screenshots: screenshots
      .map((u) => String(u).trim())
      .filter((u) => u.startsWith("/assets/study-journal/"))
      .slice(0, 12),
    dryRun,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const method = (req.method || "GET").toUpperCase();

    if (method === "GET" && u.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        studyingMdPath: STUDYING_MD_PATH,
        studyingMdExists: fs.existsSync(STUDYING_MD_PATH),
        assetsDir: ASSETS_DIR,
      });
    }

    if (method === "POST" && u.pathname === "/api/upload") {
      const payload = await readJsonBody(req);
      const parsed = dataUrlToBuffer(payload.dataUrl);
      if (!parsed) return sendJson(res, 400, { ok: false, error: "Expected dataUrl (base64 data URL)" });
      const ext = extensionForMime(parsed.mime);
      if (!ext) return sendJson(res, 400, { ok: false, error: "Unsupported image type" });
      if (parsed.buffer.length > 12 * 1024 * 1024) {
        return sendJson(res, 413, { ok: false, error: "Image too large (max 12MB)" });
      }

      fs.mkdirSync(ASSETS_DIR, { recursive: true });
      const base = sanitizeFilename(payload.filename || `screenshot${ext}`);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const rand = Math.random().toString(16).slice(2, 8);
      const finalName = `${stamp}_${rand}_${base.replace(/\.[^.]+$/, "")}${ext}`;
      const outPath = path.join(ASSETS_DIR, finalName);
      fs.writeFileSync(outPath, parsed.buffer);

      const urlPath = `/assets/study-journal/${finalName}`;
      return sendJson(res, 200, { ok: true, url: urlPath, filename: finalName });
    }

    if (method === "POST" && u.pathname === "/api/entry") {
      const payload = await readJsonBody(req);
      const entry = validateEntry(payload);
      const result = insertOrAppendStudyingMd(entry);
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (method === "GET") {
      const filePath = safePublicPath(u.pathname);
      if (!filePath) return send(res, 404, "Not found");
      if (!fs.existsSync(filePath)) return send(res, 404, "Not found");

      const ext = path.extname(filePath).toLowerCase();
      const contentType =
        ext === ".html"
          ? "text/html; charset=utf-8"
          : ext === ".css"
            ? "text/css; charset=utf-8"
            : ext === ".js"
              ? "application/javascript; charset=utf-8"
              : "application/octet-stream";
      const body = fs.readFileSync(filePath);
      res.writeHead(200, { "Content-Type": contentType, "Content-Length": body.length });
      return res.end(body);
    }

    return send(res, 405, "Method not allowed");
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    return sendJson(res, status, { ok: false, error: String(err.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`Study Journal running on http://localhost:${PORT}`);
  console.log(`Appending to: ${STUDYING_MD_PATH}`);
});

