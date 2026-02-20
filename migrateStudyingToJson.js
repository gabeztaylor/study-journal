#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../gabeztaylor.github.io");
const STUDYING_MD_PATH = path.resolve(REPO_ROOT, "docs/Studying.md");
const STUDYING_DATA_DIR = path.resolve(REPO_ROOT, "docs/studying");

function pad2(n) {
  return String(n).padStart(2, "0");
}

function splitFrontmatter(md) {
  const m = String(md || "").match(/^---\n[\s\S]*?\n---\n/);
  if (!m) return { frontmatter: "", rest: String(md || "") };
  return { frontmatter: m[0], rest: String(md || "").slice(m[0].length) };
}

function mdDateToISO(mdDate) {
  const m = String(mdDate || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = 2000 + Number(m[3]);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function parseDateSections(content) {
  const re = /^###\s+(\d{1,2}\/\d{1,2}\/\d{2})\s*(?:\{#[-_a-zA-Z0-9]+\})?\s*$/gm;
  const sections = [];
  let lastBodyStart = 0;
  let lastSection = null;

  while (true) {
    const match = re.exec(content);
    if (!match) break;

    if (lastSection) {
      lastSection.body = content.slice(lastBodyStart, match.index);
    }

    const mdDate = match[1].replace(/\s+/g, "");
    lastSection = { mdDate, body: "" };
    sections.push(lastSection);
    lastBodyStart = re.lastIndex;
  }

  if (lastSection) lastSection.body = content.slice(lastBodyStart);
  return sections.map((s) => ({ ...s, body: String(s.body || "").replace(/^\s*\n+/, "").replace(/\n+$/, "\n") }));
}

function parseDurationToMinutes(s) {
  const str = String(s || "").trim();
  const h = str.match(/(\d+)\s*h\b/i);
  const m = str.match(/(\d+)\s*m\b/i);
  const hours = h ? Number(h[1]) : 0;
  const mins = m ? Number(m[1]) : 0;
  const total = hours * 60 + mins;
  return Number.isFinite(total) && total > 0 ? total : 0;
}

function parseTime12h(t) {
  const m = String(t || "").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let hh = Number(m[1]);
  const mm = Number(m[2]);
  const ampm = String(m[3]).toUpperCase();
  if (ampm === "AM") {
    if (hh === 12) hh = 0;
  } else {
    if (hh !== 12) hh += 12;
  }
  return { hh, mm };
}

function normalizeTag(t) {
  let s = String(t || "").trim();
  if (!s) return "";
  if (s.startsWith("#")) s = s.slice(1);
  s = s.toLowerCase().replace(/\s+/g, "-");
  s = s.replace(/[^a-z0-9_-]/g, "");
  return s;
}

function toLocalStamp(dateISO, { hh, mm }) {
  return `${dateISO}T${pad2(hh)}:${pad2(mm)}`;
}

function parseSessionsFromBody(body, dateISO) {
  const lines = String(body || "").split("\n");
  const sessions = [];

  const entryRe =
    /^\s*-\s+\*\*([^*]+?)\s+–\s+([^*]+?)\*\*\s+\(([^)]+)\):\s*(.+?)\s*$/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(entryRe);
    if (!m) {
      i++;
      continue;
    }

    const startLabel = m[1];
    const endLabel = m[2];
    const durStr = m[3];
    const description = m[4];

    const startHM = parseTime12h(startLabel);
    const endHM = parseTime12h(endLabel);
    const durationMinutes = parseDurationToMinutes(durStr);

    const session = {
      start: startHM ? toLocalStamp(dateISO, startHM) : "",
      end: endHM ? toLocalStamp(dateISO, endHM) : "",
      durationMinutes,
      description: String(description || "").trim(),
      tags: [],
      sources: [],
      notes: [],
      screenshots: [],
    };

    i++;
    let mode = "";
    while (i < lines.length) {
      const l = lines[i];
      if (entryRe.test(l)) break;

      const head = l.match(/^\s{2}-\s+\*\*(Tags|Sources|Notes|Screenshots)\*\*\s*$/);
      if (head) {
        mode = head[1].toLowerCase();
        i++;
        continue;
      }

      const item = l.match(/^\s{4}-\s+(.*)\s*$/);
      if (item && mode) {
        const v = item[1];
        if (mode === "tags") {
          const tm = v.match(/#([A-Za-z0-9_-]+)/);
          if (tm) {
            const t = normalizeTag(tm[1]);
            if (t && !session.tags.includes(t)) session.tags.push(t);
          }
        } else if (mode === "screenshots") {
          const um = v.match(/\(([^)]+)\)/);
          if (um) {
            const u = String(um[1]).trim();
            if (u) session.screenshots.push(u);
          } else {
            const u = String(v).trim();
            if (u) session.screenshots.push(u);
          }
        } else if (mode === "sources") {
          const s = String(v).trim();
          if (s) session.sources.push(s);
        } else if (mode === "notes") {
          const n = String(v).trim();
          if (n) session.notes.push(n);
        }
        i++;
        continue;
      }

      i++;
    }

    sessions.push(session);
  }

  sessions.sort((a, b) => String(b.end).localeCompare(String(a.end)));
  return sessions;
}

function writeDay(dateISO, sessions) {
  fs.mkdirSync(STUDYING_DATA_DIR, { recursive: true });
  const p = path.join(STUDYING_DATA_DIR, `${dateISO}.json`);
  const obj = { date: dateISO, sessions };
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
  return p;
}

function main() {
  if (!fs.existsSync(STUDYING_MD_PATH)) {
    console.error(`Studying.md not found at ${STUDYING_MD_PATH}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(STUDYING_MD_PATH, "utf8");
  const { rest } = splitFrontmatter(raw);
  const sections = parseDateSections(rest);

  let daysWritten = 0;
  let sessionsWritten = 0;

  for (const s of sections) {
    const dateISO = mdDateToISO(s.mdDate);
    if (!dateISO) continue;
    const sessions = parseSessionsFromBody(s.body, dateISO);
    const outPath = writeDay(dateISO, sessions);
    daysWritten++;
    sessionsWritten += sessions.length;
    console.log(`wrote ${outPath} (${sessions.length} sessions)`);
  }

  console.log(`done: ${daysWritten} day files, ${sessionsWritten} sessions`);
}

main();

