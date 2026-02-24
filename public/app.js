const $ = (id) => document.getElementById(id);

const chipsEl = $("chips");
const dateEl = $("date");
const endTimeEl = $("endTime");
const startTimeEl = $("startTime");
const customMinutesEl = $("customMinutes");
const descriptionEl = $("description");
const tagsEl = $("tags");
const sourcesEl = $("sources");
const notesEl = $("notes");
const previewEl = $("preview");
const summaryEl = $("summary");
const summary2El = $("summary2");
const statusEl = $("status");
const submitEl = $("submit");
const updateEl = $("update");
const clearEl = $("clear");
const copyEl = $("copy");
const healthEl = $("health");

const publishEl = $("publish");
const publishMessageEl = $("publishMessage");
const publishStatusEl = $("publishStatus");
const publishOutputEl = $("publishOutput");

const ankiSyncEl = $("ankiSync");
const ankiSyncPublishEl = $("ankiSyncPublish");
const ankiMessageEl = $("ankiMessage");
const ankiStatusEl = $("ankiStatus");
const ankiOutputEl = $("ankiOutput");

const modeDurationEl = $("modeDuration");
const modeStartEndEl = $("modeStartEnd");
const durationControlsEl = $("durationControls");
const startEndControlsEl = $("startEndControls");
const startNowEl = $("startNow");
const endNowEl = $("endNow");

const dropzoneEl = $("dropzone");
const screenshotsEl = $("screenshots");
const shotListEl = $("shotList");

const PRESETS = [
  { label: "15m", minutes: 15 },
  { label: "30m", minutes: 30 },
  { label: "45m", minutes: 45 },
  { label: "1h", minutes: 60 },
  { label: "1.5h", minutes: 90 },
  { label: "2h", minutes: 120 },
];

let selectedMinutes = 30;
let mode = "duration"; // "duration" | "startEnd"
let screenshots = []; // [{url, name, previewDataUrl}]
let lastSavedKey = null; // { start: "YYYY-MM-DDTHH:MM", end: "YYYY-MM-DDTHH:MM" }

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatTime12h(date) {
  let h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${pad2(m)} ${ampm}`;
}

function parseLocalDateTime(dateISO, timeHHMM) {
  const [y, mo, d] = dateISO.split("-").map((x) => Number(x));
  const [hh, mm] = timeHHMM.split(":").map((x) => Number(x));
  return new Date(y, mo - 1, d, hh, mm, 0, 0);
}

function mdDate(dateISO) {
  const [y, m, d] = dateISO.split("-").map((x) => Number(x));
  const yy = String(y).slice(-2);
  return `${m}/${d}/${yy}`;
}

function getSourcesLines() {
  return sourcesEl.value
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function normalizeTag(t) {
  let s = String(t || "").trim();
  if (!s) return "";
  if (s.startsWith("#")) s = s.slice(1);
  s = s.toLowerCase().replace(/\s+/g, "-");
  s = s.replace(/[^a-z0-9_-]/g, "");
  return s;
}

function getTags() {
  const raw = String(tagsEl.value || "");
  const parts = raw
    .split(/[,\n]+/g)
    .flatMap((p) => p.split(/\s+/g))
    .map(normalizeTag)
    .filter(Boolean);
  return Array.from(new Set(parts));
}

function getNotesLines() {
  return notesEl.value
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function getDurationMinutes() {
  const custom = Number(customMinutesEl.value);
  if (Number.isFinite(custom) && custom > 0) return Math.min(custom, 1440);
  return selectedMinutes;
}

function computeStartEnd() {
  const dateISO = dateEl.value;
  const endHHMM = endTimeEl.value;
  if (!dateISO || !endHHMM) return null;

  if (mode === "startEnd") {
    const startHHMM = startTimeEl.value;
    if (!startHHMM) return null;
    const start = parseLocalDateTime(dateISO, startHHMM);
    const end = parseLocalDateTime(dateISO, endHHMM);
    if (!(end > start)) return { error: "End time must be after start time." };
    const durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000));
    return { start, end, durationMinutes };
  }

  const end = parseLocalDateTime(dateISO, endHHMM);
  const durationMinutes = getDurationMinutes();
  const start = new Date(end.getTime() - durationMinutes * 60_000);
  return { start, end, durationMinutes };
}

function buildPreview() {
  const dateISO = dateEl.value;
  const endHHMM = endTimeEl.value;
  const desc = descriptionEl.value.trim().replace(/\s+/g, " ");
  const computed = computeStartEnd();
  const tags = getTags();
  const sources = getSourcesLines();
  const notes = getNotesLines();
  const shots = screenshots.map((s) => s.url).filter(Boolean);

  if (!dateISO || !endHHMM || !computed || !desc) {
    previewEl.textContent =
      mode === "startEnd"
        ? "Fill date, start time, end time, and description to see the entry preview here."
        : "Fill date, end time, duration, and description to see the entry preview here.";
    summaryEl.textContent = "";
    summary2El.textContent = "";
    return;
  }

  if (computed.error) {
    previewEl.textContent = computed.error;
    summaryEl.textContent = "";
    summary2El.textContent = "";
    return;
  }

  const { start, end, durationMinutes } = computed;
  const dur =
    durationMinutes < 60
      ? `${durationMinutes}m`
      : durationMinutes % 60 === 0
        ? `${Math.floor(durationMinutes / 60)}h`
        : `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`;
  const entryLine = `- **${formatTime12h(start)} – ${formatTime12h(end)}** (${dur}): ${desc}`;
  const tagBlock =
    tags.length > 0
      ? `\n  - **Tags**\n${tags.map((t) => `    - [#${t}](#tag-${t})`).join("\n")}`
      : "";
  const srcBlock =
    sources.length > 0
      ? `\n  - **Sources**\n${sources.map((s) => `    - ${s}`).join("\n")}`
      : "";
  const notesBlock =
    notes.length > 0
      ? `\n  - **Notes**\n${notes.map((n) => `    - ${n}`).join("\n")}`
      : "";
  const shotBlock =
    shots.length > 0
      ? `\n  - **Screenshots**\n${shots.map((u) => `    - ![](${u})`).join("\n")}`
      : "";

  previewEl.textContent = [
    `### ${mdDate(dateISO)}`,
    "",
    entryLine + tagBlock + srcBlock + notesBlock + shotBlock,
  ].join("\n");

  const text = `Will log: ${durationMinutes} min (${formatTime12h(start)} → ${formatTime12h(end)})`;
  summaryEl.textContent = mode === "duration" ? text : "";
  summary2El.textContent = mode === "startEnd" ? text : "";
}

