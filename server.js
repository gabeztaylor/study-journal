const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const { spawnSync } = require("node:child_process");

const PORT = Number(process.env.PORT || 3030);

// This app lives on Desktop next to gabeztaylor.github.io
const STUDYING_MD_PATH = path.resolve(
  __dirname,
  "../gabeztaylor.github.io/docs/Studying.md",
);

const ASSETS_DIR = path.resolve(__dirname, "../gabeztaylor.github.io/assets/study-journal");
const STUDYING_DATA_DIR = path.resolve(__dirname, "../gabeztaylor.github.io/docs/studying");
const REPO_ROOT = path.resolve(__dirname, "../gabeztaylor.github.io");
const ANKI_DIR = path.resolve(REPO_ROOT, "docs/anki");
const ANKI_MASTER_EXPORT_PATH = path.resolve(ANKI_DIR, "master-deck.json");
const ANKI_CONNECT_URL = "http://127.0.0.1:8765";
const ANKI_MEDIA_PUBLIC_DIR = path.resolve(REPO_ROOT, "site/public/assets/anki-media");
const ANKI_MEDIA_PUBLIC_URL_BASE = "/assets/anki-media";

const TAG_INDEX_START = "<!-- TAG_INDEX_START -->";
const TAG_INDEX_END = "<!-- TAG_INDEX_END -->";

const STUDY_STYLE_START = "<!-- STUDY_STYLE_START -->";
const STUDY_STYLE_END = "<!-- STUDY_STYLE_END -->";

function send(res, status, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": buf.length,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    ...headers,
  });
  res.end(buf);
}

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj, null, 2));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
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

function dateIdFromMdDate(mdDate) {
  return `d-${String(mdDate).trim().replace(/\s+/g, "").replace(/\//g, "-")}`;
}

