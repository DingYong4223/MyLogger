import { measureNaturalWidth, prepare } from "@chenglou/pretext";

const LOG_ROW_HEIGHT = 24;
const LOG_OVERSCAN_ROWS = 30;
const LOG_CONTEXT_RADIUS = 50;
const LOG_TEXT_FONT = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
const LOG_FIXED_COLUMNS_WIDTH = 48 + 136 + 58 + 150;
const TOOLS_PAGE_PATH = "mytools.htm";
const QRCODE_SCRIPT_PATH = "vendor/qrcode.min.js";

const state = {
  fileName: "",
  filePath: "",
  breakpointsFileName: "",
  breakpointsFilePath: "",
  breakpointsContent: "",
  rawText: "",
  rows: [],
  visibleRows: [],
  selectedLevels: new Set(),
  tagFilters: [""],
  draftTagFilters: [""],
  timeFilterStart: null,
  timeFilterEnd: null,
  draftTimeFilterStart: null,
  draftTimeFilterEnd: null,
  timeFilterPoints: [],
  matches: [],
  searchResultRows: [],
  searchModalCanOpenContext: false,
  markedLines: new Set(),
  activeMarkedLine: null,
  activeMatch: -1,
  activeSearch: "",
  searchDirty: false,
  modalMatches: [],
  modalActiveMatch: -1,
  modalActiveSearch: "",
  modalSearchDirty: false,
  analysisModalText: "",
  analysisModalData: null,
  analysisModalMatches: [],
  analysisModalActiveMatch: -1,
  analysisModalSearch: "",
  virtualStart: 0,
  virtualEnd: 0,
  contextActiveIndex: -1,
  contextVirtualStart: 0,
  contextVirtualEnd: 0,
};

let filterTimer = 0;
let analysisStatusTimer = 0;
let virtualScrollFrame = 0;
let contextVirtualScrollFrame = 0;
let pendingLogRowClickTimer = 0;
let suppressNextLogRowClick = false;

const els = {
  fileInput: document.getElementById("fileInput"),
  breakpointsInput: document.getElementById("breakpointsInput"),
  viewBreakpointsFile: document.getElementById("viewBreakpointsFile"),
  fileMeta: document.getElementById("fileMeta"),
  breakpointsMeta: document.getElementById("breakpointsMeta"),
  saveFiltered: document.getElementById("saveFiltered"),
  filterInput: document.getElementById("filterInput"),
  viewFilterResults: document.getElementById("viewFilterResults"),
  filterRegex: document.getElementById("filterRegex"),
  filterCase: document.getElementById("filterCase"),
  timeFilterHeader: document.getElementById("timeFilterHeader"),
  timeFilterPopover: document.getElementById("timeFilterPopover"),
  timeFilterStartList: document.getElementById("timeFilterStartList"),
  timeFilterEndList: document.getElementById("timeFilterEndList"),
  confirmTimeFilter: document.getElementById("confirmTimeFilter"),
  clearTimeFilter: document.getElementById("clearTimeFilter"),
  levelFilterHeader: document.getElementById("levelFilterHeader"),
  levelFilterPopover: document.getElementById("levelFilterPopover"),
  tagFilterHeader: document.getElementById("tagFilterHeader"),
  tagFilterPopover: document.getElementById("tagFilterPopover"),
  tagFilterInputs: document.getElementById("tagFilterInputs"),
  addTagFilter: document.getElementById("addTagFilter"),
  confirmTagFilter: document.getElementById("confirmTagFilter"),
  clearTagFilter: document.getElementById("clearTagFilter"),
  searchInput: document.getElementById("searchInput"),
  openSearchResults: document.getElementById("openSearchResults"),
  openMarkedRows: document.getElementById("openMarkedRows"),
  prevMarkedLine: document.getElementById("prevMarkedLine"),
  nextMarkedLine: document.getElementById("nextMarkedLine"),
  matchStatus: document.getElementById("matchStatus"),
  analyzeButton: document.getElementById("analyzeButton"),
  filterLogsButton: document.getElementById("filterLogsButton"),
  analysisStatusButton: document.getElementById("analysisStatusButton"),
  analysisEndpoint: document.getElementById("analysisEndpoint"),
  openToolsPage: document.getElementById("openToolsPage"),
  analysisBreakpointsPath: document.getElementById("analysisBreakpointsPath"),
  analysisLogPath: document.getElementById("analysisLogPath"),
  content: document.getElementById("content"),
  toggleAnalysisPanel: document.getElementById("toggleAnalysisPanel"),
  dropZone: document.getElementById("dropZone"),
  tableWrap: document.getElementById("tableWrap"),
  logTable: document.querySelector("#tableWrap .log-table"),
  scrollToTop: document.getElementById("scrollToTop"),
  scrollToBottom: document.getElementById("scrollToBottom"),
  logBody: document.getElementById("logBody"),
  searchModal: document.getElementById("searchModal"),
  searchModalTitle: document.getElementById("searchModalTitle"),
  searchModalMeta: document.getElementById("searchModalMeta"),
  searchResultBody: document.getElementById("searchResultBody"),
  contextModal: document.getElementById("contextModal"),
  contextModalMeta: document.getElementById("contextModalMeta"),
  contextTableWrap: document.getElementById("contextTableWrap"),
  contextLogTable: document.querySelector("#contextTableWrap .log-table"),
  contextLogBody: document.getElementById("contextLogBody"),
  closeContextModal: document.getElementById("closeContextModal"),
  modalSearchInput: document.getElementById("modalSearchInput"),
  modalPrevMatch: document.getElementById("modalPrevMatch"),
  modalNextMatch: document.getElementById("modalNextMatch"),
  modalMatchStatus: document.getElementById("modalMatchStatus"),
  clearMarkedRows: document.getElementById("clearMarkedRows"),
  saveSearchResults: document.getElementById("saveSearchResults"),
  closeSearchModal: document.getElementById("closeSearchModal"),
  analysisModal: document.getElementById("analysisModal"),
  analysisModalMeta: document.getElementById("analysisModalMeta"),
  analysisModalBody: document.getElementById("analysisModalBody"),
  analysisModalSearchInput: document.getElementById("analysisModalSearchInput"),
  analysisModalPrevMatch: document.getElementById("analysisModalPrevMatch"),
  analysisModalNextMatch: document.getElementById("analysisModalNextMatch"),
  analysisModalMatchStatus: document.getElementById("analysisModalMatchStatus"),
  saveAnalysisModal: document.getElementById("saveAnalysisModal"),
  closeAnalysisModal: document.getElementById("closeAnalysisModal"),
  breakpointsModal: document.getElementById("breakpointsModal"),
  breakpointsModalMeta: document.getElementById("breakpointsModalMeta"),
  breakpointsModalBody: document.getElementById("breakpointsModalBody"),
  closeBreakpointsModal: document.getElementById("closeBreakpointsModal"),
  openHelpModal: document.getElementById("openHelpModal"),
  helpModal: document.getElementById("helpModal"),
  closeHelpModal: document.getElementById("closeHelpModal"),
  toast: document.getElementById("toast"),
};

function parseLine(text, index) {
  const filtered = text.match(/^(\d+):\s*(.*)$/);
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
      raw: body,
      timeValue: null,
      searchable: `${sourceLine} ${body}`,
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
    raw: body,
    timeValue: parseLogTimeValue(time),
    searchable: `${sourceLine} ${time} ${pid} ${tid} ${level} ${tag} ${message}`,
  };
}

