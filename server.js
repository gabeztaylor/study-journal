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

function buildEntryBlock({ start, end, description, sources, notes }) {
  const desc = String(description || "").trim().replace(/\s+/g, " ");
  const entryLine = `- **${formatTime12h(start)} – ${formatTime12h(end)}**: ${desc}`;

  const srcLines = (Array.isArray(sources) ? sources : [])
    .map((s) => String(s).trim())
    .filter(Boolean);

  const noteLines = (Array.isArray(notes) ? notes : [])
    .map((s) => String(s).trim())
    .filter(Boolean);

  const blocks = [entryLine];

  if (srcLines.length > 0) {
    blocks.push(`  - **Sources**\n${srcLines.map((s) => `    - ${s}`).join("\n")}`);
  }
  if (noteLines.length > 0) {
    blocks.push(`  - **Notes**\n${noteLines.map((n) => `    - ${n}`).join("\n")}`);
  }

  return blocks.join("\n") + "\n";
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
  sources,
  notes,
  dryRun = false,
}) {
  if (!fs.existsSync(STUDYING_MD_PATH)) {
    const err = new Error(`Studying.md not found at ${STUDYING_MD_PATH}`);
    err.status = 500;
    throw err;
  }

  const md = fs.readFileSync(STUDYING_MD_PATH, "utf8");
  const mdDate = toMDDate(dateISO);
  const headingLine = `### ${mdDate}`;
  const headingRe = new RegExp(`^###\\s+${escapeRegExp(mdDate)}\\s*$`, "m");

  const { start, end } = computeStartEnd({ dateISO, startTimeHHMM, endTimeHHMM, durationMinutes });
  const entryBlock = buildEntryBlock({ start, end, description, sources, notes });

  if (headingRe.test(md)) {
    // Insert into existing date section before the next ### heading (or EOF)
    const dateMatch = md.match(headingRe);
    const dateIndex = md.indexOf(dateMatch[0]);
    const afterDateIndex = dateIndex + dateMatch[0].length;

    const nextHeadingRe = /^###\s+\d{1,2}\/\d{1,2}\/\d{2}\s*$/gm;
    nextHeadingRe.lastIndex = afterDateIndex;
    const next = nextHeadingRe.exec(md);
    const insertAt = next ? next.index : md.length;

    const before = md.slice(0, insertAt);
    const after = md.slice(insertAt);

    const before2 = ensureAtLeastNewlines(before, 2);
    const entry2 = ensureAtLeastNewlines(entryBlock, 2);
    const after2 = after.startsWith("\n") ? after : "\n" + after;

    const out = before2 + entry2 + after2;
    if (!dryRun) fs.writeFileSync(STUDYING_MD_PATH, out, "utf8");
    return {
      mdDate,
      insertedIntoExistingDate: true,
      entryPreview: entry2.trimEnd(),
      dryRun,
    };
  }

  // Append new date section to the end
  const section =
    `${headingLine}\n\n` +
    ensureAtLeastNewlines(entryBlock, 2);

  const out = ensureAtLeastNewlines(md, 2) + section;
  if (!dryRun) fs.writeFileSync(STUDYING_MD_PATH, out, "utf8");
  return { mdDate, insertedIntoExistingDate: false, entryPreview: section.trimEnd(), dryRun };
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

function validateEntry(payload) {
  const dateISO = String(payload.date || "").trim();
  const startTimeHHMM = String(payload.startTime || "").trim();
  const endTimeHHMM = String(payload.endTime || "").trim();
  const durationMinutes = Number(payload.durationMinutes);
  const description = String(payload.description || "");
  const sources = Array.isArray(payload.sources) ? payload.sources : [];
  const notes = Array.isArray(payload.notes) ? payload.notes : [];
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
    sources,
    notes,
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
      });
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