function setStatus(msg, kind) {
  statusEl.classList.remove("ok", "bad");
  if (kind) statusEl.classList.add(kind);
  statusEl.textContent = msg || "";
}

function setPublishStatus(msg, kind) {
  if (!publishStatusEl) return;
  publishStatusEl.classList.remove("ok", "bad");
  if (kind) publishStatusEl.classList.add(kind);
  publishStatusEl.textContent = msg || "";
}

function setAnkiStatus(msg, kind) {
  if (!ankiStatusEl) return;
  ankiStatusEl.classList.remove("ok", "bad");
  if (kind) ankiStatusEl.classList.add(kind);
  ankiStatusEl.textContent = msg || "";
}

function renderChips() {
  chipsEl.innerHTML = "";
  for (const p of PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = p.label;
    btn.setAttribute("aria-pressed", String(p.minutes === selectedMinutes));
    btn.addEventListener("click", () => {
      selectedMinutes = p.minutes;
      customMinutesEl.value = "";
      renderChips();
      buildPreview();
    });
    chipsEl.appendChild(btn);
  }
}

function setMode(nextMode) {
  mode = nextMode;
  modeDurationEl.setAttribute("aria-pressed", String(mode === "duration"));
  modeStartEndEl.setAttribute("aria-pressed", String(mode === "startEnd"));
  durationControlsEl.classList.toggle("hidden", mode !== "duration");
  startEndControlsEl.classList.toggle("hidden", mode !== "startEnd");
  setStatus("");
  buildPreview();
}

async function refreshHealth() {
  try {
    const r = await fetch("/api/health");
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Health check failed");
    healthEl.textContent = j.studyingMdExists
      ? "Connected ✓"
      : "Studying.md not found";
    healthEl.style.borderColor = j.studyingMdExists ? "rgba(56,217,150,0.35)" : "";
  } catch {
    healthEl.textContent = "Server offline";
  }
}

function setDefaults() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = pad2(now.getMonth() + 1);
  const dd = pad2(now.getDate());
  dateEl.value = `${yyyy}-${mm}-${dd}`;
  endTimeEl.value = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