function parseLogTimeValue(value) {
  const match = value.match(/^(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/);
  if (!match) return null;
  const [, month, day, hour, minute, second, millisecond] = match.map(Number);
  return Date.UTC(2000, month - 1, day, hour, minute, second, millisecond);
}

async function openFile(file) {
  const text = await file.text();
  state.fileName = file.name;
  state.filePath = file.path || file.name;
  state.rawText = text;
  state.rows = text.split(/\r?\n/).map(parseLine);
  state.selectedLevels.clear();
  state.tagFilters = [""];
  state.draftTagFilters = [""];
  state.timeFilterStart = null;
  state.timeFilterEnd = null;
  state.draftTimeFilterStart = null;
  state.draftTimeFilterEnd = null;
  updateTimeFilterOptions();
  updateTimeFilterHeader();
  renderTagFilterInputs();
  updateTagFilterHeader();
  state.markedLines.clear();
  state.activeMarkedLine = null;
  els.analysisLogPath.textContent = state.filePath;
  els.fileMeta.textContent = `${file.name} · ${state.rows.length.toLocaleString()} 行 · ${formatBytes(file.size)}`;
  els.dropZone.classList.add("hidden");
  els.tableWrap.classList.remove("hidden");
  updateLevelFilterOptions();
  applyFilter();
  updateAnalyzeButtonState();
}

async function openBreakpointsFile(file) {
  if (!file.name.toLowerCase().endsWith(".json")) {
    clearBreakpointsFile();
    showToast("断点文件必须是 JSON 文件。");
    els.breakpointsInput.value = "";
    return;
  }

  const text = await file.text();
  try {
    JSON.parse(text);
  } catch (error) {
    clearBreakpointsFile();
    showToast(`断点 JSON 无效：${error.message}`);
    els.breakpointsInput.value = "";
    return;
  }

  state.breakpointsFileName = file.name;
  state.breakpointsFilePath = file.path || file.name;
  state.breakpointsContent = text;
  els.breakpointsMeta.textContent = `断点文件：${state.breakpointsFilePath}`;
  els.analysisBreakpointsPath.textContent = state.breakpointsFilePath;
  updateAnalyzeButtonState();
  els.viewBreakpointsFile.classList.remove("hidden");
  showToast(`已加载断点文件：${file.name}`);
}

function clearBreakpointsFile() {
  state.breakpointsFileName = "";
  state.breakpointsFilePath = "";
  state.breakpointsContent = "";
  els.breakpointsMeta.textContent = "";
  els.analysisBreakpointsPath.textContent = "未选择断点文件。";
  els.breakpointsModalMeta.textContent = "未选择断点文件。";
  els.breakpointsModalBody.textContent = "";
  updateAnalyzeButtonState();
  els.viewBreakpointsFile.classList.add("hidden");
}

function updateAnalyzeButtonState() {
  els.analyzeButton.disabled = !state.breakpointsContent;
}

function toggleAnalysisPanel() {
  const collapsed = !els.content.classList.contains("analysis-collapsed");
  els.content.classList.toggle("analysis-collapsed", collapsed);
  els.toggleAnalysisPanel.setAttribute("aria-expanded", collapsed ? "false" : "true");
  els.toggleAnalysisPanel.setAttribute("aria-label", collapsed ? "展开后台分析" : "收起后台分析");
  els.toggleAnalysisPanel.title = collapsed ? "展开后台分析" : "收起后台分析";
  els.toggleAnalysisPanel.textContent = collapsed ? ">" : "<";
  scheduleVirtualRowsRender();
}

function applyFilter() {
  window.clearTimeout(filterTimer);
  const filterRules = getFilterRules();
  const matcher = createMatcher(filterRules, {
    regex: els.filterRegex.checked,
    caseSensitive: els.filterCase.checked,
  });
  const hasLevelFilter = state.selectedLevels.size > 0;
  const tagNeedles = state.tagFilters.map((value) => value.trim().toLowerCase()).filter(Boolean);

  state.visibleRows = state.rows.filter((row) => {
    if (matcher && !matcher(row.searchable)) return false;
    if (hasLevelFilter && !state.selectedLevels.has(row.level || "")) return false;
    if (tagNeedles.length && !tagNeedles.some((tagNeedle) => (row.tag || "").trim().toLowerCase() === tagNeedle)) return false;
    if (state.timeFilterStart != null && (row.timeValue == null || row.timeValue < state.timeFilterStart)) return false;
    if (state.timeFilterEnd != null && (row.timeValue == null || row.timeValue > state.timeFilterEnd)) return false;
    return true;
  });
  if (state.activeMarkedLine != null && !state.visibleRows.some((row) => row.sourceLine === state.activeMarkedLine)) {
    state.activeMarkedLine = null;
  }
  updateLogTableWidth(state.visibleRows);
  els.tableWrap.scrollTop = 0;
  clearSearchState();
  renderRows();
  updateMarkedLineJumpButtons();
  updateSaveFilteredButton();
}

function hasActiveMainFilter() {
  return Boolean(
      els.filterInput.value.trim() ||
      state.selectedLevels.size > 0 ||
      getActiveTagFilters().length > 0 ||
      state.timeFilterStart != null ||
      state.timeFilterEnd != null
  );
}

function updateSaveFilteredButton() {
  els.saveFiltered.disabled = !state.rows.length || !hasActiveMainFilter();
}

function updateLevelFilterOptions() {
  const levels = Array.from(new Set(state.rows.map((row) => row.level || "").filter(Boolean)));
  const order = ["V", "D", "I", "W", "E", "F"];
  levels.sort((a, b) => {
    const left = order.indexOf(a);
    const right = order.indexOf(b);
    if (left >= 0 || right >= 0) {
      return (left >= 0 ? left : order.length) - (right >= 0 ? right : order.length);
    }
    return a.localeCompare(b);
  });

  els.levelFilterPopover.textContent = "";
  if (!levels.length) {
    const empty = document.createElement("div");
    empty.className = "level-filter-empty";
    empty.textContent = "无级别";
    els.levelFilterPopover.append(empty);
  } else {
    for (const level of levels) {
      const label = document.createElement("label");
      label.className = "level-filter-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = level;
      checkbox.checked = state.selectedLevels.has(level);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          state.selectedLevels.add(level);
        } else {
          state.selectedLevels.delete(level);
        }
        updateLevelFilterHeader();
        applyFilter();
      });
      const text = document.createElement("span");
      text.textContent = level;
      label.append(checkbox, text);
      els.levelFilterPopover.append(label);
    }
  }
  updateLevelFilterHeader();
}

function updateLevelFilterHeader() {
  const count = state.selectedLevels.size;
  els.levelFilterHeader.textContent = count ? `级别(${count})` : "级别";
  els.levelFilterHeader.classList.toggle("active", count > 0);
}

function toggleLevelFilterPopover(event) {
  event.stopPropagation();
  if (els.levelFilterPopover.classList.contains("hidden")) {
    updateLevelFilterOptions();
    positionLevelFilterPopover();
    els.levelFilterPopover.classList.remove("hidden");
  } else {
    closeLevelFilterPopover();
  }
}

function positionLevelFilterPopover() {
  const rect = els.levelFilterHeader.getBoundingClientRect();
  els.levelFilterPopover.style.left = `${Math.max(8, rect.left)}px`;
  els.levelFilterPopover.style.top = `${rect.bottom + 4}px`;
}

function closeLevelFilterPopover() {
  els.levelFilterPopover.classList.add("hidden");
}

function updateTimeFilterOptions() {
  const values = state.rows.map((row) => row.timeValue).filter((value) => Number.isFinite(value));
  els.timeFilterStartList.textContent = "";
  els.timeFilterEndList.textContent = "";
  if (!values.length) {
    state.timeFilterPoints = [];
    renderEmptyTimeFilterLists();
    return;
  }

  const sortedValues = values.slice().sort((left, right) => left - right);
  state.timeFilterPoints = Array.from(new Set(Array.from({ length: 21 }, (_, index) => {
    const valueIndex = Math.round((sortedValues.length - 1) * index / 20);
    return Math.floor(sortedValues[valueIndex] / 1000) * 1000;
  })));

  renderTimeFilterLists();
}

function renderEmptyTimeFilterLists() {
  for (const list of [els.timeFilterStartList, els.timeFilterEndList]) {
    const empty = document.createElement("div");
    empty.className = "time-filter-empty";
    empty.textContent = "无时间";
    list.append(empty);
  }
}

function renderTimeFilterLists() {
  els.timeFilterStartList.textContent = "";
  els.timeFilterEndList.textContent = "";
  renderTimeFilterList(els.timeFilterStartList, "start");
  renderTimeFilterList(els.timeFilterEndList, "end");
}

function renderTimeFilterList(list, type) {
  list.append(createTimeFilterRow("不限", null, type));
  for (const value of state.timeFilterPoints) {
    list.append(createTimeFilterRow(formatLogTimeValue(value), value, type));
  }
}

function createTimeFilterRow(label, value, type) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "time-filter-row";
  button.classList.toggle("start-selected", state.draftTimeFilterStart === value && value != null);
  button.classList.toggle("end-selected", state.draftTimeFilterEnd === value && value != null);
  button.classList.toggle("unlimited-selected", value == null && (type === "start" ? state.draftTimeFilterStart == null : state.draftTimeFilterEnd == null));
  button.textContent = formatTimeOptionLabel(value, label);
  button.addEventListener("click", () => updateDraftTimeFilter(type, value == null ? "" : String(value)));
  return button;
}

