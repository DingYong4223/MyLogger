"use strict";

const state = {
  fileName: "",
  rawText: "",
  rows: [],
  visibleRows: [],
  matches: [],
  activeMatch: -1,
  activeSearch: "",
  searchDirty: false,
  resultMode: false,
};

const els = {
  fileInput: document.getElementById("fileInput"),
  fileMeta: document.getElementById("fileMeta"),
  saveFiltered: document.getElementById("saveFiltered"),
  filterInput: document.getElementById("filterInput"),
  filterRegex: document.getElementById("filterRegex"),
  filterCase: document.getElementById("filterCase"),
  searchInput: document.getElementById("searchInput"),
  openSearchResults: document.getElementById("openSearchResults"),
  prevMatch: document.getElementById("prevMatch"),
  nextMatch: document.getElementById("nextMatch"),
  matchStatus: document.getElementById("matchStatus"),
  analyzeButton: document.getElementById("analyzeButton"),
  analysisEndpoint: document.getElementById("analysisEndpoint"),
  analysisResult: document.getElementById("analysisResult"),
  dropZone: document.getElementById("dropZone"),
  tableWrap: document.getElementById("tableWrap"),
  logBody: document.getElementById("logBody"),
  toast: document.getElementById("toast"),
};

function parseLine(text, index) {
  const filtered = text.match(/^(\d+):(.*)$/);
  const sourceLine = filtered ? Number(filtered[1]) : index + 1;
  const body = filtered ? filtered[2] : text;
  const logcat = body.match(/^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+([^:]+?)\s*:\s?(.*)$/);

  if (!logcat) {
    return {
      sourceLine,
      time: "",
      level: "",
      tag: "",
      message: body,
      raw: text,
      searchable: text,
    };
  }

  const [, time, pid, tid, level, tag, message] = logcat;
  return {
    sourceLine,
    time,
    level,
    tag: tag.trim(),
    message,
    pid,
    tid,
    raw: text,
    searchable: `${sourceLine} ${time} ${pid} ${tid} ${level} ${tag} ${message}`,
  };
}

async function openFile(file) {
  const text = await file.text();
  state.fileName = file.name;
  state.rawText = text;
  state.rows = text.split(/\r?\n/).map(parseLine);
  applyFilter();
  els.fileMeta.textContent = `${file.name} · ${state.rows.length.toLocaleString()} lines · ${formatBytes(file.size)}`;
  els.dropZone.classList.add("hidden");
  els.tableWrap.classList.remove("hidden");
  els.saveFiltered.disabled = false;
  els.analyzeButton.disabled = false;
}

async function loadSearchResultWindow() {
  const params = new URLSearchParams(window.location.search);
  const resultId = params.get("result");
  if (!resultId) return false;

  const key = `searchResult:${resultId}`;
  const data = await chrome.storage.local.get(key);
  const result = data[key];
  if (!result) {
    showToast("Search result expired or not found.");
    return true;
  }

  state.resultMode = true;
  state.fileName = result.fileName || "search-results.log";
  state.rawText = result.rows.map((row) => row.raw).join("\n");
  state.rows = result.rows.map((row) => ({ ...row }));
  state.visibleRows = state.rows.slice();
  state.activeSearch = result.query || "";
  els.fileMeta.textContent = `${state.fileName} · Search: ${result.query} · ${state.rows.length.toLocaleString()} matches`;
  els.dropZone.classList.add("hidden");
  els.tableWrap.classList.remove("hidden");
  els.saveFiltered.disabled = false;
  els.analyzeButton.disabled = false;
  els.filterInput.disabled = true;
  els.filterRegex.disabled = true;
  els.filterCase.disabled = true;
  els.searchInput.value = result.query || "";
  renderRows();
  state.matches = Array.from(els.logBody.querySelectorAll("tr"));
  state.activeMatch = -1;
  state.searchDirty = false;
  updateMatchStatus();
  return true;
}

function applyFilter() {
  const filter = els.filterInput.value;
  const matcher = createMatcher(filter, {
    regex: els.filterRegex.checked,
    caseSensitive: els.filterCase.checked,
  });

  state.visibleRows = matcher ? state.rows.filter((row) => matcher(row.searchable)) : state.rows.slice();
  clearSearchState();
  renderRows();
}

function createMatcher(input, options) {
  if (!input) return null;
  if (options.regex) {
    try {
      const flags = options.caseSensitive ? "" : "i";
      const regex = new RegExp(input, flags);
      return (value) => regex.test(value);
    } catch (error) {
      showToast(`Invalid regex: ${error.message}`);
      return null;
    }
  }

  const needle = options.caseSensitive ? input : input.toLowerCase();
  return (value) => {
    const haystack = options.caseSensitive ? value : value.toLowerCase();
    return haystack.includes(needle);
  };
}

function renderRows() {
  const fragment = document.createDocumentFragment();
  els.logBody.textContent = "";

  for (const row of state.visibleRows) {
    const tr = document.createElement("tr");
    tr.dataset.line = String(row.sourceLine);
    tr.title = "Click to copy this line";

    tr.append(
      cell(row.sourceLine, "line-col"),
      cell(highlight(row.time, state.activeSearch), "time-col"),
      cell(row.level, `level-col level-${row.level || "none"}`),
      cell(highlight(row.tag, state.activeSearch), "tag-col"),
      cell(highlight(row.message, state.activeSearch), "message-col")
    );

    tr.addEventListener("click", () => copyLine(row.raw));
    fragment.appendChild(tr);
  }

  els.logBody.appendChild(fragment);
  updateMatchStatus();
}