function normalizeTag(t) {
  let s = String(t || "").trim();
  if (!s) return "";
  if (s.startsWith("#")) s = s.slice(1);
  s = s.toLowerCase().replace(/\s+/g, "-");
  s = s.replace(/[^a-z0-9_-]/g, "");
  return s;
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

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toLocalStampNoSeconds(date) {
  // Local time string: YYYY-MM-DDTHH:MM (no timezone, no seconds)
  const y = date.getFullYear();
  const mo = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mm = pad2(date.getMinutes());
  return `${y}-${mo}-${d}T${hh}:${mm}`;
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

function formatDuration(durationMinutes) {
  const mins = Math.max(1, Math.round(Number(durationMinutes) || 0));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function buildEntryBlock({ start, end, durationMinutes, description, tags, sources, notes, screenshots }) {
  const desc = String(description || "").trim().replace(/\s+/g, " ");
  const dur = formatDuration(durationMinutes);
  const entryLine = `- **${formatTime12h(start)} – ${formatTime12h(end)}** (${dur}): ${desc}`;

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
    blocks.push(
      `  - **Tags**\n${tagLines
        .map((t) => normalizeTag(t))
        .filter(Boolean)
        .map((t) => `    - [#${t}](#tag-${t})`)
        .join("\n")}`,
    );
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

function readDayJson(dateISO) {
  const p = path.join(STUDYING_DATA_DIR, `${dateISO}.json`);
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    const err = new Error(`Invalid JSON in ${p}`);
    err.status = 500;
    throw err;
  }
}

function writeDayJson(dateISO, obj, { dryRun = false } = {}) {
  fs.mkdirSync(STUDYING_DATA_DIR, { recursive: true });
  const p = path.join(STUDYING_DATA_DIR, `${dateISO}.json`);
  const body = JSON.stringify(obj, null, 2) + "\n";
  if (!dryRun) fs.writeFileSync(p, body, "utf8");
  return p;
}

function insertOrAppendStudyingJson({
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
  const { start, end, durationMinutes: computedMinutes } = computeStartEnd({
    dateISO,
    startTimeHHMM,
    endTimeHHMM,
    durationMinutes,
  });

  const session = {
    start: toLocalStampNoSeconds(start),
    end: toLocalStampNoSeconds(end),
    durationMinutes: computedMinutes,
    description: String(description || "").trim().replace(/\s+/g, " "),
    tags: Array.isArray(tags) ? tags.map((t) => normalizeTag(t)).filter(Boolean) : [],
    sources: Array.isArray(sources) ? sources.map((s) => String(s).trim()).filter(Boolean) : [],
    notes: Array.isArray(notes) ? notes.map((s) => String(s).trim()).filter(Boolean) : [],
    screenshots: Array.isArray(screenshots)
      ? screenshots.map((u) => String(u).trim()).filter((u) => u.startsWith("/assets/study-journal/"))
      : [],
  };

  const existing = readDayJson(dateISO) || { date: dateISO, sessions: [] };
  if (!Array.isArray(existing.sessions)) existing.sessions = [];
  existing.date = String(existing.date || dateISO);

  existing.sessions.unshift(session);

  // Keep newest->oldest by end-time if any weird ordering creeps in.
  existing.sessions.sort((a, b) => String(b.end || "").localeCompare(String(a.end || "")));

  const dataPath = writeDayJson(dateISO, existing, { dryRun });
  return { dataPath, session };
}

function run(cmd, args, { cwd }) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  return {
    ok: r.status === 0,
    status: r.status ?? null,
    stdout: String(r.stdout || ""),
    stderr: String(r.stderr || ""),
  };
}

function git(args) {
  return run("git", args, { cwd: REPO_ROOT });
}

async function ankiConnect(action, params = {}) {
  if (typeof fetch !== "function") {
    const err = new Error("Node fetch() not available. Please use Node 18+.");
    err.status = 500;
    throw err;
  }
  let resp;
  try {
    resp = await fetch(ANKI_CONNECT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, version: 6, params }),
    });
  } catch (e) {
    const err = new Error(
      "Could not reach AnkiConnect at http://127.0.0.1:8765. Is Anki running with AnkiConnect installed?",
    );
    err.status = 502;
    throw err;
  }
  const j = await resp.json().catch(() => null);
  if (!j || j.error) {
    const err = new Error(j?.error || `AnkiConnect error for action: ${action}`);
    err.status = 502;
    throw err;
  }
  return j.result;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function cardStateFromType(type) {
  const t = Number(type);
  if (t === 0) return "New";
  if (t === 1) return "Learning";
  if (t === 2) return "Review";
  if (t === 3) return "Relearning";
  return "Unknown";
}

function stripHtml(s) {
  return String(s || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function sanitizeMediaFilename(name) {
  // Keep original name as much as possible, but prevent traversal.
  const base = path.basename(String(name || "").trim());
  return base.replace(/[^a-zA-Z0-9._ -]+/g, "_");
}

function stripDangerousHtml(html) {
  // Remove style/script blocks that can leak into the page when rendered on the site.
  let s = String(html || "");
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
  // Remove Anki template directives that sometimes leak into rendered HTML.
  // Examples: [[type:Back]] or {{type:Back}}
  s = s.replace(/\[\[\s*type:[^\]]+\]\]/gi, "");
  s = s.replace(/\{\{\s*type:[^}]+\}\}/gi, "");
  return s;
}

function rewriteAndExportMedia(html, mediaMap) {
  // Replace <img src="localfile.png"> with hosted path and add to mediaMap.
  // mediaMap: filename -> true (to export)
  let out = stripDangerousHtml(html);
  const re = /<img\b[^>]*?\bsrc=(["'])([^"']+)\1[^>]*>/gi;
  out = out.replace(re, (m, q, src) => {
    const s = String(src || "").trim();
    if (!s || s.startsWith("http://") || s.startsWith("https://") || s.startsWith("data:")) return m;
    const filename = sanitizeMediaFilename(s);
    if (!filename) return m;
    mediaMap.set(filename, true);
    const url = `${ANKI_MEDIA_PUBLIC_URL_BASE}/${encodeURIComponent(filename)}`;
    return m.replace(src, url);
  });
  return out;
}

async function exportMediaFiles(mediaMap) {
  if (mediaMap.size === 0) return { exported: 0, skipped: 0 };
  fs.mkdirSync(ANKI_MEDIA_PUBLIC_DIR, { recursive: true });

  let exported = 0;
  let skipped = 0;

  for (const filename of mediaMap.keys()) {
    const outPath = path.join(ANKI_MEDIA_PUBLIC_DIR, filename);
    if (fs.existsSync(outPath)) {
      skipped++;
      continue;
    }
    const b64 = await ankiConnect("retrieveMediaFile", { filename });
    if (!b64) {
      skipped++;
      continue;
    }
    const buf = Buffer.from(String(b64), "base64");
    fs.writeFileSync(outPath, buf);
    exported++;
  }

  return { exported, skipped };
}

function pickFront(card) {
  // Prefer the rendered question (front template output) when available.
  // This is important for decks that embed images via the template rather than the raw field value.
  if (typeof card?.question === "string" && card.question.trim()) return card.question;
  const fields = card?.fields && typeof card.fields === "object" ? card.fields : null;
  if (fields && fields.Front && typeof fields.Front.value === "string") return fields.Front.value;
  const keys = fields ? Object.keys(fields) : [];
  if (fields && keys.length > 0) {
    const first = fields[keys[0]];
    if (first && typeof first.value === "string") return first.value;
  }
  return "";
}

function pickBack(card) {
  // Prefer the rendered answer (back template output) when available.
  if (typeof card?.answer === "string" && card.answer.trim()) return card.answer;
  const fields = card?.fields && typeof card.fields === "object" ? card.fields : null;
  if (fields && fields.Back && typeof fields.Back.value === "string") return fields.Back.value;
  return "";
}

async function exportMasterDeckSnapshot({ deckRoot = "Master Deck", excludeSuspended = true }) {
  const root = String(deckRoot || "").trim();
  // IMPORTANT:
  // `deck:"Master Deck"` includes cards in subdecks, so we must NOT query per-subdeck
  // or every card will be duplicated.
  const q = excludeSuspended
    ? `deck:"${root.replace(/"/g, '\\"')}" -is:suspended`
    : `deck:"${root.replace(/"/g, '\\"')}"`;
  const found = await ankiConnect("findCards", { query: q });
  const cardIds = Array.from(new Set(Array.isArray(found) ? found : []));

  const cards = [];
  const mediaMap = new Map(); // filename -> true
  for (const group of chunk(cardIds, 500)) {
    const infos = await ankiConnect("cardsInfo", { cards: group });
    for (const c of Array.isArray(infos) ? infos : []) {
      // suspended cards: queue == -1
      if (excludeSuspended && Number(c?.queue) === -1) continue;
      const frontHtml = rewriteAndExportMedia(pickFront(c), mediaMap);
      const backHtml = rewriteAndExportMedia(pickBack(c), mediaMap);
      cards.push({
        cardId: c?.cardId ?? c?.id ?? null,
        noteId: c?.note ?? c?.noteId ?? null,
        deckName: String(c?.deckName || ""),
        state: cardStateFromType(c?.type),
        frontHtml,
        backHtml,
        frontText: stripHtml(frontHtml),
      });
    }
  }

  const media = await exportMediaFiles(mediaMap);

  return {
    version: 1,
    deckRoot: root,
    generatedAt: new Date().toISOString(),
    excludeSuspended: Boolean(excludeSuspended),
    media: {
      urlBase: ANKI_MEDIA_PUBLIC_URL_BASE,
      exported: media.exported,
      skipped: media.skipped,
    },
    cards,
  };
}

function parseStatusPorcelain(porcelain) {
  // Output lines like: " M path" or "?? path"
  const out = [];
  for (const line of String(porcelain || "").split("\n")) {
    if (!line.trim()) continue;
    const m = line.match(/^[ MADRCU?!]{2}\s+(.*)$/);
    out.push(m ? m[1] : line.trim());
  }
  return out;
}

function splitFrontmatter(md) {
  // If present, return { frontmatter, rest }. Otherwise, { frontmatter: "", rest: md }.
  const m = md.match(/^---\n[\s\S]*?\n---\n/);
  if (!m) return { frontmatter: "", rest: md };
  return { frontmatter: m[0], rest: md.slice(m[0].length) };
}

function parseDateSections(content) {
  // Returns { preamble, sections: [{mdDate, key, body}] }
  const re = /^###\s+(\d{1,2}\/\d{1,2}\/\d{2})\s*(?:\{#[-_a-zA-Z0-9]+\})?\s*$/gm;
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

function stripTagIndexBlock(preamble) {
  const s = String(preamble || "");
  const start = s.indexOf(TAG_INDEX_START);
  const end = s.indexOf(TAG_INDEX_END);
  if (start !== -1 && end !== -1 && end > start) {
    const before = s.slice(0, start);
    const after = s.slice(end + TAG_INDEX_END.length);
    return (before + after).trimEnd();
  }
  return s.trimEnd();
}

function stripStudyStyleBlock(preamble) {
  const s = String(preamble || "");
  const start = s.indexOf(STUDY_STYLE_START);
  const end = s.indexOf(STUDY_STYLE_END);
  if (start !== -1 && end !== -1 && end > start) {
    const before = s.slice(0, start);
    const after = s.slice(end + STUDY_STYLE_END.length);
    return (before + after).trimEnd();
  }
  return s.trimEnd();
}

function buildStudyStyleMarkdown() {
  // Page-local styling: makes each day easy to visually distinguish while scrolling.
  return `${STUDY_STYLE_START}
<style>
  .study-day {
    margin: 18px 0;
    padding: 14px 16px;
    border: 1px solid rgba(0,0,0,0.08);
    border-radius: 14px;
    background: rgba(0,0,0,0.02);
  }
  .study-day h3 {
    margin: 0 0 10px 0;
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(0,0,0,0.08);
  }
  .study-day ul { margin-top: 8px; }
  .study-day > ul { margin-bottom: 0; }
  @media (prefers-color-scheme: dark) {
    .study-day {
      border-color: rgba(255,255,255,0.14);
      background: rgba(255,255,255,0.04);
    }
    .study-day h3 { border-bottom-color: rgba(255,255,255,0.14); }
  }
</style>
${STUDY_STYLE_END}
`;
}

function extractTagsFromBody(body) {
  const tags = new Set();
  const lines = String(body || "").split("\n");
  let inTags = false;
  for (const line of lines) {
    if (/^\s{2}-\s+\*\*Tags\*\*\s*$/.test(line)) {
      inTags = true;
      continue;
    }
    if (inTags) {
      if (line.trim() === "") continue;
      if (/^\s{2}-\s+\*\*/.test(line) || /^-\s+\*\*/.test(line)) {
        inTags = false;
        continue;
      }
      const m = line.match(/#([A-Za-z0-9_-]+)/);
      if (m) {
        const t = normalizeTag(m[1]);
        if (t) tags.add(t);
      }
    }
  }
  return Array.from(tags);
}

function upgradeHotTagLinks(body) {
  const lines = String(body || "").split("\n");
  const out = [];
  let inTags = false;
  for (const line of lines) {
    if (/^\s{2}-\s+\*\*Tags\*\*\s*$/.test(line)) {
      inTags = true;
      out.push(line);
      continue;
    }
    if (inTags) {
      if (/^\s{2}-\s+\*\*/.test(line) || /^-\s+\*\*/.test(line)) {
        inTags = false;
        out.push(line);
        continue;
      }
      const m = line.match(/^\s{4}-\s+(.*)\s*$/);
      if (m) {
        const tagMatch = m[1].match(/#([A-Za-z0-9_-]+)/);
        if (tagMatch) {
          const t = normalizeTag(tagMatch[1]);
          if (t) {
            out.push(`    - [#${t}](#tag-${t})`);
            continue;
          }
        }
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

function buildTagIndexMarkdown(sections) {
  // Build tag -> dates mapping (newest dates first)
  const tagToDates = new Map(); // tag -> [{mdDate,key}]
  const sortedSections = [...sections].sort((a, b) => {
    if (!a.key && !b.key) return 0;
    if (!a.key) return 1;
    if (!b.key) return -1;
    return b.key.localeCompare(a.key);
  });

  for (const s of sortedSections) {
    const tags = extractTagsFromBody(s.body);
    for (const t of tags) {
      const arr = tagToDates.get(t) || [];
      if (!arr.some((x) => x.mdDate === s.mdDate)) arr.push({ mdDate: s.mdDate, key: s.key });
      tagToDates.set(t, arr);
    }
  }

  const tags = Array.from(tagToDates.keys()).sort((a, b) => a.localeCompare(b));
  if (tags.length === 0) {
    return `${TAG_INDEX_START}\n## Tags\n\n_No tags yet._\n${TAG_INDEX_END}\n`;
  }

  let out = `${TAG_INDEX_START}\n## Tags\n\n`;
  out += tags.map((t) => `- [#${t}](#tag-${t})`).join("\n") + "\n\n";

  for (const t of tags) {
    out += `### #${t} {#tag-${t}}\n\n`;
    const dates = tagToDates.get(t) || [];
    out += dates
      .map((d) => `- [${d.mdDate}](#${dateIdFromMdDate(d.mdDate)})`)
      .join("\n");
    out += "\n\n";
  }

  out += `${TAG_INDEX_END}\n`;
  return out;
}

function rebuildStudyingMd({ frontmatter, preamble, sections }) {
  const parts = [];
  if (frontmatter) parts.push(frontmatter.trimEnd() + "\n");
  const cleanPreamble = stripStudyStyleBlock(stripTagIndexBlock(preamble || ""));
  const styleBlock = buildStudyStyleMarkdown();
  const tagIndex = buildTagIndexMarkdown(sections);
  parts.push([cleanPreamble, styleBlock, tagIndex].filter(Boolean).join("\n\n").trimEnd());

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
    out += `<section class="study-day" markdown="1">\n`;
    out += `### ${s.mdDate} {#${dateIdFromMdDate(s.mdDate)}}\n\n`;
    const body = upgradeHotTagLinks((s.body || "").trimEnd());
    if (body) out += body + "\n\n";
    else out += "\n";
    out += `</section>\n\n`;
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

  const { start, end, durationMinutes: computedMinutes } = computeStartEnd({
    dateISO,
    startTimeHHMM,
    endTimeHHMM,
    durationMinutes,
  });
  const entryBlock = ensureAtLeastNewlines(
    buildEntryBlock({
      start,
      end,
      durationMinutes: computedMinutes,
      description,
      tags,
      sources,
      notes,
      screenshots,
    }),
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
    tags: Array.from(
      new Set(tags.map((t) => normalizeTag(t)).filter(Boolean)),
    ).slice(0, 24),
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

    if (method === "OPTIONS" && u.pathname.startsWith("/api/")) {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Max-Age": "86400",
      });
      return res.end();
    }

    if (method === "GET" && u.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        studyingMdPath: STUDYING_MD_PATH,
        studyingMdExists: fs.existsSync(STUDYING_MD_PATH),
        studyingDataDir: STUDYING_DATA_DIR,
        studyingDataDirExists: fs.existsSync(STUDYING_DATA_DIR),
        assetsDir: ASSETS_DIR,
        ankiDir: ANKI_DIR,
        ankiExportPath: ANKI_MASTER_EXPORT_PATH,
        ankiMediaDir: ANKI_MEDIA_PUBLIC_DIR,
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
      const jsonResult = insertOrAppendStudyingJson(entry);
      const mdResult = insertOrAppendStudyingMd(entry);
      return sendJson(res, 200, {
        ok: true,
        ...mdResult,
        dataPath: jsonResult.dataPath,
        session: jsonResult.session,
      });
    }

    if (method === "POST" && u.pathname === "/api/publish") {
      const payload = await readJsonBody(req);
      const dryRun = Boolean(payload.dryRun);
      const message = String(payload.message || "").trim();

      const allowed = [
        "docs/studying/",
        "docs/anki/",
        "site/public/assets/anki-media/",
        "assets/study-journal/",
        "docs/Studying.md",
      ];

      // Safety rule:
      // - OK if repo has other UNSTAGED changes (we only commit allowed paths)
      // - Refuse if there are STAGED changes outside allowed paths (to avoid accidental mixed commits)
      const stagedBefore = git(["diff", "--cached", "--name-only"]);
      if (!stagedBefore.ok) {
        return sendJson(res, 500, { ok: false, error: "git diff --cached failed", ...stagedBefore });
      }
      const stagedBeforeFiles = stagedBefore.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
      const stagedOutside = stagedBeforeFiles.filter(
        (p) => !allowed.some((a) => (a.endsWith("/") ? p.startsWith(a) : p === a)),
      );
      if (stagedOutside.length > 0) {
        return sendJson(res, 400, {
          ok: false,
          error:
            "Refusing to publish because you already have staged changes outside the journal/assets. Commit or unstage them first.",
          stagedOutside,
        });
      }

      const addArgs = ["add", "--"].concat(allowed);
      const add = git(addArgs);
      if (!add.ok) return sendJson(res, 500, { ok: false, error: "git add failed", ...add });

      const staged = git(["diff", "--cached", "--name-only"]);
      if (!staged.ok) return sendJson(res, 500, { ok: false, error: "git diff --cached failed", ...staged });
      const stagedFiles = staged.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
      if (stagedFiles.length === 0) {
        return sendJson(res, 200, { ok: true, message: "Nothing staged to commit." });
      }

      const defaultMsg = `study-journal: update (${new Date().toISOString().slice(0, 10)})`;
      const commitMsg = message || defaultMsg;

      let commit = { ok: true, status: 0, stdout: "", stderr: "" };
      let push = { ok: true, status: 0, stdout: "", stderr: "" };

      if (!dryRun) {
        commit = git(["commit", "-m", commitMsg]);
        if (!commit.ok) {
          return sendJson(res, 500, { ok: false, error: "git commit failed", stagedFiles, ...commit });
        }

        push = git(["push"]);
        if (!push.ok) {
          return sendJson(res, 500, { ok: false, error: "git push failed", stagedFiles, commit, ...push });
        }
      }

      return sendJson(res, 200, {
        ok: true,
        dryRun,
        stagedFiles,
        commitMsg,
        commit,
        push,
      });
    }

    if (method === "POST" && u.pathname === "/api/anki/sync") {
      const payload = await readJsonBody(req);
      const deckRoot = String(payload.deckRoot || "Master Deck").trim() || "Master Deck";
      const publish = Boolean(payload.publish);
      const message = String(payload.message || "").trim();

      const snapshot = await exportMasterDeckSnapshot({ deckRoot, excludeSuspended: true });
      fs.mkdirSync(ANKI_DIR, { recursive: true });
      fs.writeFileSync(ANKI_MASTER_EXPORT_PATH, JSON.stringify(snapshot, null, 2) + "\n", "utf8");

      if (!publish) {
        return sendJson(res, 200, {
          ok: true,
          wrote: ANKI_MASTER_EXPORT_PATH,
          cards: snapshot.cards.length,
        });
      }

      // Reuse publish endpoint behavior by calling git directly here (same safety rules).
      const pubRes = await (async () => {
        const r = git(["diff", "--cached", "--name-only"]);
        if (!r.ok) return { ok: false, error: "git diff --cached failed", ...r };
        const stagedBeforeFiles = r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
        const allowed = ["docs/anki/", "site/public/assets/anki-media/"];
        const stagedOutside = stagedBeforeFiles.filter((p) => !allowed.some((a) => p.startsWith(a)));
        if (stagedOutside.length > 0) {
          return {
            ok: false,
            status: 400,
            error:
              "Refusing to publish because you already have staged changes outside docs/anki/. Commit or unstage them first.",
            stagedOutside,
          };
        }

        const add = git(["add", "--", "docs/anki/", "site/public/assets/anki-media/"]);
        if (!add.ok) return { ok: false, error: "git add failed", ...add };

        const staged = git(["diff", "--cached", "--name-only"]);
        if (!staged.ok) return { ok: false, error: "git diff --cached failed", ...staged };
        const stagedFiles = staged.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
        if (stagedFiles.length === 0) return { ok: true, message: "Nothing staged to commit." };

        const commitMsg = message || `anki: sync (${new Date().toISOString().slice(0, 10)})`;
        const commit = git(["commit", "-m", commitMsg]);
        if (!commit.ok) return { ok: false, error: "git commit failed", stagedFiles, ...commit };
        const push = git(["push"]);
        if (!push.ok) return { ok: false, error: "git push failed", stagedFiles, commit, ...push };
        return { ok: true, stagedFiles, commitMsg, commit, push };
      })();

      if (!pubRes.ok) {
        const status = pubRes.status || 500;
        return sendJson(res, status, { ok: false, ...pubRes, wrote: ANKI_MASTER_EXPORT_PATH });
      }

      return sendJson(res, 200, { ok: true, wrote: ANKI_MASTER_EXPORT_PATH, cards: snapshot.cards.length, ...pubRes });
    }

    if (method === "POST" && u.pathname === "/api/reindex") {
      if (!fs.existsSync(STUDYING_MD_PATH)) {
        return sendJson(res, 500, { ok: false, error: "Studying.md not found" });
      }
      const md = fs.readFileSync(STUDYING_MD_PATH, "utf8");
      const { frontmatter, rest } = splitFrontmatter(md);
      const parsed = parseDateSections(rest);
      const tagSet = new Set();
      for (const s of parsed.sections) {
        for (const t of extractTagsFromBody(s.body)) tagSet.add(t);
      }
      const tags = Array.from(tagSet).sort((a, b) => a.localeCompare(b));
      const rebuilt = rebuildStudyingMd({
        frontmatter,
        preamble: parsed.preamble,
        sections: parsed.sections,
      });
      fs.writeFileSync(STUDYING_MD_PATH, rebuilt, "utf8");
      const rebuiltRest = splitFrontmatter(rebuilt).rest;
      const order = parseDateSections(rebuiltRest).sections.map((s) => s.mdDate);
      return sendJson(res, 200, { ok: true, dateOrder: order, tags });
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

