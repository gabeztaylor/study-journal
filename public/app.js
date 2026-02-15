const $ = (id) => document.getElementById(id);

const chipsEl = $("chips");
const dateEl = $("date");
const endTimeEl = $("endTime");
const startTimeEl = $("startTime");
const customMinutesEl = $("customMinutes");
const descriptionEl = $("description");
const sourcesEl = $("sources");
const notesEl = $("notes");
const previewEl = $("preview");
const summaryEl = $("summary");
const summary2El = $("summary2");
const statusEl = $("status");
const submitEl = $("submit");
const clearEl = $("clear");
const copyEl = $("copy");
const healthEl = $("health");

const modeDurationEl = $("modeDuration");
const modeStartEndEl = $("modeStartEnd");
const durationControlsEl = $("durationControls");
const startEndControlsEl = $("startEndControls");
const startNowEl = $("startNow");
const endNowEl = $("endNow");

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
  const sources = getSourcesLines();
  const notes = getNotesLines();

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
  const entryLine = `- **${formatTime12h(start)} – ${formatTime12h(end)}**: ${desc}`;
  const srcBlock =
    sources.length > 0
      ? `\n  - **Sources**\n${sources.map((s) => `    - ${s}`).join("\n")}`
      : "";
  const notesBlock =
    notes.length > 0
      ? `\n  - **Notes**\n${notes.map((n) => `    - ${n}`).join("\n")}`
      : "";

  previewEl.textContent = [
    `### ${mdDate(dateISO)}`,
    "",
    entryLine + srcBlock + notesBlock,
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

async function submit() {
  const computed = computeStartEnd();
  const desc = descriptionEl.value.trim();

  if (!computed || computed.error || !dateEl.value || !endTimeEl.value || !desc) {
    setStatus("Missing required fields.", "bad");
    return;
  }

  const payload = {
    date: dateEl.value,
    endTime: endTimeEl.value,
    description: desc,
    sources: getSourcesLines(),
    notes: getNotesLines(),
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

  submitEl.disabled = true;
  setStatus("Writing to Studying.md…");
  try {
    const r = await fetch("/api/entry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || "Failed to write");
    setStatus(
      j.insertedIntoExistingDate
        ? `Added to ${j.mdDate}.`
        : `Created new section for ${j.mdDate}.`,
      "ok",
    );
    await refreshHealth();
  } catch (e) {
    setStatus(String(e.message || e), "bad");
  } finally {
    submitEl.disabled = false;
  }
}

function clearForm() {
  descriptionEl.value = "";
  sourcesEl.value = "";
  notesEl.value = "";
  startTimeEl.value = "";
  customMinutesEl.value = "";
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
sourcesEl.addEventListener("input", buildPreview);
notesEl.addEventListener("input", buildPreview);

submitEl.addEventListener("click", submit);
clearEl.addEventListener("click", clearForm);
copyEl.addEventListener("click", copyPreview);

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