function formatTimeOptionLabel(value, label) {
  const markers = [];
  if (value != null && state.draftTimeFilterStart === value) markers.push("起点");
  if (value != null && state.draftTimeFilterEnd === value) markers.push("终点");
  return markers.length ? `✓ ${markers.join("/")} ${label}` : label;
}

function formatLogTimeValue(value) {
  const date = new Date(value);
  const pad = (number, size = 2) => String(number).padStart(size, "0");
  return `${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function updateTimeFilterHeader() {
  const active = state.timeFilterStart != null || state.timeFilterEnd != null;
  els.timeFilterHeader.textContent = active ? "时间(1)" : "时间";
  els.timeFilterHeader.classList.toggle("active", active);
}

function toggleTimeFilterPopover(event) {
  event.stopPropagation();
  if (els.timeFilterPopover.classList.contains("hidden")) {
    state.draftTimeFilterStart = state.timeFilterStart == null ? null : Math.floor(state.timeFilterStart / 1000) * 1000;
    state.draftTimeFilterEnd = state.timeFilterEnd == null ? null : Math.floor(state.timeFilterEnd / 1000) * 1000;
    updateTimeFilterOptions();
    positionTimeFilterPopover();
    els.timeFilterPopover.classList.remove("hidden");
  } else {
    closeTimeFilterPopover();
  }
}

function positionTimeFilterPopover() {
  const rect = els.timeFilterHeader.getBoundingClientRect();
  els.timeFilterPopover.style.left = `${Math.max(8, rect.left)}px`;
  els.timeFilterPopover.style.top = `${rect.bottom + 4}px`;
}

function closeTimeFilterPopover() {
  els.timeFilterPopover.classList.add("hidden");
}

function updateDraftTimeFilter(which, value) {
  const nextValue = value ? Number(value) : null;
  if (nextValue != null && which === "start" && state.draftTimeFilterEnd === nextValue) {
    showToast("起点和终点不能选择同一个时间点。");
    return;
  }
  if (nextValue != null && which === "end" && state.draftTimeFilterStart === nextValue) {
    showToast("起点和终点不能选择同一个时间点。");
    return;
  }
  if (which === "start") {
    state.draftTimeFilterStart = nextValue;
  } else {
    state.draftTimeFilterEnd = nextValue;
  }
  renderTimeFilterLists();
}

function confirmTimeFilter() {
  const start = state.draftTimeFilterStart;
  const end = state.draftTimeFilterEnd;
  state.timeFilterStart = start != null && end != null ? Math.min(start, end) : start;
  const normalizedEnd = start != null && end != null ? Math.max(start, end) : end;
  state.timeFilterEnd = normalizedEnd == null ? null : normalizedEnd + 999;
  updateTimeFilterHeader();
  applyFilter();
  closeTimeFilterPopover();
}

function clearTimeFilter() {
  state.timeFilterStart = null;
  state.timeFilterEnd = null;
  state.draftTimeFilterStart = null;
  state.draftTimeFilterEnd = null;
  updateTimeFilterOptions();
  updateTimeFilterHeader();
  applyFilter();
}

function updateTagFilterHeader() {
  const count = getActiveTagFilters().length;
  els.tagFilterHeader.textContent = count ? `Tag(${count})` : "Tag";
  els.tagFilterHeader.classList.toggle("active", count > 0);
}

function toggleTagFilterPopover(event) {
  event.stopPropagation();
  if (els.tagFilterPopover.classList.contains("hidden")) {
    state.draftTagFilters = state.tagFilters.slice();
    renderTagFilterInputs();
    positionTagFilterPopover();
    els.tagFilterPopover.classList.remove("hidden");
    window.requestAnimationFrame(() => els.tagFilterInputs.querySelector("input")?.focus());
  } else {
    closeTagFilterPopover();
  }
}

function positionTagFilterPopover() {
  const rect = els.tagFilterHeader.getBoundingClientRect();
  els.tagFilterPopover.style.left = `${Math.max(8, rect.left)}px`;
  els.tagFilterPopover.style.top = `${rect.bottom + 4}px`;
}

function closeTagFilterPopover() {
  els.tagFilterPopover.classList.add("hidden");
}

function getActiveTagFilters() {
  return state.tagFilters.map((value) => value.trim()).filter(Boolean);
}

function renderTagFilterInputs() {
  els.tagFilterInputs.textContent = "";
  if (!state.draftTagFilters.length) {
    state.draftTagFilters = [""];
  }

  state.draftTagFilters.forEach((value, index) => {
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = "输入 Tag";
    input.value = value;
    input.addEventListener("input", () => updateTagFilterAt(index, input.value));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeTagFilterPopover();
    });
    els.tagFilterInputs.append(input);
  });
}

function updateTagFilterAt(index, value) {
  state.draftTagFilters[index] = value;
}

function addTagFilter() {
  state.draftTagFilters.push("");
  renderTagFilterInputs();
  window.requestAnimationFrame(() => els.tagFilterInputs.querySelector("input:last-child")?.focus());
}

function confirmTagFilter() {
  state.tagFilters = state.draftTagFilters.slice();
  updateTagFilterHeader();
  applyFilter();
  closeTagFilterPopover();
}

function clearTagFilter() {
  state.draftTagFilters = [""];
  state.tagFilters = [""];
  renderTagFilterInputs();
  updateTagFilterHeader();
  applyFilter();
}

function scheduleFilter() {
  window.clearTimeout(filterTimer);
  filterTimer = window.setTimeout(applyFilter, 500);
}

function createMatcher(rules, options) {
  if (!rules.length) return null;
  if (options.regex) {
    try {
      const flags = options.caseSensitive ? "" : "i";
      const regexes = rules.map((rule) => new RegExp(rule, flags));
      return (value) => regexes.some((regex) => regex.test(value));
    } catch (error) {
      showToast(`正则表达式无效：${error.message}`);
      return null;
    }
  }

  const needles = options.caseSensitive ? rules : rules.map((rule) => rule.toLowerCase());
  return (value) => {
    const haystack = options.caseSensitive ? value : value.toLowerCase();
    return needles.some((needle) => haystack.includes(needle));
  };
}

function renderRows() {
  renderVirtualRows();
  updateMatchStatus();
}

function renderVirtualRows() {
  const rows = state.visibleRows;
  const viewportHeight = els.tableWrap.clientHeight || 1;
  const scrollTop = els.tableWrap.scrollTop;
  const start = Math.max(0, Math.floor(scrollTop / LOG_ROW_HEIGHT) - LOG_OVERSCAN_ROWS);
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / LOG_ROW_HEIGHT) + LOG_OVERSCAN_ROWS);
  const filterRules = getFilterRules();
  state.virtualStart = start;
  state.virtualEnd = end;

  const fragment = document.createDocumentFragment();
  els.logBody.textContent = "";

  if (start > 0) {
    fragment.appendChild(spacerRow(start * LOG_ROW_HEIGHT));
  }

  for (let index = start; index < end; index += 1) {
    fragment.appendChild(createLogRow(rows[index], getMainRowHighlight(rows[index], filterRules), index, "main"));
  }

  const bottomRows = rows.length - end;
  if (bottomRows > 0) {
    fragment.appendChild(spacerRow(bottomRows * LOG_ROW_HEIGHT));
  }

  els.logBody.appendChild(fragment);
}

function getMainRowHighlight(row, filterRules) {
  if (state.activeSearch) {
    return { query: state.activeSearch, regex: false, caseSensitive: false };
  }
  const matchedRule = findMatchingFilterRule(row, filterRules);
  if (!matchedRule) return "";
  return {
    query: matchedRule,
    regex: els.filterRegex.checked,
    caseSensitive: els.filterCase.checked,
  };
}

function getFilterRules() {
  return els.filterInput.value
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function findMatchingFilterRule(row, filterRules) {
  if (!filterRules.length) return "";
  if (els.filterRegex.checked) {
    const flags = els.filterCase.checked ? "" : "i";
    for (const rule of filterRules) {
      try {
        if (new RegExp(rule, flags).test(row.searchable)) return rule;
      } catch {
        return "";
      }
    }
    return "";
  }
  const haystack = els.filterCase.checked ? row.searchable : row.searchable.toLowerCase();
  return filterRules.find((rule) => haystack.includes(els.filterCase.checked ? rule : rule.toLowerCase())) || "";
}

function spacerRow(height) {
  const tr = document.createElement("tr");
  tr.className = "virtual-spacer-row";
  tr.setAttribute("aria-hidden", "true");
  const td = document.createElement("td");
  td.colSpan = 5;
  td.style.height = `${height}px`;
  tr.append(td);
  return tr;
}

function createLogRow(row, activeSearch, visibleIndex, context) {
  const tr = document.createElement("tr");
  tr.dataset.line = String(row.sourceLine);
  tr.title = "双击复制当前行";
  if (state.markedLines.has(row.sourceLine)) {
    tr.classList.add("marked-row");
  }
  if (state.activeMarkedLine === row.sourceLine) {
    tr.classList.add("active-match");
  }
  if (context === "main" && state.activeMatch >= 0 && state.matches[state.activeMatch] === visibleIndex) {
    tr.classList.add("active-match");
  }

  const lineCell = cell(row.sourceLine, "line-col");
  lineCell.title = "点击标记或取消标记当前行";
  lineCell.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMarkedLine(row.sourceLine);
  });
  tr.append(
    lineCell,
    cell(highlight(row.time, activeSearch), "time-col"),
    cell(row.level, `level-col level-${row.level || "none"}`),
    cell(highlight(row.tag, activeSearch), "tag-col"),
    cell(highlight(row.message, activeSearch), "message-col")
  );
  if (shouldOpenContextOnClick(context)) {
    tr.addEventListener("mousedown", () => {
      suppressNextLogRowClick = hasSelectedText();
    });
    tr.addEventListener("click", () => scheduleLogRowClick(row));
  }
  tr.addEventListener("dblclick", () => {
    cancelPendingLogRowClick();
    copyLine(row.raw);
  });
  return tr;
}

function shouldOpenContextOnClick(context) {
  return (context === "main" && els.filterInput.value.trim()) || context === "search-modal";
}

function scheduleLogRowClick(row) {
  cancelPendingLogRowClick();
  if (suppressNextLogRowClick || clearSelectedText()) {
    suppressNextLogRowClick = false;
    return;
  }
  pendingLogRowClickTimer = window.setTimeout(() => {
    pendingLogRowClickTimer = 0;
    openLogContext(row);
  }, 500);
}

function scheduleAnalysisLogRowClick(lineNumber) {
  const row = findRowBySourceLine(Number(lineNumber));
  if (!row) return;
  scheduleLogRowClick(row);
}

function cancelPendingLogRowClick() {
  if (!pendingLogRowClickTimer) return;
  window.clearTimeout(pendingLogRowClickTimer);
  pendingLogRowClickTimer = 0;
}

function clearSelectedText() {
  if (!hasSelectedText()) return false;
  const selection = window.getSelection();
  if (selection) selection.removeAllRanges();
  return true;
}

function hasSelectedText() {
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString());
}

function findRowBySourceLine(sourceLine) {
  if (!Number.isFinite(sourceLine)) return null;
  return state.rows.find((row) => row.sourceLine === sourceLine) || state.rows[sourceLine - 1] || null;
}

function updateLogTableWidth(rows) {
  let longestMessage = "";
  for (const row of rows) {
    if ((row.message || "").length > longestMessage.length) {
      longestMessage = row.message || "";
    }
  }

  const messageWidth = Math.max(720, Math.ceil(measureLogTextWidth(longestMessage)) + 32);
  for (const table of [els.logTable, els.contextLogTable]) {
    if (!table) continue;
    table.style.setProperty("--message-col-width", `${messageWidth}px`);
    table.style.minWidth = `${LOG_FIXED_COLUMNS_WIDTH + messageWidth + 96}px`;
  }
}

function measureLogTextWidth(text) {
  if (!text) return 0;
  try {
    return measureNaturalWidth(prepare(text, LOG_TEXT_FONT));
  } catch {
    return text.length * 7.2;
  }
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

function highlight(value, highlightSpec) {
  const span = document.createElement("span");
  const text = value || "";
  const spec = normalizeHighlightSpec(highlightSpec);
  const query = spec.query;
  if (!query) {
    span.textContent = text;
    return span;
  }

  if (spec.regex) {
    try {
      const flags = spec.caseSensitive ? "g" : "gi";
      const regex = new RegExp(query, flags);
      let cursor = 0;
      let match = regex.exec(text);
      while (match) {
        const matchedText = match[0];
        if (!matchedText) break;
        span.append(document.createTextNode(text.slice(cursor, match.index)));
        const mark = document.createElement("mark");
        mark.textContent = matchedText;
        span.append(mark);
        cursor = match.index + matchedText.length;
        match = regex.exec(text);
      }
      span.append(document.createTextNode(text.slice(cursor)));
      return span;
    } catch {
      span.textContent = text;
      return span;
    }
  }

  const lowerText = spec.caseSensitive ? text : text.toLowerCase();
  const lowerQuery = spec.caseSensitive ? query : query.toLowerCase();
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

function normalizeHighlightSpec(highlightSpec) {
  if (!highlightSpec) return { query: "", regex: false, caseSensitive: false };
  if (typeof highlightSpec === "string") {
    return { query: highlightSpec, regex: false, caseSensitive: false };
  }
  return {
    query: highlightSpec.query || "",
    regex: Boolean(highlightSpec.regex),
    caseSensitive: Boolean(highlightSpec.caseSensitive),
  };
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

function renderRowsInto(target, rows, activeSearch) {
  const fragment = document.createDocumentFragment();
  target.textContent = "";
  const rowContext = state.searchModalCanOpenContext ? "search-modal" : "modal";

  for (const row of rows) {
    fragment.appendChild(createLogRow(row, activeSearch, -1, rowContext));
  }

  target.appendChild(fragment);
}

function toggleMarkedLine(sourceLine) {
  if (state.markedLines.has(sourceLine)) {
    state.markedLines.delete(sourceLine);
    if (state.activeMarkedLine === sourceLine) {
      state.activeMarkedLine = null;
    }
  } else {
    state.markedLines.add(sourceLine);
    state.activeMarkedLine = sourceLine;
  }
  updateMarkedLineJumpButtons();
  if (state.activeSearch) {
    runSearch();
  } else {
    renderRows();
  }
  if (!els.searchModal.classList.contains("hidden")) {
    if (els.searchModalTitle.textContent === "已标记行") {
      state.searchResultRows = state.rows.filter((row) => state.markedLines.has(row.sourceLine));
      els.searchModalMeta.textContent = `${state.fileName || "log"} · ${state.searchResultRows.length.toLocaleString()} 行已标记`;
      if (!state.searchResultRows.length) {
        closeSearchModal();
        return;
      }
    }
    renderRowsInto(els.searchResultBody, state.searchResultRows, state.modalActiveSearch);
    state.modalMatches = [];
    state.modalActiveMatch = -1;
    state.modalSearchDirty = Boolean(state.modalActiveSearch);
    updateModalMatchStatus();
  }
}

function getVisibleMarkedRows() {
  return state.visibleRows.filter((row) => state.markedLines.has(row.sourceLine));
}

function goMarkedLine(direction) {
  const markedRows = getVisibleMarkedRows();
  if (!markedRows.length) return;

  const currentIndex = state.activeMarkedLine == null
    ? -1
    : markedRows.findIndex((row) => row.sourceLine === state.activeMarkedLine);
  const nextIndex = currentIndex < 0
    ? (direction > 0 ? 0 : markedRows.length - 1)
    : (currentIndex + direction + markedRows.length) % markedRows.length;
  const targetRow = markedRows[nextIndex];
  const visibleIndex = state.visibleRows.indexOf(targetRow);
  if (visibleIndex < 0) return;

  state.activeMarkedLine = targetRow.sourceLine;
  scrollMainRowIndexIntoView(visibleIndex);
  renderRows();
  updateMarkedLineJumpButtons();
}

function updateMarkedLineJumpButtons() {
  const hasMarkedRows = getVisibleMarkedRows().length > 0;
  for (const button of [els.prevMarkedLine, els.nextMarkedLine]) {
    if (!button) continue;
    button.disabled = !hasMarkedRows;
    button.classList.toggle("available", hasMarkedRows);
  }
  els.openMarkedRows.disabled = state.markedLines.size === 0;
}

function runSearch() {
  const query = els.searchInput.value.trim();
  state.matches = [];
  state.activeMatch = -1;
  state.activeSearch = query;
  state.searchDirty = false;
  state.matches = findMatchingRows(query).map(({ index }) => index);
  renderRows();
  updateMatchStatus();
}

function goMatch(direction) {
  if (state.searchDirty || state.activeSearch !== els.searchInput.value.trim()) {
    runSearch();
  }
  if (!state.matches.length) return;
  state.activeMatch = (state.activeMatch + direction + state.matches.length) % state.matches.length;
  scrollMainRowIndexIntoView(state.matches[state.activeMatch]);
  renderRows();
  updateMatchStatus();
}

function scrollMainRowIndexIntoView(index) {
  const viewportHeight = els.tableWrap.clientHeight || 0;
  const targetTop = Math.max(0, index * LOG_ROW_HEIGHT - Math.max(0, viewportHeight - LOG_ROW_HEIGHT) / 2);
  els.tableWrap.scrollTop = targetTop;
}

function openLogContext(row) {
  if (!state.rows.length) return;
  const index = state.rows.indexOf(row);
  state.contextActiveIndex = index >= 0 ? index : Math.max(0, Math.min(state.rows.length - 1, row.sourceLine - 1));
  els.contextModalMeta.textContent = `${state.fileName || "日志"} · 第 ${row.sourceLine} 行 · 前后 ${LOG_CONTEXT_RADIUS} 行`;
  els.contextLogBody.textContent = "";
  els.contextModal.classList.remove("hidden");
  window.requestAnimationFrame(prepareContextRowsForCentering);
}

function closeContextModal() {
  cancelPendingLogRowClick();
  els.contextModal.classList.add("hidden");
}

function centerContextTargetRow() {
  const viewportHeight = els.contextTableWrap.clientHeight || els.contextTableWrap.getBoundingClientRect().height || 0;
  if (!viewportHeight) {
    window.requestAnimationFrame(prepareContextRowsForCentering);
    return;
  }

  const targetTop = state.contextActiveIndex * LOG_ROW_HEIGHT;
  const centeredTop = targetTop - Math.max(0, viewportHeight - LOG_ROW_HEIGHT) / 2;
  const maxTop = Math.max(0, state.rows.length * LOG_ROW_HEIGHT - viewportHeight);
  els.contextTableWrap.scrollTop = Math.max(0, Math.min(centeredTop, maxTop));
  renderContextRows();
}

function prepareContextRowsForCentering() {
  const viewportHeight = els.contextTableWrap.clientHeight || els.contextTableWrap.getBoundingClientRect().height || 0;
  if (!viewportHeight) {
    window.requestAnimationFrame(prepareContextRowsForCentering);
    return;
  }
  renderContextRows();
  window.requestAnimationFrame(centerContextTargetRow);
}

function renderContextRows() {
  const rows = state.rows;
  const viewportHeight = els.contextTableWrap.clientHeight || 1;
  const scrollTop = els.contextTableWrap.scrollTop;
  const start = Math.max(0, Math.floor(scrollTop / LOG_ROW_HEIGHT) - LOG_OVERSCAN_ROWS);
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / LOG_ROW_HEIGHT) + LOG_OVERSCAN_ROWS);
  state.contextVirtualStart = start;
  state.contextVirtualEnd = end;

  const fragment = document.createDocumentFragment();
  els.contextLogBody.textContent = "";

  if (start > 0) {
    fragment.appendChild(spacerRow(start * LOG_ROW_HEIGHT));
  }

  for (let index = start; index < end; index += 1) {
    fragment.appendChild(createContextLogRow(rows[index], index));
  }

  const bottomRows = rows.length - end;
  if (bottomRows > 0) {
    fragment.appendChild(spacerRow(bottomRows * LOG_ROW_HEIGHT));
  }

  els.contextLogBody.appendChild(fragment);
}

function createContextLogRow(row, index) {
  const tr = createLogRow(row, "", index, "context");
  if (index === state.contextActiveIndex) {
    tr.classList.add("context-target-row");
  }
  return tr;
}

async function openSearchResults() {
  const query = els.searchInput.value.trim();
  if (!query) {
    showToast("请先输入搜索关键字。");
    return;
  }

  const rows = findMatchingRows(query).map(({ row }) => row);
  if (!rows.length) {
    showToast(`没有找到匹配项：${query}`);
    return;
  }

  state.searchResultRows = rows;
  state.searchModalCanOpenContext = true;
  els.searchModalTitle.textContent = "搜索结果";
  state.modalMatches = [];
  state.modalActiveMatch = -1;
  state.modalActiveSearch = "";
  state.modalSearchDirty = false;
  els.modalSearchInput.value = "";
  els.clearMarkedRows.classList.add("hidden");
  els.searchModalMeta.textContent = `${state.fileName || "log"} · 搜索：${query} · ${rows.length.toLocaleString()} 个匹配`;
  renderRowsInto(els.searchResultBody, rows, query);
  updateModalMatchStatus();
  els.searchModal.classList.remove("hidden");
}

function openMarkedRows() {
  const rows = state.rows.filter((row) => state.markedLines.has(row.sourceLine));
  if (!rows.length) {
    showToast("没有已标记行。");
    return;
  }

  state.searchResultRows = rows;
  state.searchModalCanOpenContext = false;
  els.searchModalTitle.textContent = "已标记行";
  els.searchModalMeta.textContent = `${state.fileName || "log"} · ${rows.length.toLocaleString()} 行已标记`;
  state.modalMatches = [];
  state.modalActiveMatch = -1;
  state.modalActiveSearch = "";
  state.modalSearchDirty = false;
  els.modalSearchInput.value = "";
  els.clearMarkedRows.classList.remove("hidden");
  renderRowsInto(els.searchResultBody, rows, "");
  updateModalMatchStatus();
  els.searchModal.classList.remove("hidden");
}

function closeSearchModal() {
  state.searchModalCanOpenContext = false;
  els.searchModal.classList.add("hidden");
  els.clearMarkedRows.classList.add("hidden");
}

function saveSearchResults() {
  if (!state.searchResultRows.length) return;
  const content = formatRowsForSave(state.searchResultRows);
  const suffix = els.searchModalTitle.textContent === "已标记行" ? "marked" : "search";
  downloadText(content, `${state.fileName || "log"}.${suffix}.txt`);
}

function clearMarkedRows() {
  if (!state.markedLines.size) return;
  if (!window.confirm("确认清除所有标记行吗？")) return;

  state.markedLines.clear();
  state.activeMarkedLine = null;
  state.searchResultRows = [];
  closeSearchModal();
  renderRows();
  updateMarkedLineJumpButtons();
  showToast("已清除标记行。");
}

function markModalSearchDirty() {
  state.modalSearchDirty = true;
  state.modalMatches = [];
  state.modalActiveMatch = -1;
  state.modalActiveSearch = "";
  updateModalMatchStatus();
}

function findModalMatchingRows(query) {
  const lowerQuery = query.trim().toLowerCase();
  if (!lowerQuery) return [];
  return state.searchResultRows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.searchable.toLowerCase().includes(lowerQuery));
}

function runModalSearch() {
  const query = els.modalSearchInput.value.trim();
  state.modalMatches = [];
  state.modalActiveMatch = -1;
  state.modalActiveSearch = query;
  state.modalSearchDirty = false;
  renderRowsInto(els.searchResultBody, state.searchResultRows, query);

  const renderedRows = Array.from(els.searchResultBody.querySelectorAll("tr"));
  state.modalMatches = findModalMatchingRows(query).map(({ index }) => renderedRows[index]);
  updateModalMatchStatus();
}

function goModalMatch(direction) {
  if (state.modalSearchDirty || state.modalActiveSearch !== els.modalSearchInput.value.trim()) {
    runModalSearch();
  }
  if (!state.modalMatches.length) return;
  if (state.modalActiveMatch >= 0) {
    state.modalMatches[state.modalActiveMatch].classList.remove("active-match");
  }
  state.modalActiveMatch = (state.modalActiveMatch + direction + state.modalMatches.length) % state.modalMatches.length;
  const row = state.modalMatches[state.modalActiveMatch];
  row.classList.add("active-match");
  row.scrollIntoView({ block: "center", inline: "nearest" });
  updateModalMatchStatus();
}

function updateModalMatchStatus() {
  const visible = `${state.searchResultRows.length.toLocaleString()} 行`;
  if (state.modalSearchDirty) {
    els.modalMatchStatus.textContent = `搜索待执行 · ${visible}`;
    return;
  }
  if (!state.modalMatches.length) {
    els.modalMatchStatus.textContent = `0 个匹配 · ${visible}`;
    return;
  }
  const current = state.modalActiveMatch < 0 ? 0 : state.modalActiveMatch + 1;
  els.modalMatchStatus.textContent = `${current}/${state.modalMatches.length} 个匹配 · ${visible}`;
}

async function copyLine(line) {
  await navigator.clipboard.writeText(line);
  showToast(`已复制：${line.slice(0, 120)}`);
}

function saveFiltered() {
  const content = formatRowsForSave(state.visibleRows);
  const base = state.fileName ? state.fileName.replace(/\.[^.]+$/, "") : "mylogger";
  downloadText(content, `${base}.filtered.txt`);
}

function formatRowsForSave(rows) {
  return rows.map((row) => `${row.sourceLine}: ${row.raw}`).join("\n");
}

function downloadText(content, filename) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({
    url,
    filename,
    saveAs: true,
  }, () => URL.revokeObjectURL(url));
}

function openAnalysisModal(resultText, metaText) {
  els.analysisModalMeta.textContent = metaText;
  state.analysisModalText = resultText;
  try {
    state.analysisModalData = JSON.parse(resultText);
  } catch {
    state.analysisModalData = null;
  }
  state.analysisModalMatches = [];
  state.analysisModalActiveMatch = -1;
  state.analysisModalSearch = "";
  els.analysisModalSearchInput.value = "";
  renderAnalysisModalText("");
  updateAnalysisModalMatchStatus();
  els.analysisModal.classList.remove("hidden");
}

function closeAnalysisModal() {
  els.analysisModal.classList.add("hidden");
}

function openBreakpointsModal() {
  if (!state.breakpointsContent) {
    showToast("未选择断点文件。");
    return;
  }
  els.breakpointsModalMeta.textContent = `${state.breakpointsFileName || "断点文件"} · ${state.breakpointsContent.length.toLocaleString()} 字符`;
  els.breakpointsModalBody.textContent = state.breakpointsContent;
  els.breakpointsModal.classList.remove("hidden");
}

function closeBreakpointsModal() {
  els.breakpointsModal.classList.add("hidden");
}

function openHelpModal() {
  els.helpModal.classList.remove("hidden");
}

function closeHelpModal() {
  els.helpModal.classList.add("hidden");
}

async function openToolsPage() {
  try {
    const [toolsResponse, qrcodeResponse] = await Promise.all([
      fetch(chrome.runtime.getURL(TOOLS_PAGE_PATH)),
      fetch(chrome.runtime.getURL(QRCODE_SCRIPT_PATH)),
    ]);
    if (!toolsResponse.ok) throw new Error(`读取工具页失败：${toolsResponse.status}`);
    if (!qrcodeResponse.ok) throw new Error(`读取二维码脚本失败：${qrcodeResponse.status}`);

    const [toolsHtml, qrcodeScript] = await Promise.all([toolsResponse.text(), qrcodeResponse.text()]);
    const packagedHtml = toolsHtml
      .replace(
        "<!-- MYLOGGER_QRCODE_SCRIPT -->",
        `<script>${qrcodeScript}\n<\/script>`
      );
    const toolsUrl = URL.createObjectURL(new Blob([packagedHtml], { type: "text/html;charset=utf-8" }));
    if (chrome.tabs?.create) {
      chrome.tabs.create({ url: toolsUrl }, () => {
        if (chrome.runtime.lastError) window.open(toolsUrl, "_blank", "noopener");
        window.setTimeout(() => URL.revokeObjectURL(toolsUrl), 60_000);
      });
      return;
    }
    window.open(toolsUrl, "_blank", "noopener");
    window.setTimeout(() => URL.revokeObjectURL(toolsUrl), 60_000);
  } catch (error) {
    showToast(error.message || "打开实用工具失败。");
  }
}

function renderAnalysisModalText(query) {
  els.analysisModalBody.textContent = "";
  const data = state.analysisModalData;
  const breakpoints = data && typeof data === "object" ? data.breakpoints : null;
  if (breakpoints && typeof breakpoints === "object") {
    renderBreakpointAnalysis(breakpoints, query);
    return;
  }

  renderPlainAnalysisText(query);
}

function renderPlainAnalysisText(query) {
  const text = state.analysisModalText || "";
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    els.analysisModalBody.textContent = text;
    state.analysisModalMatches = [];
    state.analysisModalActiveMatch = -1;
    state.analysisModalSearch = "";
    return;
  }

  const fragment = document.createDocumentFragment();
  const lowerText = text.toLowerCase();
  const lowerQuery = trimmedQuery.toLowerCase();
  const matches = [];
  let cursor = 0;

  while (true) {
    const index = lowerText.indexOf(lowerQuery, cursor);
    if (index < 0) break;
    fragment.append(document.createTextNode(text.slice(cursor, index)));
    const mark = document.createElement("mark");
    mark.className = "analysis-modal-match";
    mark.textContent = text.slice(index, index + trimmedQuery.length);
    matches.push(mark);
    fragment.append(mark);
    cursor = index + trimmedQuery.length;
  }

  fragment.append(document.createTextNode(text.slice(cursor)));
  els.analysisModalBody.appendChild(fragment);
  state.analysisModalMatches = matches;
  state.analysisModalActiveMatch = -1;
  state.analysisModalSearch = trimmedQuery;
}

function renderBreakpointAnalysis(breakpoints, query) {
  const trimmedQuery = query.trim();
  const matches = [];
  const logStrings = Array.isArray(breakpoints.logStrings)
    ? breakpoints.logStrings.filter((value) => typeof value === "string" && value)
    : [];
  const matchedLogs = Array.isArray(breakpoints.matchedLogs) ? breakpoints.matchedLogs : [];
  const matchedByLogString = new Map();
  for (const group of matchedLogs) {
    if (!group || typeof group.logString !== "string") continue;
    matchedByLogString.set(group.logString, Array.isArray(group.matches) ? group.matches : []);
  }
  const totalMatches = matchedLogs.reduce((sum, group) => {
    return sum + (Array.isArray(group.matches) ? group.matches.length : 0);
  }, 0);

  const split = document.createElement("div");
  split.className = "analysis-split";
  const left = createAnalysisPane("过滤日志", `${logStrings.length.toLocaleString()} 条`, { collapsible: true });
  const right = createAnalysisPane("相关日志", `${totalMatches.toLocaleString()} 行`);

  const leftBody = left.querySelector(".analysis-pane-body");
  const rightBody = right.querySelector(".analysis-pane-body");

  if (!logStrings.length) {
    const empty = document.createElement("div");
    empty.className = "analysis-empty";
    empty.textContent = breakpoints.error ? `${breakpoints.error}: ${breakpoints.message || ""}` : "没有提取到断点日志字符串。";
    leftBody.append(empty);
  } else {
    logStrings.forEach((logString, index) => {
      const row = document.createElement("div");
      row.className = "analysis-log-string";
      const indexEl = document.createElement("span");
      indexEl.className = "analysis-index";
      indexEl.textContent = String(index + 1);
      const code = document.createElement("code");
      appendHighlightedText(code, logString, trimmedQuery, matches);
      row.append(indexEl, code);
      row.title = "双击复制当前行";
      row.addEventListener("dblclick", () => copyLine(logString));
      leftBody.append(row);
    });
  }

  const rightGroups = logStrings.length
    ? logStrings.map((logString) => ({ logString, matches: matchedByLogString.get(logString) || [] }))
    : matchedLogs;

  let renderedRightRows = 0;
  if (!rightGroups.length) {
    const empty = document.createElement("div");
    empty.className = "analysis-empty";
    empty.textContent = "没有可展示的相关日志。";
    rightBody.append(empty);
  } else {
    for (const group of rightGroups) {
      const groupMatches = Array.isArray(group.matches) ? group.matches : [];
      const groupEl = document.createElement("section");
      groupEl.className = "analysis-match-group";

      for (const item of groupMatches) {
        const lineText = item && item.line ? String(item.line) : "";
        const row = document.createElement("div");
        row.className = "analysis-log-match-row";
        const lineNumber = document.createElement("span");
        lineNumber.className = "analysis-line-number";
        lineNumber.textContent = item && item.lineNumber ? String(item.lineNumber) : "-";
        const line = document.createElement("pre");
        line.className = "analysis-log-line";
        appendHighlightedText(line, lineText, trimmedQuery || group.logString || "", matches, {
          regex: !trimmedQuery && els.filterRegex.checked,
          caseSensitive: !trimmedQuery && els.filterCase.checked,
          trackMatches: Boolean(trimmedQuery),
        });
        row.append(lineNumber, line);
        row.title = "单击查看上下文，双击复制当前行";
        row.addEventListener("click", () => scheduleAnalysisLogRowClick(item && item.lineNumber));
        row.addEventListener("dblclick", () => {
          cancelPendingLogRowClick();
          copyLine(lineText);
        });
        groupEl.append(row);
        renderedRightRows += 1;
      }

      if (groupMatches.length) {
        rightBody.append(groupEl);
      }
    }

    if (!renderedRightRows) {
      const empty = document.createElement("div");
      empty.className = "analysis-empty";
      empty.textContent = "未在日志文件中找到相关日志。";
      rightBody.append(empty);
    }
  }

  split.append(left, right);
  els.analysisModalBody.append(split);
  state.analysisModalMatches = matches;
  state.analysisModalActiveMatch = -1;
  state.analysisModalSearch = trimmedQuery;
}

function createAnalysisPane(title, meta, options = {}) {
  const pane = document.createElement("section");
  pane.className = "analysis-pane";
  if (options.collapsible) pane.classList.add("analysis-pane-collapsible");
  const header = document.createElement("div");
  header.className = "analysis-pane-header";
  const titleEl = document.createElement("h3");
  titleEl.textContent = title;
  const metaEl = document.createElement("span");
  metaEl.textContent = meta;
  header.append(titleEl, metaEl);
  const body = document.createElement("div");
  body.className = "analysis-pane-body";
  if (options.collapsible) {
    const toggle = document.createElement("button");
    toggle.className = "analysis-pane-toggle";
    toggle.type = "button";
    toggle.title = "收起过滤日志";
    toggle.setAttribute("aria-label", "收起过滤日志");
    toggle.setAttribute("aria-expanded", "true");
    toggle.textContent = "<";
    toggle.addEventListener("click", () => toggleAnalysisResultPane(pane, toggle));
    pane.append(header, body, toggle);
  } else {
    pane.append(header, body);
  }
  return pane;
}

function toggleAnalysisResultPane(pane, toggle) {
  const split = pane.closest(".analysis-split");
  if (!split) return;
  const collapsed = !split.classList.contains("analysis-left-collapsed");
  split.classList.toggle("analysis-left-collapsed", collapsed);
  toggle.textContent = collapsed ? ">" : "<";
  toggle.title = collapsed ? "展开过滤日志" : "收起过滤日志";
  toggle.setAttribute("aria-label", collapsed ? "展开过滤日志" : "收起过滤日志");
  toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

function appendHighlightedText(target, text, query, matches, options = {}) {
  if (!query) {
    target.textContent = text;
    return;
  }
  const trackMatches = options.trackMatches !== false;
  if (options.regex) {
    try {
      const flags = options.caseSensitive ? "g" : "gi";
      const regex = new RegExp(query, flags);
      let cursor = 0;
      let match = regex.exec(text);
      while (match) {
        const matchedText = match[0];
        if (!matchedText) break;
        target.append(document.createTextNode(text.slice(cursor, match.index)));
        const mark = document.createElement("mark");
        mark.className = "analysis-modal-match";
        mark.textContent = matchedText;
        if (trackMatches) matches.push(mark);
        target.append(mark);
        cursor = match.index + matchedText.length;
        match = regex.exec(text);
      }
      target.append(document.createTextNode(text.slice(cursor)));
      return;
    } catch {
      target.textContent = text;
      return;
    }
  }

  const lowerText = options.caseSensitive ? text : text.toLowerCase();
  const lowerQuery = options.caseSensitive ? query : query.toLowerCase();
  let cursor = 0;
  while (true) {
    const index = lowerText.indexOf(lowerQuery, cursor);
    if (index < 0) break;
    target.append(document.createTextNode(text.slice(cursor, index)));
    const mark = document.createElement("mark");
    mark.className = "analysis-modal-match";
    mark.textContent = text.slice(index, index + query.length);
    if (trackMatches) matches.push(mark);
    target.append(mark);
    cursor = index + query.length;
  }
  target.append(document.createTextNode(text.slice(cursor)));
}

function runAnalysisModalSearch() {
  renderAnalysisModalText(els.analysisModalSearchInput.value);
  updateAnalysisModalMatchStatus();
}

function goAnalysisModalMatch(direction) {
  const query = els.analysisModalSearchInput.value.trim();
  if (query !== state.analysisModalSearch) {
    runAnalysisModalSearch();
  }
  if (!state.analysisModalMatches.length) return;
  if (state.analysisModalActiveMatch >= 0) {
    state.analysisModalMatches[state.analysisModalActiveMatch].classList.remove("active-analysis-match");
  }
  state.analysisModalActiveMatch =
    (state.analysisModalActiveMatch + direction + state.analysisModalMatches.length) % state.analysisModalMatches.length;
  const match = state.analysisModalMatches[state.analysisModalActiveMatch];
  match.classList.add("active-analysis-match");
  match.scrollIntoView({ block: "center", inline: "nearest" });
  updateAnalysisModalMatchStatus();
}

function updateAnalysisModalMatchStatus() {
  if (!state.analysisModalMatches.length) {
    els.analysisModalMatchStatus.textContent = "0 个匹配";
    return;
  }
  const current = state.analysisModalActiveMatch < 0 ? 0 : state.analysisModalActiveMatch + 1;
  els.analysisModalMatchStatus.textContent = `${current}/${state.analysisModalMatches.length} 个匹配`;
}

function saveAnalysisModal() {
  const content = getAnalysisRightPaneText() || state.analysisModalText || els.analysisModalBody.textContent || "";
  if (!content) {
    showToast("没有可保存的分析结果。");
    return;
  }
  const base = state.fileName ? state.fileName.replace(/\.[^.]+$/, "") : "mylogger";
  downloadText(content, `${sanitizeFilename(base)}.analysis.txt`);
}

function getAnalysisRightPaneText() {
  const panes = Array.from(els.analysisModalBody.querySelectorAll(".analysis-pane"));
  const rightPane = panes[1];
  if (!rightPane) return "";
  const rows = Array.from(rightPane.querySelectorAll(".analysis-log-match-row"));
  if (!rows.length) return rightPane.textContent.trim();
  return rows.map((row) => {
    const lineNumber = row.querySelector(".analysis-line-number")?.textContent.trim() || "-";
    const line = row.querySelector(".analysis-log-line")?.textContent || "";
    return `${lineNumber}: ${line}`;
  }).join("\n");
}

function sanitizeFilename(value) {
  return value.replace(/[\\/:*?"<>|]+/g, "_").trim() || "mylogger";
}

function setAnalysisServiceStatus(available) {
  els.analysisStatusButton.classList.toggle("available", available);
  els.analysisStatusButton.classList.toggle("unavailable", !available);
  const label = available ? "后台服务可用" : "后台服务不可用";
  els.analysisStatusButton.title = label;
  els.analysisStatusButton.setAttribute("aria-label", label);
}

async function checkAnalysisService() {
  const endpoint = els.analysisEndpoint.value.trim();
  if (!endpoint) {
    setAnalysisServiceStatus(false);
    return;
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(endpoint, {
      method: "OPTIONS",
      cache: "no-store",
      signal: controller.signal,
    });
    setAnalysisServiceStatus(response.ok);
  } catch {
    setAnalysisServiceStatus(false);
  } finally {
    window.clearTimeout(timeout);
  }
}

function scheduleAnalysisServiceCheck() {
  window.clearTimeout(analysisStatusTimer);
  analysisStatusTimer = window.setTimeout(checkAnalysisService, 500);
}

async function analyzeVisible() {
  const endpoint = els.analysisEndpoint.value.trim();
  if (!endpoint) {
    showToast("请填写分析服务地址。");
    return;
  }
  if (!state.breakpointsContent) {
    showToast("请先选择断点 JSON 文件。");
    els.breakpointsInput.click();
    return;
  }

  const payload = {
    breakpointsFileName: state.breakpointsFileName,
    breakpointsContent: state.breakpointsContent,
  };

  showToast("正在获取断点日志...");
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    const resultText = text || `HTTP ${response.status}`;
    els.filterInput.value = extractBreakpointLogText(resultText);
    applyFilter();
    showToast("已获取断点日志。");
  } catch (error) {
    showToast(`分析失败：${error.message}`);
  }
}

function filterLogsByBreakpointText() {
  const logStrings = getFilterRules();

  if (!logStrings.length) {
    showToast("请先获取或输入过滤关键字。");
    return;
  }

  const matchedLogs = logStrings.map((logString) => {
    const matches = [];
    for (const row of state.rows) {
      if (filterRuleMatchesRow(logString, row)) {
        matches.push({
          lineNumber: row.sourceLine,
          line: row.raw,
        });
      }
    }
    return { logString, matches };
  });

  const resultText = JSON.stringify({
    breakpoints: {
      logStrings,
      matchedLogs,
    },
  }, null, 2);
  const totalMatches = matchedLogs.reduce((sum, group) => sum + group.matches.length, 0);
  openAnalysisModal(resultText, `日志筛选 · ${logStrings.length.toLocaleString()} 条规则 · ${totalMatches.toLocaleString()} 行`);
}

function filterRuleMatchesRow(rule, row) {
  if (els.filterRegex.checked) {
    try {
      const flags = els.filterCase.checked ? "" : "i";
      return new RegExp(rule, flags).test(row.searchable);
    } catch {
      return false;
    }
  }
  const haystack = els.filterCase.checked ? row.searchable : row.searchable.toLowerCase();
  const needle = els.filterCase.checked ? rule : rule.toLowerCase();
  return haystack.includes(needle);
}

function extractBreakpointLogText(resultText) {
  try {
    const data = JSON.parse(resultText);
    const logStrings = data && data.breakpoints && Array.isArray(data.breakpoints.logStrings)
      ? data.breakpoints.logStrings.filter((value) => typeof value === "string" && value)
      : [];
    if (logStrings.length) {
      return logStrings.join("\n");
    }
  } catch {
    // Fall back to the raw backend response below.
  }
  return resultText;
}

function updateMatchStatus() {
  const visible = `${state.visibleRows.length.toLocaleString()} 行`;
  if (state.searchDirty) {
    els.matchStatus.textContent = `搜索待执行 · ${visible}`;
    return;
  }
  if (!state.matches.length) {
    els.matchStatus.textContent = `0 个匹配 · ${visible}`;
    return;
  }
  const current = state.activeMatch < 0 ? 0 : state.activeMatch + 1;
  els.matchStatus.textContent = `${current}/${state.matches.length} 个匹配 · ${visible}`;
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

function scrollMainLogTo(position) {
  const top = position === "bottom" ? els.tableWrap.scrollHeight : 0;
  els.tableWrap.scrollTo({ top, behavior: "smooth" });
}

function scheduleVirtualRowsRender() {
  if (virtualScrollFrame) return;
  virtualScrollFrame = window.requestAnimationFrame(() => {
    virtualScrollFrame = 0;
    renderVirtualRows();
  });
}

function scheduleContextRowsRender() {
  if (contextVirtualScrollFrame) return;
  contextVirtualScrollFrame = window.requestAnimationFrame(() => {
    contextVirtualScrollFrame = 0;
    renderContextRows();
  });
}

els.fileInput.addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (file) openFile(file);
});

els.breakpointsInput.addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (file) openBreakpointsFile(file);
});

els.viewBreakpointsFile.addEventListener("click", openBreakpointsModal);
els.toggleAnalysisPanel.addEventListener("click", toggleAnalysisPanel);
els.filterInput.addEventListener("input", scheduleFilter);
els.filterRegex.addEventListener("change", applyFilter);
els.filterCase.addEventListener("change", applyFilter);
els.timeFilterHeader.addEventListener("click", toggleTimeFilterPopover);
els.timeFilterHeader.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  toggleTimeFilterPopover(event);
});
els.timeFilterPopover.addEventListener("click", (event) => event.stopPropagation());
els.confirmTimeFilter.addEventListener("click", confirmTimeFilter);
els.clearTimeFilter.addEventListener("click", clearTimeFilter);
document.addEventListener("click", closeTimeFilterPopover);
els.levelFilterHeader.addEventListener("click", toggleLevelFilterPopover);
els.levelFilterHeader.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  toggleLevelFilterPopover(event);
});
els.levelFilterPopover.addEventListener("click", (event) => event.stopPropagation());
document.addEventListener("click", closeLevelFilterPopover);
els.tagFilterHeader.addEventListener("click", toggleTagFilterPopover);
els.tagFilterHeader.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  toggleTagFilterPopover(event);
});
els.tagFilterPopover.addEventListener("click", (event) => event.stopPropagation());
els.addTagFilter.addEventListener("click", addTagFilter);
els.confirmTagFilter.addEventListener("click", confirmTagFilter);
els.clearTagFilter.addEventListener("click", clearTagFilter);
document.addEventListener("click", closeTagFilterPopover);
els.searchInput.addEventListener("input", markSearchDirty);
els.analysisEndpoint.addEventListener("input", scheduleAnalysisServiceCheck);
els.analysisStatusButton.addEventListener("click", checkAnalysisService);
els.filterLogsButton.addEventListener("click", filterLogsByBreakpointText);
els.viewFilterResults.addEventListener("click", filterLogsByBreakpointText);
els.openToolsPage.addEventListener("click", openToolsPage);
els.openSearchResults.addEventListener("click", openSearchResults);
els.openMarkedRows.addEventListener("click", openMarkedRows);
els.closeSearchModal.addEventListener("click", closeSearchModal);
els.contextModal.addEventListener("click", (event) => {
  if (event.target === els.contextModal) closeContextModal();
});
els.closeContextModal.addEventListener("click", closeContextModal);
els.closeAnalysisModal.addEventListener("click", closeAnalysisModal);
els.closeBreakpointsModal.addEventListener("click", closeBreakpointsModal);
els.openHelpModal.addEventListener("click", openHelpModal);
els.closeHelpModal.addEventListener("click", closeHelpModal);
els.saveAnalysisModal.addEventListener("click", saveAnalysisModal);
els.analysisModalSearchInput.addEventListener("input", runAnalysisModalSearch);
els.analysisModalPrevMatch.addEventListener("click", () => goAnalysisModalMatch(-1));
els.analysisModalNextMatch.addEventListener("click", () => goAnalysisModalMatch(1));
els.saveSearchResults.addEventListener("click", saveSearchResults);
els.clearMarkedRows.addEventListener("click", clearMarkedRows);
els.modalSearchInput.addEventListener("input", markModalSearchDirty);
els.modalPrevMatch.addEventListener("click", () => goModalMatch(-1));
els.modalNextMatch.addEventListener("click", () => goModalMatch(1));
els.prevMarkedLine.addEventListener("click", () => goMarkedLine(-1));
els.nextMarkedLine.addEventListener("click", () => goMarkedLine(1));
els.tableWrap.addEventListener("scroll", scheduleVirtualRowsRender);
els.tableWrap.addEventListener("scroll", closeTimeFilterPopover);
els.tableWrap.addEventListener("scroll", closeLevelFilterPopover);
els.tableWrap.addEventListener("scroll", closeTagFilterPopover);
els.contextTableWrap.addEventListener("scroll", scheduleContextRowsRender);
els.scrollToTop.addEventListener("click", () => scrollMainLogTo("top"));
els.scrollToBottom.addEventListener("click", () => scrollMainLogTo("bottom"));
els.saveFiltered.addEventListener("click", saveFiltered);
els.analyzeButton.addEventListener("click", analyzeVisible);

checkAnalysisService();
window.setInterval(checkAnalysisService, 5000);

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

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.searchModal.classList.contains("hidden")) {
    closeSearchModal();
  }
  if (event.key === "Escape" && !els.contextModal.classList.contains("hidden")) {
    closeContextModal();
  }
  if (event.key === "Escape" && !els.analysisModal.classList.contains("hidden")) {
    closeAnalysisModal();
  }
  if (event.key === "Escape" && !els.breakpointsModal.classList.contains("hidden")) {
    closeBreakpointsModal();
  }
  if (event.key === "Escape" && !els.helpModal.classList.contains("hidden")) {
    closeHelpModal();
  }
});