function setNowTime(el) {
  const now = new Date();
  el.value = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

async function submit({ update = false } = {}) {
  const computed = computeStartEnd();
  const desc = descriptionEl.value.trim();

  if (!computed || computed.error || !dateEl.value || !endTimeEl.value || !desc) {
    setStatus("Missing required fields.", "bad");
    return;
  }

  if (update && (!lastSavedKey || !lastSavedKey.start || !lastSavedKey.end)) {
    setStatus("Nothing to update yet — save an entry first.", "bad");
    return;
  }
  if (update && lastSavedKey && String(lastSavedKey.start || "").slice(0, 10) !== String(dateEl.value || "")) {
    setStatus("Last saved entry was on a different date — save a new entry for this day first.", "bad");
    return;
  }

  const payload = {
    date: dateEl.value,
    endTime: endTimeEl.value,
    description: desc,
    tags: getTags(),
    sources: getSourcesLines(),
    notes: getNotesLines(),
    screenshots: screenshots.map((s) => s.url).filter(Boolean),
  };

  if (mode === "startEnd") {
    if (!startTimeEl.value) {
      setStatus("Missing required fields.", "bad");
      return;
    }
    payload.startTime = startTimeEl.value;
  } else {
    payload.durationMinutes = computed.durationMinutes;
  }

  if (update) payload.updateKey = lastSavedKey;

  submitEl.disabled = true;
  if (updateEl) updateEl.disabled = true;
  setStatus("Saving entry…");
  try {
    const r = await fetch("/api/entry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || "Failed to write");

    if (j.session && j.session.start && j.session.end) {
      lastSavedKey = { start: j.session.start, end: j.session.end };
    }
    if (updateEl) updateEl.disabled = !lastSavedKey;

    setStatus(
      j.updatedExistingEntry
        ? `Updated ${j.mdDate}.`
        : (j.insertedIntoExistingDate ? `Added to ${j.mdDate}.` : `Created new section for ${j.mdDate}.`),
      "ok",
    );
    if (publishOutputEl) {
      publishOutputEl.textContent =
        `${j.updatedExistingEntry ? "Updated" : "Saved"}.\n\nUpdated:\n` +
        `- ${j.dataPath || "docs/studying/YYYY-MM-DD.json"}\n` +
        `- docs/Studying.md\n`;
    }
    await refreshHealth();
  } catch (e) {
    setStatus(String(e.message || e), "bad");
  } finally {
    submitEl.disabled = false;
    if (updateEl) updateEl.disabled = !lastSavedKey;
  }
}

async function publish() {
  if (!publishEl) return;
  publishEl.disabled = true;
  setPublishStatus("Publishing…");
  if (publishOutputEl) publishOutputEl.textContent = "";

  try {
    const payload = {
      message: String(publishMessageEl?.value || "").trim() || undefined,
    };
    const r = await fetch("/api/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const ct = r.headers.get("content-type") || "";
    const text = await r.text();
    const j = ct.includes("application/json") ? JSON.parse(text || "{}") : null;
    if (!r.ok || !j.ok) {
      if (publishOutputEl) publishOutputEl.textContent = j ? JSON.stringify(j, null, 2) : text;
      throw new Error((j && j.error) ? j.error : `Publish failed: ${text || r.status}`);
    }

    setPublishStatus(j.message ? String(j.message) : "Published to GitHub.", "ok");
    if (publishOutputEl) {
      const out = {
        stagedFiles: j.stagedFiles,
        commitMsg: j.commitMsg,
        commit: j.commit,
        push: j.push,
      };
      publishOutputEl.textContent = JSON.stringify(out, null, 2);
    }
  } catch (e) {
    setPublishStatus(String(e.message || e), "bad");
  } finally {
    publishEl.disabled = false;
  }
}

async function syncAnki({ publish = false } = {}) {
  if (!ankiSyncEl) return;
  ankiSyncEl.disabled = true;
  if (ankiSyncPublishEl) ankiSyncPublishEl.disabled = true;
  setAnkiStatus(publish ? "Syncing + publishing…" : "Syncing…");
  if (ankiOutputEl) ankiOutputEl.textContent = "";

  try {
    const payload = {
      deckRoot: "Master Deck",
      publish,
      message: String(ankiMessageEl?.value || "").trim() || undefined,
    };
    const r = await fetch("/api/anki/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const ct = r.headers.get("content-type") || "";
    const text = await r.text();
    const j = ct.includes("application/json") ? JSON.parse(text || "{}") : null;
    if (!r.ok || !j.ok) {
      if (ankiOutputEl) ankiOutputEl.textContent = j ? JSON.stringify(j, null, 2) : text;
      throw new Error((j && j.error) ? j.error : `Anki sync failed: ${text || r.status}`);
    }

    setAnkiStatus(publish ? "Synced + published." : "Synced.", "ok");
    if (ankiOutputEl) ankiOutputEl.textContent = JSON.stringify(j, null, 2);
  } catch (e) {
    setAnkiStatus(String(e.message || e), "bad");
  } finally {
    ankiSyncEl.disabled = false;
    if (ankiSyncPublishEl) ankiSyncPublishEl.disabled = false;
  }
}

function clearForm() {
  descriptionEl.value = "";
  tagsEl.value = "";
  sourcesEl.value = "";
  notesEl.value = "";
  startTimeEl.value = "";
  customMinutesEl.value = "";
  screenshots = [];
  renderShots();
  selectedMinutes = 30;
  renderChips();
  setStatus("");
  buildPreview();
}

async function copyPreview() {
  const text = previewEl.textContent || "";
  if (!text.trim()) return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Copied preview to clipboard.", "ok");
  } catch {
    setStatus("Could not access clipboard.", "bad");
  }
}

renderChips();
setDefaults();
setMode("duration");
buildPreview();
refreshHealth();

dateEl.addEventListener("input", buildPreview);
endTimeEl.addEventListener("input", buildPreview);
customMinutesEl.addEventListener("input", () => {
  // selecting custom minutes overrides presets
  renderChips();
  buildPreview();
});
descriptionEl.addEventListener("input", buildPreview);
tagsEl.addEventListener("input", buildPreview);
sourcesEl.addEventListener("input", buildPreview);
notesEl.addEventListener("input", buildPreview);

submitEl.addEventListener("click", () => submit({ update: false }));
updateEl?.addEventListener("click", () => submit({ update: true }));
clearEl.addEventListener("click", clearForm);
copyEl.addEventListener("click", copyPreview);
publishEl?.addEventListener("click", publish);
ankiSyncEl?.addEventListener("click", () => syncAnki({ publish: false }));
ankiSyncPublishEl?.addEventListener("click", () => syncAnki({ publish: true }));

modeDurationEl.addEventListener("click", () => setMode("duration"));
modeStartEndEl.addEventListener("click", () => setMode("startEnd"));

startTimeEl.addEventListener("input", buildPreview);

startNowEl.addEventListener("click", () => {
  if (!dateEl.value) setDefaults();
  setNowTime(startTimeEl);
  setMode("startEnd");
});
endNowEl.addEventListener("click", () => {
  if (!dateEl.value) setDefaults();
  setNowTime(endTimeEl);
  setMode("startEnd");
});

function renderShots() {
  shotListEl.innerHTML = "";
  for (const s of screenshots) {
    const card = document.createElement("div");
    card.className = "shot";
    const img = document.createElement("img");
    img.alt = s.name || "screenshot";
    img.src = s.previewDataUrl || s.url || "";
    const meta = document.createElement("div");
    meta.className = "shotMeta";
    const name = document.createElement("div");
    name.className = "shotName";
    name.textContent = s.name || s.url || "screenshot";
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "shotRemove";
    rm.textContent = "Remove";
    rm.addEventListener("click", () => {
      screenshots = screenshots.filter((x) => x !== s);
      renderShots();
      buildPreview();
    });
    meta.appendChild(name);
    meta.appendChild(rm);
    card.appendChild(img);
    card.appendChild(meta);
    shotListEl.appendChild(card);
  }
}

async function uploadImageFile(file) {
  if (!file || !file.type || !file.type.startsWith("image/")) return null;
  if (file.size > 12 * 1024 * 1024) throw new Error("Image too large (max 12MB).");

  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("Failed to read file."));
    r.readAsDataURL(file);
  });

  const resp = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, dataUrl }),
  });
  const j = await resp.json();
  if (!resp.ok || !j.ok) throw new Error(j.error || "Upload failed");
  return { url: j.url, name: j.filename || file.name, previewDataUrl: dataUrl };
}

async function handleFiles(files) {
  const list = Array.from(files || []);
  if (list.length === 0) return;
  setStatus(`Uploading ${list.length} image(s)…`);
  try {
    for (const f of list) {
      const uploaded = await uploadImageFile(f);
      if (uploaded) screenshots.unshift(uploaded);
    }
    setStatus("Screenshots added.", "ok");
    renderShots();
    buildPreview();
  } catch (e) {
    setStatus(String(e.message || e), "bad");
  }
}

dropzoneEl.addEventListener("click", () => screenshotsEl.click());
dropzoneEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") screenshotsEl.click();
});
dropzoneEl.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzoneEl.classList.add("dragover");
});
dropzoneEl.addEventListener("dragleave", () => dropzoneEl.classList.remove("dragover"));
dropzoneEl.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzoneEl.classList.remove("dragover");
  void handleFiles(e.dataTransfer?.files);
});
screenshotsEl.addEventListener("change", () => {
  void handleFiles(screenshotsEl.files);
  screenshotsEl.value = "";
});

