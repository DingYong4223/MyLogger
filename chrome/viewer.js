import { measureNaturalWidth, prepare } from "@chenglou/pretext";

const LOG_ROW_HEIGHT = 24;
const LOG_OVERSCAN_ROWS = 30;
const LOG_CONTEXT_RADIUS = 50;
const ANALYSIS_ROW_HEIGHT = 18;
const LOG_TEXT_FONT = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
const TOOLS_PAGE_PATH = "mytools.htm";
const QRCODE_SCRIPT_PATH = "vendor/qrcode.min.js";
const LANGUAGE_STORAGE_KEY = "myloggerLanguage";

const state = {
  language: localStorage.getItem(LANGUAGE_STORAGE_KEY) === "zh" ? "zh" : "en",
  fileName: "",
  filePath: "",
  fileSize: 0,
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
  searchModalMode: "",
  markedLines: new Set(),
  activeMarkedLine: null,
  activeMatch: -1,
  activeSearch: "",
  searchDirty: false,
  modalMatches: [],
  modalActiveMatch: -1,
  modalActiveSearch: "",
  modalFilteredRows: [],
  modalVirtualStart: 0,
  modalVirtualEnd: 0,
  analysisModalText: "",
  analysisModalData: null,
  analysisModalMatches: [],
  analysisModalActiveMatch: -1,
  analysisModalSearch: "",
  analysisModalFilteredCount: 0,
  analysisModalTotalCount: 0,
  analysisRightRows: [],
  analysisRightHighlight: "",
  analysisRightBody: null,
  analysisRightVirtualStart: 0,
  analysisRightVirtualEnd: 0,
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
let modalVirtualScrollFrame = 0;
let analysisRightVirtualScrollFrame = 0;
let pendingLogRowClickTimer = 0;
let suppressNextLogRowClick = false;

const els = {
  fileInput: document.getElementById("fileInput"),
  breakpointsInput: document.getElementById("breakpointsInput"),
  viewBreakpointsFile: document.getElementById("viewBreakpointsFile"),
  fileMeta: document.getElementById("fileMeta"),
  breakpointsMeta: document.getElementById("breakpointsMeta"),
  saveFiltered: document.getElementById("saveFiltered"),
  languageButton: document.getElementById("languageButton"),
  languagePopover: document.getElementById("languagePopover"),
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
  searchTableWrap: document.getElementById("searchTableWrap"),
  searchResultTable: document.querySelector("#searchTableWrap .log-table"),
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

const I18N = {
  zh: {
    openFile: "打开文本/日志",
    saveFiltered: "保存过滤结果",
    help: "帮助",
    filter: "过滤",
    filterPlaceholder: "关键字或正则；多行按任意一行命中过滤",
    view: "查看",
    regex: "正则",
    caseSensitive: "区分大小写",
    search: "搜索",
    searchPlaceholder: "在当前结果中查找",
    resultFilterPlaceholder: "过滤当前结果",
    prevMarked: "跳转到上一个标记",
    nextMarked: "跳转到下一个标记",
    allMarked: "全部标记",
    backendAnalysis: "后台分析",
    serviceUrl: "服务地址",
    breakpointsFile: "断点文件",
    noBreakpointsFile: "未选择断点文件。",
    logPath: "日志路径",
    noLogFile: "未选择日志文件。",
    serviceStatus: "服务状态",
    serviceAvailable: "后台服务可用",
    serviceUnavailable: "后台服务不可用",
    getBreakpointLogs: "获取断点日志",
    tools: "实用工具",
    expandAnalysis: "展开后台分析",
    collapseAnalysis: "收起后台分析",
    logControls: "日志控制",
    logTable: "日志表格",
    quickScroll: "快速滚动",
    top: "回到顶部",
    bottom: "回到底部",
    dropLogFile: "拖拽日志文件到这里",
    clickOpenFile: "或点击“打开文本/日志”。",
    lineNumber: "行号",
    time: "时间",
    level: "级别",
    content: "内容",
    searchResults: "搜索结果",
    noResults: "暂无结果。",
    previous: "上一个",
    next: "下一个",
    clearMarks: "清除标记",
    saveResults: "保存结果",
    close: "关闭",
    logContext: "日志上下文",
    noLog: "暂无日志。",
    analysisResults: "筛查结果",
    save: "保存",
    breakpoints: "断点文件",
    helpTitle: "MyLogger 帮助",
    helpIntro: "本工具用于本地日志查看、过滤、定位、标记、保存和断点日志筛查。",
    helpOpenTitle: "打开日志",
    helpOpenText: "点击右上角“打开文本/日志”，或将日志文件拖拽到主窗口。支持 `.log`、`.txt`、`.json`、`.md` 等常见文本文件。",
    helpFilterTitle: "过滤与搜索",
    helpFilterText: "顶部“过滤”会直接影响主窗口展示结果，可输入关键字，也可勾选“正则”和“区分大小写”。“搜索”会基于当前过滤结果打开搜索结果子窗口。",
    helpTimeTitle: "时间筛选",
    helpTimeText: "点击表头“时间”打开时间筛选窗口。时间点按当前日志实际分布生成，选择起点和终点后点击“确定”，主窗口只展示对应时间段内的日志。",
    helpLevelTitle: "级别筛选",
    helpLevelText: "点击表头“级别”打开级别选择器，可多选日志级别。选择后会立即过滤主窗口日志。",
    helpTagTitle: "Tag 筛选",
    helpTagText: "点击表头“Tag”打开 Tag 筛选窗口。输入 Tag 后点击“确定”才会生效。点击“+”可增加多个 Tag，多个 Tag 按“任意一个完全匹配”进行过滤。",
    helpContextTitle: "查看上下文",
    helpContextText: "当主窗口存在过滤条件时，单击某一行日志会打开上下文子窗口，展示该日志前后各 50 行，并高亮当前行。",
    helpMarkTitle: "标记与跳转",
    helpMarkText: "点击行号可标记或取消标记当前行。右上角“全部标记”可查看标记行。搜索区旁边的上下箭头可在标记行之间跳转。",
    helpSaveTitle: "复制与保存",
    helpSaveText: "双击日志行会复制当前行文本。右上角“保存过滤结果”会把当前主窗口展示的过滤结果保存为 `.txt` 文件。各子窗口右上角“保存”也默认保存为 `.txt`。",
    helpBackendTitle: "后台分析",
    helpBackendText: "左侧“后台分析”默认收起，点击可展开。选择断点 JSON 文件后，可点击“获取断点日志”从本地后台服务提取断点日志字符串。",
    helpBreakpointTitle: "断点日志筛查",
    helpBreakpointText: "顶部“过滤”支持多行输入，每一行都是一条过滤规则，多行之间按“任意一条命中”过滤主窗口日志。勾选“正则”时，每一行会作为独立正则参与匹配。过滤输入框右侧“查看”用于打开左右分屏明细窗口。",
    helpServiceTitle: "本地服务",
    helpServiceText: "后台分析服务地址默认为 `http://127.0.0.1:7878/analyze`。服务状态绿灯表示本地服务可用，红灯表示不可用。点击“获取断点日志”时，插件会将断点 JSON 内容传给后台；后台根据 JSON 中的断点信息对比本地源码，找到断点对应源码行中的日志字符串并返回，并自动填入顶部“过滤”刷新主窗口。",
    helpToolsTitle: "实用工具",
    helpToolsText: "展开左侧“后台分析”后，点击“实用工具”可打开随插件打包的本地工具页。该页面包含 JSON 格式化、参数处理、二维码生成等常用小工具，可在不离开插件环境的情况下辅助处理日志和调试文本。",
    confirm: "确定",
    clear: "清除",
    start: "起点",
    end: "终点",
    unlimited: "不限",
    noLevel: "无级别",
    noTime: "无时间",
    inputTag: "输入 Tag",
    markedRows: "已标记行",
    filterLogs: "过滤日志",
    relatedLogs: "相关日志",
    expandFilterLogs: "展开过滤日志",
    collapseFilterLogs: "收起过滤日志",
    noBreakpointLogStrings: "没有提取到断点日志字符串。",
    noRelatedLogs: "没有可展示的相关日志。",
    noMatchedRelatedLogs: "未在日志文件中找到相关日志。",
    languageLabel: "中",
    languageZh: "中文",
    languageEn: "English",
  },
  en: {
    openFile: "Open Text/Log",
    saveFiltered: "Save Filtered",
    help: "Help",
    filter: "Filter",
    filterPlaceholder: "Keyword or regex; multiple lines match any rule",
    view: "View",
    regex: "Regex",
    caseSensitive: "Case sensitive",
    search: "Search",
    searchPlaceholder: "Search current results",
    resultFilterPlaceholder: "Filter current results",
    prevMarked: "Previous mark",
    nextMarked: "Next mark",
    allMarked: "All Marks",
    backendAnalysis: "Backend Analysis",
    serviceUrl: "Service URL",
    breakpointsFile: "Breakpoints File",
    noBreakpointsFile: "No breakpoints file selected.",
    logPath: "Log Path",
    noLogFile: "No log file selected.",
    serviceStatus: "Service Status",
    serviceAvailable: "Backend service available",
    serviceUnavailable: "Backend service unavailable",
    getBreakpointLogs: "Get Breakpoint Logs",
    tools: "Tools",
    expandAnalysis: "Expand backend analysis",
    collapseAnalysis: "Collapse backend analysis",
    logControls: "Log controls",
    logTable: "Log table",
    quickScroll: "Quick scroll",
    top: "Scroll to top",
    bottom: "Scroll to bottom",
    dropLogFile: "Drop a log file here",
    clickOpenFile: "or click \"Open Text/Log\".",
    lineNumber: "Line",
    time: "Time",
    level: "Level",
    content: "Content",
    searchResults: "Search Results",
    noResults: "No results.",
    previous: "Previous",
    next: "Next",
    clearMarks: "Clear Marks",
    saveResults: "Save Results",
    close: "Close",
    logContext: "Log Context",
    noLog: "No log.",
    analysisResults: "Screening Results",
    save: "Save",
    breakpoints: "Breakpoints File",
    helpTitle: "MyLogger Help",
    helpIntro: "Use this tool to view, filter, locate, mark, save, and screen local logs with breakpoint data.",
    helpOpenTitle: "Open Logs",
    helpOpenText: "Click \"Open Text/Log\" in the top-right area, or drop a log file into the main window. Common text files such as `.log`, `.txt`, `.json`, and `.md` are supported.",
    helpFilterTitle: "Filter And Search",
    helpFilterText: "The top Filter field directly changes the main log view. Enter keywords, or enable Regex and Case sensitive. Search opens a result window based on the current filtered logs.",
    helpTimeTitle: "Time Filter",
    helpTimeText: "Click the Time header to open time filtering. Time points are generated from the loaded logs. Select a start and end time, then click Confirm.",
    helpLevelTitle: "Level Filter",
    helpLevelText: "Click the Level header to open the level selector. Multiple log levels can be selected and applied immediately.",
    helpTagTitle: "Tag Filter",
    helpTagText: "Click the Tag header to open tag filtering. Enter tags and click Confirm. Use + to add multiple tags. Tags match exactly and any selected tag can match.",
    helpContextTitle: "View Context",
    helpContextText: "When filters are active, click a log row to open a context window showing 50 lines before and after it, with the selected row highlighted.",
    helpMarkTitle: "Marks And Jump",
    helpMarkText: "Click a line number to mark or unmark that row. All Marks shows marked rows. The up/down arrows near Search jump between marked rows.",
    helpSaveTitle: "Copy And Save",
    helpSaveText: "Double-click a log row to copy it. Save Filtered saves the current main view as a `.txt` file. Save buttons in subwindows also save `.txt` files by default.",
    helpBackendTitle: "Backend Analysis",
    helpBackendText: "The left Backend Analysis panel is collapsed by default. Expand it, choose a breakpoint JSON file, then click Get Breakpoint Logs to extract log strings through the local backend service.",
    helpBreakpointTitle: "Breakpoint Log Screening",
    helpBreakpointText: "The top Filter field supports multiple lines. Each line is a rule, and rows matching any rule are shown. With Regex enabled, every line is treated as an independent regex. The View button on the filter field opens a split detail window.",
    helpServiceTitle: "Local Service",
    helpServiceText: "The backend service URL defaults to `http://127.0.0.1:7878/analyze`. A green status light means available, red means unavailable. Get Breakpoint Logs sends breakpoint JSON to the backend; the backend compares it with local source code, extracts log strings, returns them, and fills the top Filter field.",
    helpToolsTitle: "Tools",
    helpToolsText: "Expand Backend Analysis and click Tools to open the bundled local tools page. It includes JSON formatting, parameter handling, QR code generation, and other helpers for logs and debugging text.",
    confirm: "Confirm",
    clear: "Clear",
    start: "Start",
    end: "End",
    unlimited: "Any",
    noLevel: "No levels",
    noTime: "No time",
    inputTag: "Enter Tag",
    markedRows: "Marked Rows",
    filterLogs: "Filter Logs",
    relatedLogs: "Related Logs",
    expandFilterLogs: "Expand filter logs",
    collapseFilterLogs: "Collapse filter logs",
    noBreakpointLogStrings: "No breakpoint log strings extracted.",
    noRelatedLogs: "No related logs to display.",
    noMatchedRelatedLogs: "No related logs found in the log file.",
    languageLabel: "EN",
    languageZh: "中文",
    languageEn: "English",
  },
};

function t(key, params = {}) {
  let value = (I18N[state.language] && I18N[state.language][key]) || I18N.zh[key] || key;
  for (const [name, replacement] of Object.entries(params)) {
    value = value.replaceAll(`{${name}}`, replacement);
  }
  return value;
}

function applyLanguage() {
  document.documentElement.lang = state.language === "en" ? "en" : "zh-CN";
  els.languageButton.textContent = t("languageLabel");
  els.languageButton.classList.toggle("active", !els.languagePopover.classList.contains("hidden"));
  els.languageButton.setAttribute("aria-label", state.language === "en" ? "Language" : "语言");
  els.openHelpModal.title = t("help");
  els.openHelpModal.setAttribute("aria-label", t("help"));

  setLeadingText(".header-actions-left label.button.primary", "openFile");
  setText("#saveFiltered", "saveFiltered");
  setLeadingText(".toolbar > label:nth-of-type(1)", "filter");
  setPlaceholder("#filterInput", "filterPlaceholder");
  setText("#viewFilterResults", "view");
  setLeadingText(".toolbar label.checkbox:nth-of-type(2)", "regex");
  setLeadingText(".toolbar label.checkbox:nth-of-type(3)", "caseSensitive");
  setLeadingText(".toolbar > label:nth-of-type(4)", "search");
  setPlaceholder("#searchInput", "searchPlaceholder");
  setText("#openSearchResults", "search");
  setText("#openMarkedRows", "allMarked");
  els.prevMarkedLine.title = t("prevMarked");
  els.nextMarkedLine.title = t("nextMarked");

  setText(".analysis-panel h2", "backendAnalysis");
  setLeadingText(".analysis-panel label:nth-of-type(1)", "serviceUrl");
  setText(".analysis-path-field:nth-of-type(1) > span", "breakpointsFile");
  setText("#viewBreakpointsFile", "view");
  setAnalysisPathFallbacks();
  setAnalysisServiceStatusText();
  setText("#analyzeButton", "getBreakpointLogs");
  setText("#openToolsPage", "tools");
  updateAnalysisToggleText();
  document.querySelector(".toolbar")?.setAttribute("aria-label", t("logControls"));
  document.querySelector(".log-panel")?.setAttribute("aria-label", t("logTable"));
  document.querySelector(".quick-scroll")?.setAttribute("aria-label", t("quickScroll"));
  els.scrollToTop.title = t("top");
  els.scrollToTop.setAttribute("aria-label", t("top"));
  els.scrollToBottom.title = t("bottom");
  els.scrollToBottom.setAttribute("aria-label", t("bottom"));
  setText("#dropZone strong", "dropLogFile");
  setText("#dropZone span", "clickOpenFile");
  setTableHeaders();

  applyModalLanguage();
  updateLevelFilterHeader();
  updateTimeFilterHeader();
  updateTagFilterHeader();
  updateMarkedLineJumpButtons();
  updateMatchStatus();
  updateModalMatchStatus();
  updateAnalysisModalMatchStatus();
  setLanguagePopoverState();
  updateFileMeta();
  updateBreakpointsMeta();
}

function setText(selector, key) {
  const el = document.querySelector(selector);
  if (el) el.textContent = t(key);
}

function setPlaceholder(selector, key) {
  const el = document.querySelector(selector);
  if (el) el.placeholder = t(key);
}

function setLeadingText(selector, key) {
  const el = document.querySelector(selector);
  if (!el) return;
  const textNode = Array.from(el.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  if (textNode) textNode.textContent = `${t(key)} `;
}

function setTableHeaders() {
  for (const header of document.querySelectorAll("th.line-col")) header.textContent = t("lineNumber");
  for (const header of document.querySelectorAll("th.time-col")) {
    if (header.id !== "timeFilterHeader") header.textContent = t("time");
  }
  for (const header of document.querySelectorAll("th.level-col")) {
    if (header.id !== "levelFilterHeader") header.textContent = t("level");
  }
  for (const header of document.querySelectorAll("th.message-col")) header.textContent = t("content");
}

function applyModalLanguage() {
  if (!state.searchModalMode) {
    setText("#searchModalTitle", "searchResults");
  } else {
    els.searchModalTitle.textContent = state.searchModalMode === "marked" ? t("markedRows") : t("searchResults");
  }
  if (!state.searchResultRows.length) els.searchModalMeta.textContent = t("noResults");
  setLeadingText("#searchModal .modal-search label", "filter");
  setPlaceholder("#modalSearchInput", "resultFilterPlaceholder");
  setText("#modalPrevMatch", "previous");
  setText("#modalNextMatch", "next");
  setText("#clearMarkedRows", "clearMarks");
  setText("#saveSearchResults", "saveResults");
  setText("#closeSearchModal", "close");
  setText("#contextModalTitle", "logContext");
  if (!state.rows.length) els.contextModalMeta.textContent = t("noLog");
  setText("#closeContextModal", "close");
  setText("#analysisModalTitle", "analysisResults");
  if (!state.analysisModalText) els.analysisModalMeta.textContent = t("noResults");
  setLeadingText("#analysisModal .analysis-modal-search label", "filter");
  setPlaceholder("#analysisModalSearchInput", "resultFilterPlaceholder");
  setText("#analysisModalPrevMatch", "previous");
  setText("#analysisModalNextMatch", "next");
  setText("#saveAnalysisModal", "save");
  setText("#closeAnalysisModal", "close");
  setText("#breakpointsModalTitle", "breakpoints");
  setText("#closeBreakpointsModal", "close");
  setText("#helpModalTitle", "helpTitle");
  setText("#helpModal .modal-header p", "helpIntro");
  setText("#closeHelpModal", "close");

  const helpSections = [
    ["helpOpenTitle", "helpOpenText"],
    ["helpFilterTitle", "helpFilterText"],
    ["helpTimeTitle", "helpTimeText"],
    ["helpLevelTitle", "helpLevelText"],
    ["helpTagTitle", "helpTagText"],
    ["helpContextTitle", "helpContextText"],
    ["helpMarkTitle", "helpMarkText"],
    ["helpSaveTitle", "helpSaveText"],
    ["helpBackendTitle", "helpBackendText"],
    ["helpBreakpointTitle", "helpBreakpointText"],
    ["helpServiceTitle", "helpServiceText"],
    ["helpToolsTitle", "helpToolsText"],
  ];
  const sections = Array.from(document.querySelectorAll(".help-modal-body section"));
  helpSections.forEach(([titleKey, textKey], index) => {
    const section = sections[index];
    if (!section) return;
    section.querySelector("h3").textContent = t(titleKey);
    section.querySelector("p").textContent = t(textKey);
  });
  setText("#confirmTagFilter", "confirm");
  setText("#clearTagFilter", "clear");
  setText("#confirmTimeFilter", "confirm");
  setText("#clearTimeFilter", "clear");
  const timeTitles = document.querySelectorAll(".time-filter-lists h3");
  if (timeTitles[0]) timeTitles[0].textContent = t("start");
  if (timeTitles[1]) timeTitles[1].textContent = t("end");
}

function setAnalysisPathFallbacks() {
  if (!state.breakpointsContent) {
    els.analysisBreakpointsPath.textContent = t("noBreakpointsFile");
    els.breakpointsModalMeta.textContent = t("noBreakpointsFile");
  }
  if (!state.filePath) {
    els.analysisLogPath.textContent = t("noLogFile");
  }
}

function setAnalysisServiceStatusText() {
  document.querySelector(".analysis-service-row span").textContent = t("serviceStatus");
  const available = els.analysisStatusButton.classList.contains("available");
  const label = available ? t("serviceAvailable") : t("serviceUnavailable");
  els.analysisStatusButton.title = label;
  els.analysisStatusButton.setAttribute("aria-label", label);
}

function setLanguagePopoverState() {
  for (const button of els.languagePopover.querySelectorAll("button[data-language]")) {
    const language = button.dataset.language;
    button.textContent = language === "en" ? t("languageEn") : t("languageZh");
    button.classList.toggle("active", language === state.language);
  }
}

function parseLine(text, index) {
  const filtered = text.match(/^(\d+):\s*(.*)$/);
  const sourceLine = filtered ? Number(filtered[1]) : index + 1;
  const body = filtered ? filtered[2] : text;
  const parsed = parseLogBody(body);

  if (!parsed) {
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

  return {
    sourceLine,
    time: parsed.time,
    level: parsed.level,
    tag: parsed.tag,
    message: parsed.message,
    pid: parsed.pid,
    tid: parsed.tid,
    process: parsed.process,
    raw: body,
    timeValue: parseLogTimeValue(parsed.time),
    searchable: `${sourceLine} ${parsed.time} ${parsed.pid} ${parsed.tid} ${parsed.process || ""} ${parsed.level} ${parsed.tag} ${parsed.message}`,
  };
}

function parseLogBody(body) {
  const studioMatch = body.match(
    /^(?<time>\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d{3})?)\s+(?<pid>\d+)-(?<tid>\d+)\s+(?<tag>\S+)\s+(?<process>\S+)\s+(?<level>[VDIWEF])\s+(?<message>.*)$/
  );
  if (studioMatch?.groups) {
    return {
      time: studioMatch.groups.time,
      pid: studioMatch.groups.pid || "",
      tid: studioMatch.groups.tid || "",
      process: studioMatch.groups.process || "",
      level: studioMatch.groups.level || "",
      tag: (studioMatch.groups.tag || "").trim(),
      message: studioMatch.groups.message || "",
    };
  }

  const timeMatch = body.match(/^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d{3})?)\s+(.*)$/);
  if (!timeMatch) return null;

  const [, time, rest] = timeMatch;
  const variants = [
    /^(?<pid>\d+)\s+(?<tid>\d+)\s+(?<level>[VDIWEF])\s+(?<tag>[^:]+?)\s*:\s?(?<message>.*)$/,
    /^(?<pid>\d+)\s+(?<tid>\d+)\s+(?<level>[VDIWEF])\/(?<tag>[^:]+?)\s*:\s?(?<message>.*)$/,
    /^(?<pid>\d+)\s+(?<tid>\d+)\s+(?<level>[VDIWEF])\s+(?<message>.*)$/,
    /^(?<pid>\d+)\s+(?<tid>\d+)\s+(?<tag>[^:]+?)\s*:\s?(?<message>.*)$/,
    /^(?<level>[VDIWEF])\/(?<tag>[^:]+?)\s*:\s?(?<message>.*)$/,
    /^(?<level>[VDIWEF])\s+(?<tag>[^:]+?)\s*:\s?(?<message>.*)$/,
    /^(?<level>[VDIWEF])\s+(?<message>.*)$/,
    /^(?<tag>[^:]+?)\s*:\s?(?<message>.*)$/,
  ];

  for (const variant of variants) {
    const match = rest.match(variant);
    if (!match || !match.groups) continue;
    return {
      time,
      pid: match.groups.pid || "",
      tid: match.groups.tid || "",
      process: "",
      level: match.groups.level || "",
      tag: (match.groups.tag || "").trim(),
      message: match.groups.message || "",
    };
  }

  return {
    time,
    pid: "",
    tid: "",
    process: "",
    level: "",
    tag: "",
    message: rest,
  };
}

function parseLogTimeValue(value) {
  const match = value.match(/^(?:(\d{4})-)?(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?$/);
  if (!match) return null;
  const [, year = 2000, month, day, hour, minute, second, millisecond = 0] = match.map((part) => Number(part || 0));
  const normalizedYear = year || 2000;
  return Date.UTC(normalizedYear, month - 1, day, hour, minute, second, millisecond);
}

async function openFile(file) {
  const text = await file.text();
  state.fileName = file.name;
  state.filePath = file.path || file.name;
  state.fileSize = file.size;
  state.rawText = text;
  state.rows = text.split(/\r?\n/).map(parseLine);
  els.filterInput.value = "";
  els.searchInput.value = "";
  state.selectedLevels.clear();
  state.tagFilters = [""];
  state.draftTagFilters = [""];
  state.timeFilterStart = null;
  state.timeFilterEnd = null;
  state.draftTimeFilterStart = null;
  state.draftTimeFilterEnd = null;
  updateLogColumnVisibility();
  updateTimeFilterOptions();
  updateTimeFilterHeader();
  renderTagFilterInputs();
  updateTagFilterHeader();
  state.markedLines.clear();
  state.activeMarkedLine = null;
  state.searchResultRows = [];
  closeSearchModal();
  els.analysisLogPath.textContent = state.filePath;
  updateFileMeta();
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
  updateBreakpointsMeta();
  els.analysisBreakpointsPath.textContent = state.breakpointsFilePath;
  updateAnalyzeButtonState();
  els.viewBreakpointsFile.classList.remove("hidden");
  showToast(`已加载断点文件：${file.name}`);
}

function clearBreakpointsFile() {
  state.breakpointsFileName = "";
  state.breakpointsFilePath = "";
  state.breakpointsContent = "";
  updateBreakpointsMeta();
  els.analysisBreakpointsPath.textContent = "未选择断点文件。";
  els.breakpointsModalMeta.textContent = "未选择断点文件。";
  els.breakpointsModalBody.textContent = "";
  updateAnalyzeButtonState();
  els.viewBreakpointsFile.classList.add("hidden");
}

function updateAnalyzeButtonState() {
  els.analyzeButton.disabled = !state.breakpointsContent;
}

function updateFileMeta() {
  if (!state.fileName) {
    els.fileMeta.textContent = "";
    return;
  }
  els.fileMeta.textContent = state.language === "en"
    ? `${state.fileName} · ${state.rows.length.toLocaleString()} rows · ${formatBytes(state.fileSize)}`
    : `${state.fileName} · ${state.rows.length.toLocaleString()} 行 · ${formatBytes(state.fileSize)}`;
}

function updateBreakpointsMeta() {
  els.breakpointsMeta.textContent = state.breakpointsFilePath
    ? `${t("breakpointsFile")}：${state.breakpointsFilePath}`
    : "";
}

function updateLogColumnVisibility() {
  document.body.classList.toggle("hide-time-col", !state.rows.some((row) => row.time));
  document.body.classList.toggle("hide-level-col", !state.rows.some((row) => row.level));
  document.body.classList.toggle("hide-tag-col", !state.rows.some((row) => row.tag));
}

function toggleAnalysisPanel() {
  const collapsed = !els.content.classList.contains("analysis-collapsed");
  els.content.classList.toggle("analysis-collapsed", collapsed);
  updateAnalysisToggleText();
  scheduleVirtualRowsRender();
}

function updateAnalysisToggleText() {
  const collapsed = els.content.classList.contains("analysis-collapsed");
  els.toggleAnalysisPanel.setAttribute("aria-expanded", collapsed ? "false" : "true");
  els.toggleAnalysisPanel.setAttribute("aria-label", collapsed ? t("expandAnalysis") : t("collapseAnalysis"));
  els.toggleAnalysisPanel.title = collapsed ? t("expandAnalysis") : t("collapseAnalysis");
  els.toggleAnalysisPanel.textContent = collapsed ? ">" : "<";
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
    empty.textContent = t("noLevel");
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
  els.levelFilterHeader.textContent = count ? `${t("level")}(${count})` : t("level");
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
    empty.textContent = t("noTime");
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
  list.append(createTimeFilterRow(t("unlimited"), null, type));
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
  if (value != null && state.draftTimeFilterStart === value) markers.push(t("start"));
  if (value != null && state.draftTimeFilterEnd === value) markers.push(t("end"));
  return markers.length ? `✓ ${markers.join("/")} ${label}` : label;
}

function formatLogTimeValue(value) {
  const date = new Date(value);
  const pad = (number, size = 2) => String(number).padStart(size, "0");
  return `${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function updateTimeFilterHeader() {
  const active = state.timeFilterStart != null || state.timeFilterEnd != null;
  els.timeFilterHeader.textContent = active ? `${t("time")}(1)` : t("time");
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
    input.placeholder = t("inputTag");
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
  if ((context === "search-modal" || context === "modal") && state.modalActiveMatch === visibleIndex) {
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
    table.style.minWidth = `${getVisibleFixedColumnsWidth() + messageWidth + 96}px`;
  }
}

function updateLogTableWidthForTables(rows, tables) {
  let longestMessage = "";
  for (const row of rows) {
    if ((row.message || "").length > longestMessage.length) {
      longestMessage = row.message || "";
    }
  }

  const messageWidth = Math.max(720, Math.ceil(measureLogTextWidth(longestMessage)) + 32);
  for (const table of tables) {
    if (!table) continue;
    table.style.setProperty("--message-col-width", `${messageWidth}px`);
    table.style.minWidth = `${getVisibleFixedColumnsWidth() + messageWidth + 96}px`;
  }
}

function getVisibleFixedColumnsWidth() {
  let width = 48;
  if (!document.body.classList.contains("hide-time-col")) width += 178;
  if (!document.body.classList.contains("hide-level-col")) width += 58;
  if (!document.body.classList.contains("hide-tag-col")) width += 150;
  return width;
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

function renderSearchModalRows() {
  const rows = state.modalFilteredRows;
  const viewportHeight = els.searchTableWrap.clientHeight || 1;
  const scrollTop = els.searchTableWrap.scrollTop;
  const start = Math.max(0, Math.floor(scrollTop / LOG_ROW_HEIGHT) - LOG_OVERSCAN_ROWS);
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / LOG_ROW_HEIGHT) + LOG_OVERSCAN_ROWS);
  const rowContext = state.searchModalCanOpenContext ? "search-modal" : "modal";
  state.modalVirtualStart = start;
  state.modalVirtualEnd = end;

  const fragment = document.createDocumentFragment();
  els.searchResultBody.textContent = "";

  if (start > 0) {
    fragment.appendChild(spacerRow(start * LOG_ROW_HEIGHT));
  }

  for (let index = start; index < end; index += 1) {
    fragment.appendChild(createLogRow(rows[index], state.modalActiveSearch, index, rowContext));
  }

  const bottomRows = rows.length - end;
  if (bottomRows > 0) {
    fragment.appendChild(spacerRow(bottomRows * LOG_ROW_HEIGHT));
  }

  els.searchResultBody.appendChild(fragment);
}

function scheduleSearchModalRowsRender() {
  if (modalVirtualScrollFrame) return;
  modalVirtualScrollFrame = window.requestAnimationFrame(() => {
    modalVirtualScrollFrame = 0;
    renderSearchModalRows();
  });
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
    if (state.searchModalMode === "marked") {
      state.searchResultRows = state.rows.filter((row) => state.markedLines.has(row.sourceLine));
      els.searchModalMeta.textContent = `${state.fileName || "log"} · ${state.searchResultRows.length.toLocaleString()} ${state.language === "en" ? "marked rows" : "行已标记"}`;
      if (!state.searchResultRows.length) {
        closeSearchModal();
        return;
      }
    }
    applyModalFilter();
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
  els.contextModalMeta.textContent = state.language === "en"
    ? `${state.fileName || "Log"} · Line ${row.sourceLine} · +/- ${LOG_CONTEXT_RADIUS} lines`
    : `${state.fileName || "日志"} · 第 ${row.sourceLine} 行 · 前后 ${LOG_CONTEXT_RADIUS} 行`;
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
  state.searchModalMode = "search";
  els.searchModalTitle.textContent = t("searchResults");
  state.modalMatches = [];
  state.modalActiveMatch = -1;
  state.modalActiveSearch = "";
  state.modalFilteredRows = rows;
  els.modalSearchInput.value = "";
  els.clearMarkedRows.classList.add("hidden");
  els.searchModalMeta.textContent = state.language === "en"
    ? `${state.fileName || "log"} · Search: ${query} · ${rows.length.toLocaleString()} matches`
    : `${state.fileName || "log"} · 搜索：${query} · ${rows.length.toLocaleString()} 个匹配`;
  state.modalFilteredRows = rows;
  state.modalVirtualStart = 0;
  state.modalVirtualEnd = 0;
  updateLogTableWidthForTables(rows, [els.searchResultTable]);
  els.searchModal.classList.remove("hidden");
  els.searchTableWrap.scrollTop = 0;
  renderSearchModalRows();
  updateModalMatchStatus();
}

function openMarkedRows() {
  const rows = state.rows.filter((row) => state.markedLines.has(row.sourceLine));
  if (!rows.length) {
    showToast("没有已标记行。");
    return;
  }

  state.searchResultRows = rows;
  state.searchModalCanOpenContext = false;
  state.searchModalMode = "marked";
  els.searchModalTitle.textContent = t("markedRows");
  els.searchModalMeta.textContent = state.language === "en"
    ? `${state.fileName || "log"} · ${rows.length.toLocaleString()} marked rows`
    : `${state.fileName || "log"} · ${rows.length.toLocaleString()} 行已标记`;
  state.modalMatches = [];
  state.modalActiveMatch = -1;
  state.modalActiveSearch = "";
  state.modalFilteredRows = rows;
  els.modalSearchInput.value = "";
  els.clearMarkedRows.classList.remove("hidden");
  state.modalFilteredRows = rows;
  state.modalVirtualStart = 0;
  state.modalVirtualEnd = 0;
  updateLogTableWidthForTables(rows, [els.searchResultTable]);
  els.searchModal.classList.remove("hidden");
  els.searchTableWrap.scrollTop = 0;
  renderSearchModalRows();
  updateModalMatchStatus();
}

function closeSearchModal() {
  state.searchModalCanOpenContext = false;
  state.searchModalMode = "";
  state.modalFilteredRows = [];
  state.modalVirtualStart = 0;
  state.modalVirtualEnd = 0;
  els.searchModal.classList.add("hidden");
  els.clearMarkedRows.classList.add("hidden");
}

function saveSearchResults() {
  if (!state.searchResultRows.length) return;
  const rows = (state.modalFilteredRows.length || els.modalSearchInput.value.trim())
    ? state.modalFilteredRows
    : state.searchResultRows;
  const content = formatRowsForSave(rows);
  const suffix = state.searchModalMode === "marked" ? "marked" : "search";
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

function applyModalFilter() {
  const query = els.modalSearchInput.value.trim();
  state.modalMatches = [];
  state.modalActiveMatch = -1;
  state.modalActiveSearch = query;
  const matches = findModalMatchingRows(query);
  state.modalFilteredRows = query ? matches.map(({ row }) => row) : state.searchResultRows.slice();
  state.modalMatches = query ? state.modalFilteredRows.map((_, index) => index) : [];
  updateLogTableWidthForTables(state.modalFilteredRows, [els.searchResultTable]);
  els.searchTableWrap.scrollTop = 0;
  renderSearchModalRows();
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
  applyModalFilter();
}

function goModalMatch(direction) {
  if (state.modalActiveSearch !== els.modalSearchInput.value.trim()) {
    runModalSearch();
  }
  if (!state.modalMatches.length) return;
  state.modalActiveMatch = state.modalActiveMatch < 0
    ? (direction > 0 ? 0 : state.modalMatches.length - 1)
    : (state.modalActiveMatch + direction + state.modalMatches.length) % state.modalMatches.length;
  const targetIndex = state.modalMatches[state.modalActiveMatch];
  scrollSearchModalRowIndexIntoView(targetIndex);
  renderSearchModalRows();
  updateModalMatchStatus();
}

function scrollSearchModalRowIndexIntoView(index) {
  const viewportHeight = els.searchTableWrap.clientHeight || 0;
  const targetTop = Math.max(0, index * LOG_ROW_HEIGHT - Math.max(0, viewportHeight - LOG_ROW_HEIGHT) / 2);
  els.searchTableWrap.scrollTop = targetTop;
}

function updateModalMatchStatus() {
  const filteredCount = state.modalFilteredRows.length;
  const totalCount = state.searchResultRows.length;
  if (!state.modalActiveSearch) {
    els.modalMatchStatus.textContent = state.language === "en"
      ? `${totalCount.toLocaleString()} rows`
      : `${totalCount.toLocaleString()} 行`;
    return;
  }
  const current = state.modalActiveMatch < 0 ? 0 : state.modalActiveMatch + 1;
  els.modalMatchStatus.textContent = state.language === "en"
    ? `${current ? `${current}/` : ""}${filteredCount.toLocaleString()} filtered rows · ${totalCount.toLocaleString()} total`
    : `${current ? `${current}/` : ""}${filteredCount.toLocaleString()} 行过滤 · 共 ${totalCount.toLocaleString()} 个`;
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
  state.analysisModalFilteredCount = 0;
  state.analysisModalTotalCount = 0;
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

  state.analysisRightRows = [];
  state.analysisRightBody = null;
  renderPlainAnalysisText(query);
}

function renderPlainAnalysisText(query) {
  const text = state.analysisModalText || "";
  const trimmedQuery = query.trim();
  const lines = text.split(/\r?\n/);
  state.analysisModalTotalCount = lines.length;
  if (!trimmedQuery) {
    els.analysisModalBody.textContent = text;
    state.analysisModalMatches = [];
    state.analysisModalActiveMatch = -1;
    state.analysisModalSearch = "";
    state.analysisModalFilteredCount = lines.length;
    return;
  }

  const fragment = document.createDocumentFragment();
  const lowerQuery = trimmedQuery.toLowerCase();
  const matches = [];
  const filteredLines = lines.filter((line) => line.toLowerCase().includes(lowerQuery));
  filteredLines.forEach((line, index) => {
    const row = document.createElement("div");
    appendHighlightedText(row, line, trimmedQuery, matches);
    fragment.append(row);
    if (index < filteredLines.length - 1) fragment.append(document.createTextNode("\n"));
  });
  els.analysisModalBody.appendChild(fragment);
  state.analysisModalMatches = matches;
  state.analysisModalActiveMatch = -1;
  state.analysisModalSearch = trimmedQuery;
  state.analysisModalFilteredCount = filteredLines.length;
}

function renderBreakpointAnalysis(breakpoints, query) {
  const trimmedQuery = query.trim();
  const matches = [];
  state.analysisRightRows = [];
  state.analysisRightBody = null;
  state.analysisRightHighlight = trimmedQuery;
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
  const hasFilter = Boolean(trimmedQuery);
  const filteredLogStrings = hasFilter
    ? logStrings.filter((logString) => analysisTextMatches(logString, trimmedQuery))
    : logStrings;

  const split = document.createElement("div");
  split.className = "analysis-split";
  const leftMeta = hasFilter
    ? (state.language === "en"
      ? `${filteredLogStrings.length.toLocaleString()}/${logStrings.length.toLocaleString()} rules`
      : `${filteredLogStrings.length.toLocaleString()}/${logStrings.length.toLocaleString()} 条`)
    : (state.language === "en" ? `${logStrings.length.toLocaleString()} rules` : `${logStrings.length.toLocaleString()} 条`);
  const left = createAnalysisPane(t("filterLogs"), leftMeta, { collapsible: true });

  const leftBody = left.querySelector(".analysis-pane-body");

  if (!filteredLogStrings.length) {
    const empty = document.createElement("div");
    empty.className = "analysis-empty";
    empty.textContent = logStrings.length
      ? t("noMatchedRelatedLogs")
      : (breakpoints.error ? `${breakpoints.error}: ${breakpoints.message || ""}` : t("noBreakpointLogStrings"));
    leftBody.append(empty);
  } else {
    filteredLogStrings.forEach((logString, index) => {
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

  const sourceRightGroups = logStrings.length
    ? logStrings.map((logString) => ({ logString, matches: matchedByLogString.get(logString) || [] }))
    : matchedLogs;
  const rightGroups = hasFilter
    ? sourceRightGroups.map((group) => ({
      logString: group.logString,
      matches: (Array.isArray(group.matches) ? group.matches : [])
        .filter((item) => analysisTextMatches(item && item.line ? String(item.line) : "", trimmedQuery)),
    })).filter((group) => group.matches.length)
    : sourceRightGroups;

  let renderedRightRows = 0;
  for (const group of rightGroups) {
    renderedRightRows += Array.isArray(group.matches) ? group.matches.length : 0;
  }
  const rightMeta = hasFilter
    ? (state.language === "en"
      ? `${renderedRightRows.toLocaleString()}/${totalMatches.toLocaleString()} rows`
      : `${renderedRightRows.toLocaleString()}/${totalMatches.toLocaleString()} 行`)
    : (state.language === "en" ? `${totalMatches.toLocaleString()} rows` : `${totalMatches.toLocaleString()} 行`);
  const right = createAnalysisPane(t("relatedLogs"), rightMeta);
  const rightBody = right.querySelector(".analysis-pane-body");

  if (!rightGroups.length) {
    const empty = document.createElement("div");
    empty.className = "analysis-empty";
    empty.textContent = t("noRelatedLogs");
    rightBody.append(empty);
  } else {
    for (const group of rightGroups) {
      const groupMatches = Array.isArray(group.matches) ? group.matches : [];

      for (const item of groupMatches) {
        const lineText = item && item.line ? String(item.line) : "";
        state.analysisRightRows.push({
          item,
          lineText,
          lineNumber: item && item.lineNumber ? String(item.lineNumber) : "-",
          highlight: trimmedQuery || group.logString || "",
          regex: !trimmedQuery && els.filterRegex.checked,
          caseSensitive: !trimmedQuery && els.filterCase.checked,
          trackMatches: Boolean(trimmedQuery),
        });
      }
    }

    if (!state.analysisRightRows.length) {
      const empty = document.createElement("div");
      empty.className = "analysis-empty";
      empty.textContent = t("noMatchedRelatedLogs");
      rightBody.append(empty);
    }
  }
  if (state.analysisRightRows.length) {
    rightBody.textContent = "";
    rightBody.classList.add("analysis-pane-body-virtual");
    state.analysisRightBody = rightBody;
    state.analysisModalMatches = trimmedQuery ? state.analysisRightRows.map((_, index) => index) : [];
    rightBody.addEventListener("scroll", scheduleAnalysisRightRowsRender);
    renderAnalysisRightRows();
  } else {
    rightBody.classList.remove("analysis-pane-body-virtual");
  }

  split.append(left, right);
  els.analysisModalBody.append(split);
  if (!state.analysisRightRows.length) {
    state.analysisModalMatches = matches;
  }
  state.analysisModalActiveMatch = -1;
  state.analysisModalSearch = trimmedQuery;
  state.analysisModalFilteredCount = hasFilter ? renderedRightRows : totalMatches;
  state.analysisModalTotalCount = totalMatches;
}

function renderAnalysisRightRows() {
  const body = state.analysisRightBody;
  if (!body) return;
  const rows = state.analysisRightRows;
  const viewportHeight = body.clientHeight || 1;
  const scrollTop = body.scrollTop;
  const start = Math.max(0, Math.floor(scrollTop / ANALYSIS_ROW_HEIGHT) - LOG_OVERSCAN_ROWS);
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / ANALYSIS_ROW_HEIGHT) + LOG_OVERSCAN_ROWS);
  state.analysisRightVirtualStart = start;
  state.analysisRightVirtualEnd = end;

  const fragment = document.createDocumentFragment();
  body.textContent = "";

  if (start > 0) {
    fragment.appendChild(spacerBlock(start * ANALYSIS_ROW_HEIGHT));
  }

  for (let index = start; index < end; index += 1) {
    fragment.appendChild(createAnalysisRightRow(rows[index], index));
  }

  const bottomRows = rows.length - end;
  if (bottomRows > 0) {
    fragment.appendChild(spacerBlock(bottomRows * ANALYSIS_ROW_HEIGHT));
  }

  body.append(fragment);
}

function createAnalysisRightRow(rowData, index) {
  const matches = [];
  const row = document.createElement("div");
  row.className = "analysis-log-match-row";
  if (state.analysisModalActiveMatch === index) {
    row.classList.add("active-analysis-row");
  }
  const lineNumber = document.createElement("span");
  lineNumber.className = "analysis-line-number";
  lineNumber.textContent = rowData.lineNumber;
  const line = document.createElement("pre");
  line.className = "analysis-log-line";
  appendHighlightedText(line, rowData.lineText, rowData.highlight, matches, {
    regex: rowData.regex,
    caseSensitive: rowData.caseSensitive,
    trackMatches: rowData.trackMatches,
  });
  row.append(lineNumber, line);
  row.title = "单击查看上下文，双击复制当前行";
  row.addEventListener("click", () => scheduleAnalysisLogRowClick(rowData.item && rowData.item.lineNumber));
  row.addEventListener("dblclick", () => {
    cancelPendingLogRowClick();
    copyLine(rowData.lineText);
  });
  return row;
}

function spacerBlock(height) {
  const div = document.createElement("div");
  div.className = "virtual-spacer-block";
  div.setAttribute("aria-hidden", "true");
  div.style.height = `${height}px`;
  return div;
}

function scheduleAnalysisRightRowsRender() {
  if (analysisRightVirtualScrollFrame) return;
  analysisRightVirtualScrollFrame = window.requestAnimationFrame(() => {
    analysisRightVirtualScrollFrame = 0;
    renderAnalysisRightRows();
  });
}

function analysisTextMatches(text, query) {
  if (!query) return true;
  return String(text || "").toLowerCase().includes(query.toLowerCase());
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
    toggle.title = t("collapseFilterLogs");
    toggle.setAttribute("aria-label", t("collapseFilterLogs"));
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
  toggle.title = collapsed ? t("expandFilterLogs") : t("collapseFilterLogs");
  toggle.setAttribute("aria-label", collapsed ? t("expandFilterLogs") : t("collapseFilterLogs"));
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
  if (state.analysisRightRows.length && state.analysisRightBody) {
    state.analysisModalActiveMatch = state.analysisModalActiveMatch < 0
      ? (direction > 0 ? 0 : state.analysisModalMatches.length - 1)
      : (state.analysisModalActiveMatch + direction + state.analysisModalMatches.length) % state.analysisModalMatches.length;
    const targetIndex = state.analysisModalMatches[state.analysisModalActiveMatch];
    scrollAnalysisRightRowIndexIntoView(targetIndex);
    renderAnalysisRightRows();
    updateAnalysisModalMatchStatus();
    return;
  }
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

function scrollAnalysisRightRowIndexIntoView(index) {
  const body = state.analysisRightBody;
  if (!body) return;
  const viewportHeight = body.clientHeight || 0;
  const targetTop = Math.max(0, index * ANALYSIS_ROW_HEIGHT - Math.max(0, viewportHeight - ANALYSIS_ROW_HEIGHT) / 2);
  body.scrollTop = targetTop;
}

function updateAnalysisModalMatchStatus() {
  const query = els.analysisModalSearchInput.value.trim();
  if (!query) {
    els.analysisModalMatchStatus.textContent = state.language === "en"
      ? `${state.analysisModalTotalCount.toLocaleString()} rows`
      : `${state.analysisModalTotalCount.toLocaleString()} 行`;
    return;
  }
  els.analysisModalMatchStatus.textContent = state.language === "en"
    ? `${state.analysisModalFilteredCount.toLocaleString()} filtered rows · ${state.analysisModalTotalCount.toLocaleString()} total`
    : `${state.analysisModalFilteredCount.toLocaleString()} 行过滤 · 共 ${state.analysisModalTotalCount.toLocaleString()} 个`;
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
  if (state.analysisRightRows.length) {
    return state.analysisRightRows
      .map((row) => `${row.lineNumber}: ${row.lineText}`)
      .join("\n");
  }
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
  const label = available ? t("serviceAvailable") : t("serviceUnavailable");
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
  const totalRows = state.rows.length.toLocaleString();
  const total = state.language === "en"
    ? `${totalRows} total rows`
    : `共 ${totalRows} 个`;
  const searchQuery = els.searchInput.value.trim();
  if (state.searchDirty) {
    const matchedRows = searchQuery ? findMatchingRows(searchQuery).length : 0;
    els.matchStatus.textContent = state.language === "en"
      ? `${matchedRows.toLocaleString()} matched rows · ${total}`
      : `${matchedRows.toLocaleString()} 行命中 · ${total}`;
    return;
  }
  if (state.matches.length) {
    const current = state.activeMatch < 0 ? 0 : state.activeMatch + 1;
    els.matchStatus.textContent = state.language === "en"
      ? `${current ? `${current}/` : ""}${state.matches.length.toLocaleString()} matched rows · ${total}`
      : `${current ? `${current}/` : ""}${state.matches.length.toLocaleString()} 行命中 · ${total}`;
    return;
  }

  const matchedRows = hasActiveMainFilter() ? state.visibleRows.length : 0;
  els.matchStatus.textContent = state.language === "en"
    ? `${matchedRows.toLocaleString()} matched rows · ${total}`
    : `${matchedRows.toLocaleString()} 行命中 · ${total}`;
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

function toggleLanguagePopover(event) {
  event.stopPropagation();
  const hidden = els.languagePopover.classList.contains("hidden");
  els.languagePopover.classList.toggle("hidden", !hidden);
  els.languageButton.setAttribute("aria-expanded", hidden ? "true" : "false");
  els.languageButton.classList.toggle("active", hidden);
  setLanguagePopoverState();
}

function closeLanguagePopover() {
  els.languagePopover.classList.add("hidden");
  els.languageButton.setAttribute("aria-expanded", "false");
  els.languageButton.classList.remove("active");
}

function setLanguage(language) {
  if (language !== "zh" && language !== "en") return;
  state.language = language;
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  closeLanguagePopover();
  applyLanguage();
  if (!els.analysisModal.classList.contains("hidden")) {
    renderAnalysisModalText(els.analysisModalSearchInput.value);
    updateAnalysisModalMatchStatus();
  }
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
els.languageButton.addEventListener("click", toggleLanguagePopover);
els.languagePopover.addEventListener("click", (event) => {
  event.stopPropagation();
  const button = event.target.closest("button[data-language]");
  if (button) setLanguage(button.dataset.language);
});
document.addEventListener("click", closeLanguagePopover);
els.analysisEndpoint.addEventListener("input", scheduleAnalysisServiceCheck);
els.analysisStatusButton.addEventListener("click", checkAnalysisService);
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
els.modalSearchInput.addEventListener("input", applyModalFilter);
els.modalPrevMatch.addEventListener("click", () => goModalMatch(-1));
els.modalNextMatch.addEventListener("click", () => goModalMatch(1));
els.prevMarkedLine.addEventListener("click", () => goMarkedLine(-1));
els.nextMarkedLine.addEventListener("click", () => goMarkedLine(1));
els.tableWrap.addEventListener("scroll", scheduleVirtualRowsRender);
els.tableWrap.addEventListener("scroll", closeTimeFilterPopover);
els.tableWrap.addEventListener("scroll", closeLevelFilterPopover);
els.tableWrap.addEventListener("scroll", closeTagFilterPopover);
els.searchTableWrap.addEventListener("scroll", scheduleSearchModalRowsRender);
els.contextTableWrap.addEventListener("scroll", scheduleContextRowsRender);
els.scrollToTop.addEventListener("click", () => scrollMainLogTo("top"));
els.scrollToBottom.addEventListener("click", () => scrollMainLogTo("bottom"));
els.saveFiltered.addEventListener("click", saveFiltered);
els.analyzeButton.addEventListener("click", analyzeVisible);

applyLanguage();
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