function cell(value, className) {
  const td = document.createElement("td");
  td.className = className;
  if (value instanceof Node) {
    td.appendChild(value);
  } else {
    td.textContent = value == null ? "" : String(value);
  }
  return td;
}

function highlight(value, query) {
  const span = document.createElement("span");
  const text = value || "";
  if (!query) {
    span.textContent = text;
    return span;
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let cursor = 0;

  while (true) {
    const index = lowerText.indexOf(lowerQuery, cursor);
    if (index < 0) break;
    span.append(document.createTextNode(text.slice(cursor, index)));
    const mark = document.createElement("mark");
    mark.textContent = text.slice(index, index + query.length);
    span.append(mark);
    cursor = index + query.length;
  }

  span.append(document.createTextNode(text.slice(cursor)));
  return span;
}

function clearSearchState() {
  state.matches = [];
  state.activeMatch = -1;
  state.activeSearch = "";
  state.searchDirty = false;
}

function markSearchDirty() {
  state.searchDirty = true;
  state.matches = [];
  state.activeMatch = -1;
  state.activeSearch = "";
  updateMatchStatus();
}

function findMatchingRows(query) {
  const lowerQuery = query.trim().toLowerCase();
  if (!lowerQuery) return [];
  return state.visibleRows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.searchable.toLowerCase().includes(lowerQuery));
}

function runSearch() {
  const query = els.searchInput.value.trim();
  state.matches = [];
  state.activeMatch = -1;
  state.activeSearch = query;
  state.searchDirty = false;
  renderRows();

  const renderedRows = Array.from(els.logBody.querySelectorAll("tr"));
  state.matches = findMatchingRows(query).map(({ index }) => renderedRows[index]);
  updateMatchStatus();
}

function goMatch(direction) {
  if (state.searchDirty || state.activeSearch !== els.searchInput.value.trim()) {
    runSearch();
  }
  if (!state.matches.length) return;
  if (state.activeMatch >= 0) {
    state.matches[state.activeMatch].classList.remove("active-match");
  }
  state.activeMatch = (state.activeMatch + direction + state.matches.length) % state.matches.length;
  const row = state.matches[state.activeMatch];
  row.classList.add("active-match");
  row.scrollIntoView({ block: "center", inline: "nearest" });
  updateMatchStatus();
}

async function openSearchResults() {
  const query = els.searchInput.value.trim();
  if (!query) {
    showToast("Enter a search keyword first.");
    return;
  }

  const rows = findMatchingRows(query).map(({ row }) => row);
  if (!rows.length) {
    showToast(`No matches for: ${query}`);
    return;
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const key = `searchResult:${id}`;
  await chrome.storage.local.set({
    [key]: {
      fileName: `${state.fileName || "log"}.search.log`,
      query,
      rows: rows.map((row) => ({
        sourceLine: row.sourceLine,
        time: row.time,
        level: row.level,
        tag: row.tag,
        message: row.message,
        raw: row.raw,
        searchable: row.searchable,
      })),
    },
  });
  chrome.tabs.create({ url: chrome.runtime.getURL(`viewer.html?result=${encodeURIComponent(id)}`) });
}

async function copyLine(line) {
  await navigator.clipboard.writeText(line);
  showToast(`Copied line: ${line.slice(0, 120)}`);
}

function saveFiltered() {
  const content = state.visibleRows.map((row) => row.raw).join("\n");
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const base = state.fileName ? state.fileName.replace(/\.[^.]+$/, "") : "mylogger";
  chrome.downloads.download({
    url,
    filename: `${base}.filtered.log`,
    saveAs: true,
  }, () => URL.revokeObjectURL(url));
}

async function analyzeVisible() {
  const endpoint = els.analysisEndpoint.value.trim();
  if (!endpoint) {
    showToast("Analysis endpoint is required.");
    return;
  }

  const payload = {
    fileName: state.fileName,
    visibleLineCount: state.visibleRows.length,
    filter: els.filterInput.value,
    content: state.visibleRows.map((row) => row.raw).join("\n"),
  };

  els.analysisResult.textContent = "Analyzing...";
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    els.analysisResult.textContent = text || `HTTP ${response.status}`;
  } catch (error) {
    els.analysisResult.textContent = `Analysis failed: ${error.message}`;
  }
}

function updateMatchStatus() {
  const visible = `${state.visibleRows.length.toLocaleString()} visible`;
  if (state.searchDirty) {
    els.matchStatus.textContent = `Search pending · ${visible}`;
    return;
  }
  if (!state.matches.length) {
    els.matchStatus.textContent = `0 matches · ${visible}`;
    return;
  }
  const current = state.activeMatch < 0 ? 0 : state.activeMatch + 1;
  els.matchStatus.textContent = `${current}/${state.matches.length} matches · ${visible}`;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 1800);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

els.fileInput.addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (file) openFile(file);
});

els.filterInput.addEventListener("input", applyFilter);
els.filterRegex.addEventListener("change", applyFilter);
els.filterCase.addEventListener("change", applyFilter);
els.searchInput.addEventListener("input", markSearchDirty);
els.openSearchResults.addEventListener("click", openSearchResults);
els.prevMatch.addEventListener("click", () => goMatch(-1));
els.nextMatch.addEventListener("click", () => goMatch(1));
els.saveFiltered.addEventListener("click", saveFiltered);
els.analyzeButton.addEventListener("click", analyzeVisible);

for (const target of [document.body, els.dropZone]) {
  target.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.dropZone.classList.add("dragging");
  });
  target.addEventListener("dragleave", () => els.dropZone.classList.remove("dragging"));
  target.addEventListener("drop", (event) => {
    event.preventDefault();
    els.dropZone.classList.remove("dragging");
    const file = event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) openFile(file);
  });
}

loadSearchResultWindow();
