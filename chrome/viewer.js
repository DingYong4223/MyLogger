import { measureNaturalWidth, prepare } from "@chenglou/pretext";

const LOG_ROW_HEIGHT = 24;
const LOG_OVERSCAN_ROWS = 30;
const LOG_CONTEXT_RADIUS = 50;
const ANALYSIS_ROW_HEIGHT = 18;
const LOG_TEXT_FONT = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
const TOOLS_PAGE_PATH = "mytools.htm";
const QRCODE_SCRIPT_PATH = "vendor/qrcode.min.js";
const DEFAULT_ANALYSIS_ENDPOINT = "http://127.0.0.1:7878/analyze";
const SERVICE_ENDPOINT_STORAGE_KEY = "myloggerServiceEndpoint";
const LANGUAGE_STORAGE_KEY = "myloggerLanguage";
const COMMON_FILTERS_STORAGE_KEY = "myloggerCommonFilters";
const FILTER_HISTORY_STORAGE_KEY = "myloggerFilterHistory";
const TEXT_FILE_EXTENSIONS = new Set([
  ".log",
  ".txt",
  ".json",
  ".jsonl",
  ".md",
  ".markdown",
  ".csv",
  ".tsv",
  ".xml",
  ".yaml",
  ".yml",
  ".properties",
  ".conf",
  ".config",
  ".ini",
  ".gradle",
  ".kt",
  ".java",
  ".js",
  ".ts",
  ".html",
  ".css",
]);
const TAB_STATE_KEYS = [
  "fileName",
  "filePath",
  "fileSize",
  "fileLastModified",
  "fileKey",
  "rawText",
  "rows",
  "visibleRows",
  "selectedLevels",
  "tagFilters",
  "draftTagFilters",
  "timeFilterStart",
  "timeFilterEnd",
  "draftTimeFilterStart",
  "draftTimeFilterEnd",
  "timeFilterPoints",
  "matches",
  "searchResultRows",
  "searchModalCanOpenContext",
  "searchModalMode",
  "markedLines",
  "activeMarkedLine",
  "activeMatch",
  "activeSearch",
  "searchDirty",
  "modalMatches",
  "modalActiveMatch",
  "modalActiveSearch",
  "modalFilteredRows",
  "modalVirtualStart",
  "modalVirtualEnd",
  "analysisModalText",
  "analysisModalData",
  "analysisModalMatches",
  "analysisModalActiveMatch",
  "analysisModalSearch",
  "analysisModalFilteredCount",
  "analysisModalTotalCount",
  "analysisRightRows",
  "analysisRightHighlight",
  "analysisRightBody",
  "analysisRightVirtualStart",
  "analysisRightVirtualEnd",
  "virtualStart",
  "virtualEnd",
  "contextActiveIndex",
  "contextVirtualStart",
  "contextVirtualEnd",
];

const state = {
  language: localStorage.getItem(LANGUAGE_STORAGE_KEY) === "en" ? "en" : "zh",
  serviceEndpoint: localStorage.getItem(SERVICE_ENDPOINT_STORAGE_KEY) || DEFAULT_ANALYSIS_ENDPOINT,
  commonFilters: loadCommonFilters(),
  editingCommonFilterId: "",
  draggedCommonFilterId: "",
  filterHistory: loadFilterHistory(),
  compareLeftTabId: "",
  compareRightTabId: "",
  compareModalLeftTabId: "",
  compareModalRightTabId: "",
  compareSides: {
    left: null,
    right: null,
  },
  compareLeftVirtualStart: 0,
  compareLeftVirtualEnd: 0,
  compareRightVirtualStart: 0,
  compareRightVirtualEnd: 0,
  tabs: [],
  activeTabId: "",
  nextTabId: 1,
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
let compareLeftVirtualScrollFrame = 0;
let compareRightVirtualScrollFrame = 0;
let pendingLogRowClickTimer = 0;
let suppressNextLogRowClick = false;
const fileRelativePaths = new WeakMap();

const els = {
  fileInput: document.getElementById("fileInput"),
  directoryInput: document.getElementById("directoryInput"),
  fileMenuButton: document.getElementById("fileMenuButton"),
  fileMenuPopover: document.getElementById("fileMenuPopover"),
  openFileMenuItem: document.getElementById("openFileMenuItem"),
  analysisMenuButton: document.getElementById("analysisMenuButton"),
  analysisMenuPopover: document.getElementById("analysisMenuPopover"),
  analysisMenuCompareAction: document.getElementById("analysisMenuCompareAction"),
  openFolderButton: document.getElementById("openFolderButton"),
  breakpointsInput: document.getElementById("breakpointsInput"),
  viewBreakpointsFile: document.getElementById("viewBreakpointsFile"),
  filterLogFileInput: document.getElementById("filterLogFileInput"),
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
  jumpLineButton: document.getElementById("jumpLineButton"),
  jumpLinePopover: document.getElementById("jumpLinePopover"),
  jumpLineInput: document.getElementById("jumpLineInput"),
  confirmJumpLine: document.getElementById("confirmJumpLine"),
  matchStatus: document.getElementById("matchStatus"),
  analyzeButton: document.getElementById("analyzeButton"),
  analysisStatusButton: document.getElementById("analysisStatusButton"),
  analysisEndpoint: document.getElementById("analysisEndpoint"),
  openToolsPage: document.getElementById("openToolsPage"),
  addCommonFilter: document.getElementById("addCommonFilter"),
  importCommonFilters: document.getElementById("importCommonFilters"),
  exportCommonFilters: document.getElementById("exportCommonFilters"),
  commonFilterFileInput: document.getElementById("commonFilterFileInput"),
  commonFilterList: document.getElementById("commonFilterList"),
  commonFilterModal: document.getElementById("commonFilterModal"),
  commonFilterModalMeta: document.getElementById("commonFilterModalMeta"),
  closeCommonFilterModal: document.getElementById("closeCommonFilterModal"),
  commonFilterTitleInput: document.getElementById("commonFilterTitleInput"),
  commonFilterTextInput: document.getElementById("commonFilterTextInput"),
  saveCommonFilter: document.getElementById("saveCommonFilter"),
  analysisBreakpointsPath: document.getElementById("analysisBreakpointsPath"),
  importModal: document.getElementById("importModal"),
  importModalMeta: document.getElementById("importModalMeta"),
  importFilterLogFile: document.getElementById("importFilterLogFile"),
  openFilterHistory: document.getElementById("openFilterHistory"),
  filterHistoryPopover: document.getElementById("filterHistoryPopover"),
  closeImportModal: document.getElementById("closeImportModal"),
  fileTabs: document.getElementById("fileTabs"),
  content: document.getElementById("content"),
  toggleAnalysisPanel: document.getElementById("toggleAnalysisPanel"),
  dropZone: document.getElementById("dropZone"),
  logPanel: document.querySelector(".log-panel"),
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
  comparePickerModal: document.getElementById("comparePickerModal"),
  comparePickerMeta: document.getElementById("comparePickerMeta"),
  compareLeftTitle: document.getElementById("compareLeftTitle"),
  compareRightTitle: document.getElementById("compareRightTitle"),
  compareLeftList: document.getElementById("compareLeftList"),
  compareRightList: document.getElementById("compareRightList"),
  confirmComparePicker: document.getElementById("confirmComparePicker"),
  cancelComparePicker: document.getElementById("cancelComparePicker"),
  compareModal: document.getElementById("compareModal"),
  compareModalMeta: document.getElementById("compareModalMeta"),
  compareModalLeftTitle: document.getElementById("compareModalLeftTitle"),
  compareModalRightTitle: document.getElementById("compareModalRightTitle"),
  compareLeftFilter: document.getElementById("compareLeftFilter"),
  compareLeftRegex: document.getElementById("compareLeftRegex"),
  compareLeftCase: document.getElementById("compareLeftCase"),
  compareLeftPrevMark: document.getElementById("compareLeftPrevMark"),
  compareLeftNextMark: document.getElementById("compareLeftNextMark"),
  compareLeftJumpInput: document.getElementById("compareLeftJumpInput"),
  compareLeftJumpButton: document.getElementById("compareLeftJumpButton"),
  compareRightFilter: document.getElementById("compareRightFilter"),
  compareRightRegex: document.getElementById("compareRightRegex"),
  compareRightCase: document.getElementById("compareRightCase"),
  compareRightPrevMark: document.getElementById("compareRightPrevMark"),
  compareRightNextMark: document.getElementById("compareRightNextMark"),
  compareRightJumpInput: document.getElementById("compareRightJumpInput"),
  compareRightJumpButton: document.getElementById("compareRightJumpButton"),
  compareLeftWrap: document.getElementById("compareLeftWrap"),
  compareRightWrap: document.getElementById("compareRightWrap"),
  compareLeftTable: document.getElementById("compareLeftTable"),
  compareRightTable: document.getElementById("compareRightTable"),
  compareLeftBody: document.getElementById("compareLeftBody"),
  compareRightBody: document.getElementById("compareRightBody"),
  closeCompareModal: document.getElementById("closeCompareModal"),
  compareToast: document.getElementById("compareToast"),
  breakpointsModal: document.getElementById("breakpointsModal"),
  breakpointsModalMeta: document.getElementById("breakpointsModalMeta"),
  breakpointsModalBody: document.getElementById("breakpointsModalBody"),
  closeBreakpointsModal: document.getElementById("closeBreakpointsModal"),
  openHelpModal: document.getElementById("openHelpModal"),
  helpModal: document.getElementById("helpModal"),
  closeHelpModal: document.getElementById("closeHelpModal"),
  openSettingsModal: document.getElementById("openSettingsModal"),
  settingsModal: document.getElementById("settingsModal"),
  settingsModalMeta: document.getElementById("settingsModalMeta"),
  closeSettingsModal: document.getElementById("closeSettingsModal"),
  settingsServiceEndpoint: document.getElementById("settingsServiceEndpoint"),
  settingsLanguage: document.getElementById("settingsLanguage"),
  saveSettingsBasics: document.getElementById("saveSettingsBasics"),
  backupSettings: document.getElementById("backupSettings"),
  restoreSettings: document.getElementById("restoreSettings"),
  settingsBackupInput: document.getElementById("settingsBackupInput"),
  settingsAddCommonFilter: document.getElementById("settingsAddCommonFilter"),
  settingsCommonFilterList: document.getElementById("settingsCommonFilterList"),
  settingsFilterHistoryList: document.getElementById("settingsFilterHistoryList"),
  clearFilterHistory: document.getElementById("clearFilterHistory"),
  toast: document.getElementById("toast"),
};

installTabStateAccessors();
const initialTab = createLogTab();
state.tabs.push(initialTab);
state.activeTabId = initialTab.id;

const I18N = {
  zh: {
    fileMenu: "文件",
    analysisMenu: "分析",
    openFile: "打开文本/日志",
    openFolder: "打开文件夹",
    noTextFilesInFolder: "文件夹中没有找到可打开的文本文件。",
    saveFiltered: "保存过滤结果",
    help: "帮助",
    settings: "设置",
    filter: "过滤",
    filterPlaceholder: "过滤",
    view: "查看",
    import: "导入",
    compare: "比较",
    compareLogs: "日志比较",
    chooseCompareLogs: "选择比较日志",
    chooseTwoDifferentLogs: "请选择两个不同的日志文件。",
    needTwoLogsToCompare: "至少需要打开两个日志文件才能比较。",
    cannotCompareSameLog: "左右两侧不能选择同一个日志。",
    leftLog: "左侧日志",
    rightLog: "右侧日志",
    cancel: "取消",
    importFilterLogFile: "导入本地过滤日志",
    filterHistory: "历史过滤记录",
    filterHistoryEmpty: "暂无历史过滤记录。",
    userSettings: "用户配置",
    settingsIntro: "统一管理服务地址、语言、常用过滤和历史过滤。",
    basicSettings: "基础设置",
    language: "语言",
    backupSettings: "备份配置",
    restoreSettings: "恢复配置",
    saveSettings: "保存",
    add: "添加",
    regex: "正则",
    caseSensitive: "区分大小写",
    search: "搜索",
    searchPlaceholder: "在当前结果中查找",
    resultFilterPlaceholder: "过滤当前结果",
    prevMarked: "跳转到上一个标记",
    nextMarked: "跳转到下一个标记",
    jump: "Jump",
    jumpTitle: "跳转到指定行",
    jumpLinePlaceholder: "输入行号",
    allMarked: "全部标记",
    backendAnalysis: "后台分析",
    importTitle: "导入",
    importIntro: "导入本地过滤日志，或选择断点 JSON 并从本地服务获取过滤日志。",
    serviceUrl: "服务地址",
    breakpointsFile: "断点文件",
    noBreakpointsFile: "未选择断点文件。",
    serviceStatus: "服务状态",
    serviceAvailable: "后台服务可用",
    serviceUnavailable: "后台服务不可用",
    getBreakpointLogs: "获取断点日志",
    tools: "实用工具",
    commonFilters: "常用过滤",
    addCommonFilter: "添加常用过滤",
    editCommonFilter: "编辑常用过滤",
    importCommonFilters: "导入常用过滤",
    exportCommonFilters: "导出常用过滤",
    delete: "删除",
    edit: "编辑",
    commonFilterTitle: "标题",
    commonFilterText: "过滤词",
    commonFilterIntro: "添加标题和过滤词，过滤词规则与顶部 Filter 一致。",
    commonFilterEmpty: "暂无常用过滤。",
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
    fileMenu: "File",
    analysisMenu: "Analysis",
    openFile: "Open Text/Log",
    openFolder: "Open Folder",
    noTextFilesInFolder: "No text files found in this folder.",
    saveFiltered: "Save Filtered",
    help: "Help",
    settings: "Settings",
    filter: "Filter",
    filterPlaceholder: "Filter",
    view: "View",
    import: "Import",
    compare: "Compare",
    compareLogs: "Log Compare",
    chooseCompareLogs: "Choose Logs To Compare",
    chooseTwoDifferentLogs: "Choose two different log files.",
    needTwoLogsToCompare: "Open at least two log files to compare.",
    cannotCompareSameLog: "Left and right cannot use the same log.",
    leftLog: "Left Log",
    rightLog: "Right Log",
    cancel: "Cancel",
    importFilterLogFile: "Import Local Filter Logs",
    filterHistory: "Filter History",
    filterHistoryEmpty: "No filter history.",
    userSettings: "User Settings",
    settingsIntro: "Manage service URL, language, common filters, and filter history in one place.",
    basicSettings: "Basic Settings",
    language: "Language",
    backupSettings: "Back Up",
    restoreSettings: "Restore",
    saveSettings: "Save",
    add: "Add",
    regex: "Regex",
    caseSensitive: "Case sensitive",
    search: "Search",
    searchPlaceholder: "Search current results",
    resultFilterPlaceholder: "Filter current results",
    prevMarked: "Previous mark",
    nextMarked: "Next mark",
    jump: "Jump",
    jumpTitle: "Jump to line",
    jumpLinePlaceholder: "Enter line number",
    allMarked: "All Marks",
    backendAnalysis: "Backend Analysis",
    importTitle: "Import",
    importIntro: "Import local filter logs, or choose a breakpoint JSON file and fetch filter logs from the local service.",
    serviceUrl: "Service URL",
    breakpointsFile: "Breakpoints File",
    noBreakpointsFile: "No breakpoints file selected.",
    serviceStatus: "Service Status",
    serviceAvailable: "Backend service available",
    serviceUnavailable: "Backend service unavailable",
    getBreakpointLogs: "Get Breakpoint Logs",
    tools: "Tools",
    commonFilters: "Common Filters",
    addCommonFilter: "Add Common Filter",
    editCommonFilter: "Edit Common Filter",
    importCommonFilters: "Import Common Filters",
    exportCommonFilters: "Export Common Filters",
    delete: "Delete",
    edit: "Edit",
    commonFilterTitle: "Title",
    commonFilterText: "Filter",
    commonFilterIntro: "Add a title and filter rules. Rules follow the top Filter input.",
    commonFilterEmpty: "No common filters.",
    save: "Save",
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

function createLogTab() {
  const id = `tab-${state.nextTabId++}`;
  return {
    id,
    fileName: "",
    filePath: "",
    fileSize: 0,
    fileLastModified: 0,
    fileKey: "",
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
    filterText: "",
    searchText: "",
    filterRegex: false,
    filterCase: false,
    tableScrollTop: 0,
  };
}

function installTabStateAccessors() {
  for (const key of TAB_STATE_KEYS) {
    Object.defineProperty(state, key, {
      configurable: true,
      enumerable: true,
      get() {
        return getActiveTab()[key];
      },
      set(value) {
        getActiveTab()[key] = value;
      },
    });
  }
}

function getActiveTab() {
  let tab = state.tabs.find((item) => item.id === state.activeTabId);
  if (!tab) {
    tab = state.tabs[0];
  }
  if (!tab) {
    tab = createLogTab();
    state.tabs.push(tab);
  }
  state.activeTabId = tab.id;
  return tab;
}

function saveActiveTabControls() {
  const tab = getActiveTab();
  tab.filterText = els.filterInput.value;
  tab.searchText = els.searchInput.value;
  tab.filterRegex = els.filterRegex.checked;
  tab.filterCase = els.filterCase.checked;
  tab.tableScrollTop = els.tableWrap.scrollTop;
}

function restoreActiveTabControls() {
  const tab = getActiveTab();
  els.filterInput.value = tab.filterText || "";
  els.searchInput.value = tab.searchText || "";
  els.filterRegex.checked = Boolean(tab.filterRegex);
  els.filterCase.checked = Boolean(tab.filterCase);
}

function renderFileTabs() {
  els.fileTabs.textContent = "";
  const visibleTabs = state.tabs.filter((tab) => tab.fileName);
  els.fileTabs.classList.toggle("hidden", visibleTabs.length <= 1);
  for (const tab of visibleTabs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "file-tab";
    button.classList.toggle("active", tab.id === state.activeTabId);
    button.title = tab.filePath || tab.fileName;
    const title = document.createElement("span");
    title.className = "file-tab-title";
    title.textContent = tab.fileName;
    const close = document.createElement("span");
    close.className = "file-tab-close";
    close.textContent = "×";
    close.title = state.language === "en" ? "Close tab" : "关闭标签";
    close.setAttribute("aria-label", close.title);
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      closeLogTab(tab.id);
    });
    button.append(title, close);
    button.addEventListener("click", () => switchLogTab(tab.id));
    els.fileTabs.append(button);
  }
}

function switchLogTab(tabId) {
  if (tabId === state.activeTabId) return;
  if (!state.tabs.some((tab) => tab.id === tabId)) return;
  saveActiveTabControls();
  closeSearchModal();
  closeContextModal();
  closeAnalysisModal();
  closeComparePicker();
  closeCompareModal();
  closeTimeFilterPopover();
  closeLevelFilterPopover();
  closeTagFilterPopover();
  closeJumpLinePopover();
  state.activeTabId = tabId;
  restoreActiveTab();
}

function closeLogTab(tabId) {
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return;
  const wasActive = state.activeTabId === tabId;
  state.tabs.splice(index, 1);
  if (!state.tabs.length) {
    const tab = createLogTab();
    state.tabs.push(tab);
    state.activeTabId = tab.id;
  } else if (wasActive) {
    const next = state.tabs[Math.min(index, state.tabs.length - 1)];
    state.activeTabId = next.id;
  }
  if (wasActive) {
    closeSearchModal();
    closeContextModal();
    closeAnalysisModal();
    closeComparePicker();
    closeCompareModal();
    restoreActiveTab();
  } else {
    renderFileTabs();
  }
}

function restoreActiveTab() {
  restoreActiveTabControls();
  updateFileMeta();
  updateLogColumnVisibility();
  updateLevelFilterOptions();
  updateTimeFilterOptions();
  updateTimeFilterHeader();
  renderTagFilterInputs();
  updateTagFilterHeader();
  updateFilterResultsButton();
  if (state.rows.length) {
    els.dropZone.classList.add("hidden");
    els.tableWrap.classList.remove("hidden");
  } else {
    els.dropZone.classList.remove("hidden");
    els.tableWrap.classList.add("hidden");
  }
  updateLogTableWidth(state.visibleRows);
  renderRows();
  window.requestAnimationFrame(() => {
    els.tableWrap.scrollTop = getActiveTab().tableScrollTop || 0;
  });
  updateMarkedLineJumpButtons();
  updateSaveFilteredButton();
  updateMatchStatus();
  renderFileTabs();
}

function normalizeCommonFilters(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      id: String(item.id || `${Date.now()}-${Math.random()}`),
      title: String(item.title || "").trim(),
      filterText: String(item.filterText || "").trim(),
    }))
    .filter((item) => item.title && item.filterText);
}

function normalizeFilterHistory(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      id: String(item.id || `${Date.now()}-${Math.random()}`),
      title: String(item.title || "").trim(),
      filterText: String(item.filterText || "").trim(),
      createdAt: Number(item.createdAt || Date.now()),
    }))
    .filter((item) => item.filterText)
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, 20);
}

function loadCommonFilters() {
  try {
    return normalizeCommonFilters(JSON.parse(localStorage.getItem(COMMON_FILTERS_STORAGE_KEY) || "[]"));
  } catch {
    return [];
  }
}

function saveCommonFilters() {
  localStorage.setItem(COMMON_FILTERS_STORAGE_KEY, JSON.stringify(state.commonFilters));
}

function loadFilterHistory() {
  try {
    return normalizeFilterHistory(JSON.parse(localStorage.getItem(FILTER_HISTORY_STORAGE_KEY) || "[]"));
  } catch {
    return [];
  }
}

function saveFilterHistory() {
  state.filterHistory = state.filterHistory
    .slice()
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, 20);
  localStorage.setItem(FILTER_HISTORY_STORAGE_KEY, JSON.stringify(state.filterHistory));
}

function rememberFilterHistory(filterText, title = "") {
  const normalized = String(filterText || "").trim();
  if (!normalized) return;
  const label = title || normalized.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)[0] || t("filterHistory");
  const recentHistory = state.filterHistory
    .slice()
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, 20);
  state.filterHistory = [
    {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: label,
      filterText: normalized,
      createdAt: Date.now(),
    },
    ...recentHistory.filter((item) => item.filterText !== normalized),
  ];
  saveFilterHistory();
}

function applyLanguage() {
  document.documentElement.lang = state.language === "en" ? "en" : "zh-CN";
  els.languageButton.textContent = t("languageLabel");
  els.languageButton.classList.toggle("active", !els.languagePopover.classList.contains("hidden"));
  els.languageButton.setAttribute("aria-label", state.language === "en" ? "Language" : "语言");
  els.openHelpModal.title = t("help");
  els.openHelpModal.setAttribute("aria-label", t("help"));
  els.openSettingsModal.title = t("settings");
  els.openSettingsModal.setAttribute("aria-label", t("settings"));

  setText("#fileMenuButton", "fileMenu");
  setText("#analysisMenuButton", "analysisMenu");
  setText("#openFileMenuItem", "openFile");
  setText("#openFolderButton", "openFolder");
  setText("#analysisMenuCompareAction", "compare");
  setText("#saveFiltered", "saveFiltered");
  setPlaceholder("#filterInput", "filterPlaceholder");
  updateFilterResultsButton();
  setLeadingText(".toolbar label.checkbox:nth-of-type(2)", "regex");
  setLeadingText(".toolbar label.checkbox:nth-of-type(3)", "caseSensitive");
  setPlaceholder("#searchInput", "searchPlaceholder");
  setText("#openSearchResults", "search");
  setText("#openMarkedRows", "allMarked");
  setText("#jumpLineButton", "jump");
  els.jumpLineButton.title = t("jumpTitle");
  els.jumpLineButton.setAttribute("aria-label", t("jumpTitle"));
  setLeadingText("#jumpLinePopover label", "lineNumber");
  setPlaceholder("#jumpLineInput", "jumpLinePlaceholder");
  setText("#confirmJumpLine", "confirm");
  els.prevMarkedLine.title = t("prevMarked");
  els.nextMarkedLine.title = t("nextMarked");

  setText("#importModalTitle", "importTitle");
  setText("#importModalMeta", "importIntro");
  setText("#importFilterLogFile", "importFilterLogFile");
  els.openFilterHistory.title = t("filterHistory");
  els.openFilterHistory.setAttribute("aria-label", t("filterHistory"));
  setText("#closeImportModal", "close");
  setLeadingText(".import-modal-body > label", "serviceUrl");
  setText(".import-modal-body .analysis-path-field > span", "breakpointsFile");
  setText("#viewBreakpointsFile", "view");
  setAnalysisPathFallbacks();
  setAnalysisServiceStatusText();
  setText("#analyzeButton", "getBreakpointLogs");
  setText("#openToolsPage", "tools");
  setText(".common-filter-header h3", "commonFilters");
  els.addCommonFilter.title = t("addCommonFilter");
  els.addCommonFilter.setAttribute("aria-label", t("addCommonFilter"));
  els.importCommonFilters.title = t("importCommonFilters");
  els.importCommonFilters.setAttribute("aria-label", t("importCommonFilters"));
  els.exportCommonFilters.title = t("exportCommonFilters");
  els.exportCommonFilters.setAttribute("aria-label", t("exportCommonFilters"));
  setText("#commonFilterModalTitle", "addCommonFilter");
  setText("#commonFilterModalMeta", "commonFilterIntro");
  setLeadingText(".common-filter-modal-body label:nth-of-type(1)", "commonFilterTitle");
  setLeadingText(".common-filter-modal-body label:nth-of-type(2)", "commonFilterText");
  setText("#saveCommonFilter", "save");
  setText("#closeCommonFilterModal", "close");
  setText("#settingsModalTitle", "userSettings");
  setText("#settingsModalMeta", "settingsIntro");
  setText(".settings-section:nth-of-type(1) h3", "basicSettings");
  setLeadingText(".settings-section:nth-of-type(1) label:nth-of-type(1)", "serviceUrl");
  setLeadingText(".settings-section:nth-of-type(1) label:nth-of-type(2)", "language");
  setText("#saveSettingsBasics", "saveSettings");
  setText("#backupSettings", "backupSettings");
  setText("#restoreSettings", "restoreSettings");
  setText("#closeSettingsModal", "close");
  const settingsLanguageOptions = els.settingsLanguage.querySelectorAll("option");
  if (settingsLanguageOptions[0]) settingsLanguageOptions[0].textContent = t("languageEn");
  if (settingsLanguageOptions[1]) settingsLanguageOptions[1].textContent = t("languageZh");
  setText(".settings-section:nth-of-type(2) h3", "commonFilters");
  setText("#settingsAddCommonFilter", "add");
  setText(".settings-section:nth-of-type(3) h3", "filterHistory");
  setText("#clearFilterHistory", "clear");
  setText("#comparePickerTitle", "chooseCompareLogs");
  setText("#comparePickerMeta", "chooseTwoDifferentLogs");
  setText("#compareLeftTitle", "leftLog");
  setText("#compareRightTitle", "rightLog");
  setText("#confirmComparePicker", "compare");
  setText("#cancelComparePicker", "cancel");
  setText("#compareModalTitle", "compareLogs");
  setText("#compareModalLeftTitle", "leftLog");
  setText("#compareModalRightTitle", "rightLog");
  setText("#closeCompareModal", "close");
  setPlaceholder("#compareLeftFilter", "filterPlaceholder");
  setPlaceholder("#compareRightFilter", "filterPlaceholder");
  setLeadingText("#compareModal .compare-log-pane:nth-of-type(1) .compact-checkbox:nth-of-type(1)", "regex");
  setLeadingText("#compareModal .compare-log-pane:nth-of-type(1) .compact-checkbox:nth-of-type(2)", "caseSensitive");
  setLeadingText("#compareModal .compare-log-pane:nth-of-type(2) .compact-checkbox:nth-of-type(1)", "regex");
  setLeadingText("#compareModal .compare-log-pane:nth-of-type(2) .compact-checkbox:nth-of-type(2)", "caseSensitive");
  setPlaceholder("#compareLeftJumpInput", "jumpLinePlaceholder");
  setPlaceholder("#compareRightJumpInput", "jumpLinePlaceholder");
  setText("#compareLeftJumpButton", "jump");
  setText("#compareRightJumpButton", "jump");
  for (const button of [els.compareLeftPrevMark, els.compareRightPrevMark]) {
    button.title = t("prevMarked");
    button.setAttribute("aria-label", t("prevMarked"));
  }
  for (const button of [els.compareLeftNextMark, els.compareRightNextMark]) {
    button.title = t("nextMarked");
    button.setAttribute("aria-label", t("nextMarked"));
  }
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
  renderCommonFilters();
  renderSettings();
  renderFileTabs();
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
  const fileKey = getFileKey(file);
  const existingTab = findTabByFileKey(fileKey);
  if (existingTab) {
    switchLogTab(existingTab.id);
    return false;
  }
  const text = await file.text();
  saveActiveTabControls();
  const currentTab = getActiveTab();
  const targetTab = currentTab.fileName ? createLogTab() : currentTab;
  if (!state.tabs.includes(targetTab)) state.tabs.push(targetTab);
  state.activeTabId = targetTab.id;
  state.fileName = file.name;
  state.filePath = getFileDisplayPath(file);
  state.fileKey = fileKey;
  state.fileSize = file.size;
  state.fileLastModified = file.lastModified || 0;
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
  state.filterText = "";
  state.searchText = "";
  state.filterRegex = false;
  state.filterCase = false;
  state.tableScrollTop = 0;
  closeSearchModal();
  restoreActiveTabControls();
  updateFileMeta();
  els.dropZone.classList.add("hidden");
  els.tableWrap.classList.remove("hidden");
  updateLevelFilterOptions();
  applyFilter();
  updateAnalyzeButtonState();
  renderFileTabs();
  return true;
}

async function openFiles(files, options = {}) {
  const fileList = Array.from(files || []);
  const filteredFiles = options.onlyText
    ? fileList.filter(isTextFile)
    : fileList;
  filteredFiles.sort((left, right) => {
    const leftPath = getFileDisplayPath(left);
    const rightPath = getFileDisplayPath(right);
    return leftPath.localeCompare(rightPath);
  });
  if (options.onlyText && !filteredFiles.length) {
    showToast(t("noTextFilesInFolder"));
    return;
  }
  let openedCount = 0;
  for (const file of filteredFiles) {
    if (await openFile(file)) openedCount += 1;
  }
  if (!openedCount && filteredFiles.length) {
    renderFileTabs();
  }
}

function isTextFile(file) {
  const name = getFileDisplayPath(file).toLowerCase();
  const basename = name.split("/").pop() || name;
  if (!basename || basename === ".ds_store" || basename.startsWith("._")) return false;
  const dotIndex = basename.lastIndexOf(".");
  const extension = dotIndex >= 0 ? basename.slice(dotIndex) : "";
  if (TEXT_FILE_EXTENSIONS.has(extension)) return true;
  return typeof file.type === "string" && file.type.startsWith("text/");
}

function getFileDisplayPath(file) {
  return fileRelativePaths.get(file) || file.webkitRelativePath || file.path || file.name || "";
}

function getFileKey(file) {
  return [
    normalizeFileKey(file.name || ""),
    Number(file.size || 0),
    Number(file.lastModified || 0),
  ].join(":");
}

function normalizeFileKey(value) {
  return String(value || "").replace(/\\/g, "/").trim().toLowerCase();
}

function findTabByFileKey(fileKey) {
  if (!fileKey) return null;
  return state.tabs.find((tab) => {
    if (!tab.fileName) return false;
    const tabKey = tab.fileKey || [
      normalizeFileKey(tab.fileName || ""),
      Number(tab.fileSize || 0),
      Number(tab.fileLastModified || 0),
    ].join(":");
    return tabKey === fileKey;
  }) || null;
}

async function openFolder() {
  closeTopMenus();
  if (window.showDirectoryPicker) {
    try {
      const directoryHandle = await window.showDirectoryPicker();
      const files = [];
      await collectDirectoryFiles(directoryHandle, "", files);
      await openFiles(files, { onlyText: true });
      return;
    } catch (error) {
      if (error && error.name === "AbortError") return;
      showToast(error.message || t("noTextFilesInFolder"));
      return;
    }
  }
  els.directoryInput.value = "";
  els.directoryInput.click();
}

async function collectDirectoryFiles(directoryHandle, prefix, files) {
  for await (const [name, handle] of directoryHandle.entries()) {
    const relativePath = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      await collectDirectoryFiles(handle, relativePath, files);
      continue;
    }
    if (handle.kind !== "file") continue;
    const file = await handle.getFile();
    fileRelativePaths.set(file, relativePath);
    files.push(file);
  }
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
  els.logPanel.classList.toggle("log-has-file", state.rows.length > 0);
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
  saveActiveTabControls();
  updateFilterResultsButton();
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
  state.tableScrollTop = 0;
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

function updateFilterResultsButton() {
  els.viewFilterResults.classList.remove("hidden");
  const key = els.filterInput.value.trim() ? "view" : "import";
  els.viewFilterResults.textContent = t(key);
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
  return findMatchingFilterRuleWithOptions(row, filterRules, {
    regex: els.filterRegex.checked,
    caseSensitive: els.filterCase.checked,
  });
}

function findMatchingFilterRuleWithOptions(row, filterRules, options) {
  if (!filterRules.length) return "";
  if (options.regex) {
    const flags = options.caseSensitive ? "" : "i";
    for (const rule of filterRules) {
      try {
        if (new RegExp(rule, flags).test(row.searchable)) return rule;
      } catch {
        return "";
      }
    }
    return "";
  }
  const haystack = options.caseSensitive ? row.searchable : row.searchable.toLowerCase();
  return filterRules.find((rule) => haystack.includes(options.caseSensitive ? rule : rule.toLowerCase())) || "";
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

function toggleJumpLinePopover(event) {
  event.stopPropagation();
  const hidden = els.jumpLinePopover.classList.contains("hidden");
  if (hidden) {
    positionJumpLinePopover();
    els.jumpLinePopover.classList.remove("hidden");
    window.requestAnimationFrame(() => {
      els.jumpLineInput.focus();
      els.jumpLineInput.select();
    });
  } else {
    closeJumpLinePopover();
  }
}

function positionJumpLinePopover() {
  const rect = els.jumpLineButton.getBoundingClientRect();
  els.jumpLinePopover.style.left = `${Math.max(8, rect.left)}px`;
  els.jumpLinePopover.style.top = `${rect.bottom + 4}px`;
}

function closeJumpLinePopover() {
  els.jumpLinePopover.classList.add("hidden");
}

function confirmJumpLine() {
  const sourceLine = Number.parseInt(els.jumpLineInput.value, 10);
  if (!Number.isFinite(sourceLine) || sourceLine < 1) {
    showToast(state.language === "en" ? "Enter a valid line number." : "请输入有效行号。");
    return;
  }

  const visibleIndex = state.visibleRows.findIndex((row) => row.sourceLine === sourceLine);
  if (visibleIndex < 0) {
    showToast(state.language === "en"
      ? "That line is not visible in the current filter."
      : "当前过滤结果中没有该行。");
    return;
  }

  state.activeMarkedLine = sourceLine;
  scrollMainRowIndexIntoView(visibleIndex);
  renderRows();
  closeJumpLinePopover();
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

function getLoadedLogTabs() {
  return state.tabs.filter((tab) => tab.fileName && Array.isArray(tab.rows) && tab.rows.length);
}

function openComparePicker() {
  closeTopMenus();
  const tabs = getLoadedLogTabs();
  if (tabs.length < 2) {
    showToast(t("needTwoLogsToCompare"));
    return;
  }
  const activeTab = tabs.find((tab) => tab.id === state.activeTabId) || tabs[0];
  const rightTab = tabs.find((tab) => tab.id !== activeTab.id) || tabs[1];
  state.compareLeftTabId = activeTab.id;
  state.compareRightTabId = rightTab.id;
  renderComparePicker();
  els.comparePickerModal.classList.remove("hidden");
}

function closeComparePicker() {
  els.comparePickerModal.classList.add("hidden");
}

function renderComparePicker() {
  const tabs = getLoadedLogTabs();
  els.compareLeftList.textContent = "";
  els.compareRightList.textContent = "";
  for (const tab of tabs) {
    els.compareLeftList.append(createComparePickerRow(tab, "left"));
    els.compareRightList.append(createComparePickerRow(tab, "right"));
  }
}

function createComparePickerRow(tab, side) {
  const selectedId = side === "left" ? state.compareLeftTabId : state.compareRightTabId;
  const otherId = side === "left" ? state.compareRightTabId : state.compareLeftTabId;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "compare-picker-row";
  button.classList.toggle("selected", selectedId === tab.id);
  button.classList.toggle("conflict", otherId === tab.id);
  button.title = tab.filePath || tab.fileName;

  const title = document.createElement("strong");
  title.textContent = tab.fileName;
  const meta = document.createElement("span");
  meta.textContent = `${tab.rows.length.toLocaleString()} ${state.language === "en" ? "rows" : "行"} · ${formatBytes(tab.fileSize)}`;
  button.append(title, meta);

  button.addEventListener("click", () => selectCompareTab(side, tab.id));
  return button;
}

function selectCompareTab(side, tabId) {
  if (side === "left" && tabId === state.compareRightTabId) {
    showToast(t("cannotCompareSameLog"));
    return;
  }
  if (side === "right" && tabId === state.compareLeftTabId) {
    showToast(t("cannotCompareSameLog"));
    return;
  }
  if (side === "left") {
    state.compareLeftTabId = tabId;
  } else {
    state.compareRightTabId = tabId;
  }
  renderComparePicker();
}

function confirmComparePicker() {
  const leftTab = state.tabs.find((tab) => tab.id === state.compareLeftTabId);
  const rightTab = state.tabs.find((tab) => tab.id === state.compareRightTabId);
  if (!leftTab || !rightTab || leftTab.id === rightTab.id) {
    showToast(t("cannotCompareSameLog"));
    return;
  }
  closeComparePicker();
  openCompareModal(leftTab, rightTab);
}

function openCompareModal(leftTab, rightTab) {
  state.compareModalLeftTabId = leftTab.id;
  state.compareModalRightTabId = rightTab.id;
  state.compareSides.left = createCompareSideState(leftTab);
  state.compareSides.right = createCompareSideState(rightTab);
  resetCompareControls("left");
  resetCompareControls("right");
  els.compareModalMeta.textContent = `${leftTab.fileName} · ${leftTab.rows.length.toLocaleString()} ${state.language === "en" ? "rows" : "行"}  |  ${rightTab.fileName} · ${rightTab.rows.length.toLocaleString()} ${state.language === "en" ? "rows" : "行"}`;
  els.compareModalLeftTitle.textContent = leftTab.fileName;
  els.compareModalRightTitle.textContent = rightTab.fileName;
  updateLogTableWidthForTables(leftTab.rows, [els.compareLeftTable]);
  updateLogTableWidthForTables(rightTab.rows, [els.compareRightTable]);
  els.compareLeftWrap.scrollTop = 0;
  els.compareRightWrap.scrollTop = 0;
  els.compareModal.classList.remove("hidden");
  renderCompareRows("left");
  renderCompareRows("right");
}

function closeCompareModal() {
  els.compareModal.classList.add("hidden");
  els.compareToast.classList.remove("show");
  state.compareModalLeftTabId = "";
  state.compareModalRightTabId = "";
  state.compareSides.left = null;
  state.compareSides.right = null;
  els.compareLeftBody.textContent = "";
  els.compareRightBody.textContent = "";
}

function requestCloseCompareModal() {
  const message = state.language === "en"
    ? "Close the log comparison window?"
    : "确定关闭日志比较窗口吗？";
  if (!window.confirm(message)) return;
  closeCompareModal();
}

function createCompareSideState(tab) {
  return {
    tabId: tab.id,
    filterText: "",
    filterRegex: false,
    filterCase: false,
    visibleRows: tab.rows.slice(),
    markedLines: new Set(),
    activeMarkedLine: null,
  };
}

function getCompareSideState(side) {
  return state.compareSides[side];
}

function getCompareSideEls(side) {
  return side === "left"
    ? {
        filter: els.compareLeftFilter,
        regex: els.compareLeftRegex,
        caseSensitive: els.compareLeftCase,
        prevMark: els.compareLeftPrevMark,
        nextMark: els.compareLeftNextMark,
        jumpInput: els.compareLeftJumpInput,
        wrap: els.compareLeftWrap,
        table: els.compareLeftTable,
      }
    : {
        filter: els.compareRightFilter,
        regex: els.compareRightRegex,
        caseSensitive: els.compareRightCase,
        prevMark: els.compareRightPrevMark,
        nextMark: els.compareRightNextMark,
        jumpInput: els.compareRightJumpInput,
        wrap: els.compareRightWrap,
        table: els.compareRightTable,
      };
}

function resetCompareControls(side) {
  const sideEls = getCompareSideEls(side);
  sideEls.filter.value = "";
  sideEls.regex.checked = false;
  sideEls.caseSensitive.checked = false;
  sideEls.jumpInput.value = "";
  updateCompareMarkedButtons(side);
}

function getCompareTab(side) {
  const tabId = side === "left" ? state.compareModalLeftTabId : state.compareModalRightTabId;
  return state.tabs.find((tab) => tab.id === tabId);
}

function getCompareFilterRules(side) {
  return getCompareSideEls(side).filter.value
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function applyCompareFilter(side) {
  const compareState = getCompareSideState(side);
  const tab = getCompareTab(side);
  if (!compareState || !tab) return;
  const sideEls = getCompareSideEls(side);
  compareState.filterText = sideEls.filter.value;
  compareState.filterRegex = sideEls.regex.checked;
  compareState.filterCase = sideEls.caseSensitive.checked;
  const rules = getCompareFilterRules(side);
  const matcher = createMatcher(rules, {
    regex: compareState.filterRegex,
    caseSensitive: compareState.filterCase,
  });
  compareState.visibleRows = matcher ? tab.rows.filter((row) => matcher(row.searchable)) : tab.rows.slice();
  if (compareState.activeMarkedLine != null && !compareState.visibleRows.some((row) => row.sourceLine === compareState.activeMarkedLine)) {
    compareState.activeMarkedLine = null;
  }
  updateLogTableWidthForTables(compareState.visibleRows, [sideEls.table]);
  sideEls.wrap.scrollTop = 0;
  renderCompareRows(side);
  updateCompareMarkedButtons(side);
}

function renderCompareRows(side) {
  const tab = getCompareTab(side);
  const compareState = getCompareSideState(side);
  if (!tab || !compareState) return;
  const wrap = side === "left" ? els.compareLeftWrap : els.compareRightWrap;
  const body = side === "left" ? els.compareLeftBody : els.compareRightBody;
  const rows = compareState.visibleRows;
  const viewportHeight = wrap.clientHeight || 1;
  const scrollTop = wrap.scrollTop;
  const start = Math.max(0, Math.floor(scrollTop / LOG_ROW_HEIGHT) - LOG_OVERSCAN_ROWS);
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / LOG_ROW_HEIGHT) + LOG_OVERSCAN_ROWS);
  if (side === "left") {
    state.compareLeftVirtualStart = start;
    state.compareLeftVirtualEnd = end;
  } else {
    state.compareRightVirtualStart = start;
    state.compareRightVirtualEnd = end;
  }

  const fragment = document.createDocumentFragment();
  body.textContent = "";
  if (start > 0) {
    fragment.appendChild(spacerRow(start * LOG_ROW_HEIGHT));
  }
  const filterRules = getCompareFilterRules(side);
  for (let index = start; index < end; index += 1) {
    fragment.appendChild(createCompareLogRow(rows[index], side, getCompareRowHighlight(rows[index], side, filterRules)));
  }
  const bottomRows = rows.length - end;
  if (bottomRows > 0) {
    fragment.appendChild(spacerRow(bottomRows * LOG_ROW_HEIGHT));
  }
  body.appendChild(fragment);
}

function getCompareRowHighlight(row, side, filterRules) {
  const compareState = getCompareSideState(side);
  if (!compareState) return "";
  const matchedRule = findMatchingFilterRuleWithOptions(row, filterRules, {
    regex: compareState.filterRegex,
    caseSensitive: compareState.filterCase,
  });
  return matchedRule
    ? { query: matchedRule, regex: compareState.filterRegex, caseSensitive: compareState.filterCase }
    : "";
}

function createCompareLogRow(row, side, activeSearch) {
  const compareState = getCompareSideState(side);
  const tr = document.createElement("tr");
  tr.title = "双击复制当前行";
  if (compareState?.markedLines.has(row.sourceLine)) {
    tr.classList.add("marked-row");
  }
  if (compareState?.activeMarkedLine === row.sourceLine) {
    tr.classList.add("active-match");
  }
  const lineCell = cell(row.sourceLine, "line-col");
  lineCell.title = "点击标记或取消标记当前行";
  lineCell.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleCompareMarkedLine(side, row.sourceLine);
  });
  tr.append(
    lineCell,
    cell(highlight(row.time, activeSearch), "time-col"),
    cell(row.level, `level-col level-${row.level || "none"}`),
    cell(highlight(row.tag, activeSearch), "tag-col"),
    cell(highlight(row.message, activeSearch), "message-col")
  );
  tr.addEventListener("dblclick", () => copyLine(row.raw));
  return tr;
}

function toggleCompareMarkedLine(side, sourceLine) {
  const compareState = getCompareSideState(side);
  if (!compareState) return;
  if (compareState.markedLines.has(sourceLine)) {
    compareState.markedLines.delete(sourceLine);
    if (compareState.activeMarkedLine === sourceLine) {
      compareState.activeMarkedLine = null;
    }
  } else {
    compareState.markedLines.add(sourceLine);
    compareState.activeMarkedLine = sourceLine;
  }
  renderCompareRows(side);
  updateCompareMarkedButtons(side);
}

function getVisibleCompareMarkedRows(side) {
  const compareState = getCompareSideState(side);
  if (!compareState) return [];
  return compareState.visibleRows.filter((row) => compareState.markedLines.has(row.sourceLine));
}

function goCompareMarkedLine(side, direction) {
  const compareState = getCompareSideState(side);
  if (!compareState) return;
  const markedRows = getVisibleCompareMarkedRows(side);
  if (!markedRows.length) return;
  const currentIndex = compareState.activeMarkedLine == null
    ? -1
    : markedRows.findIndex((row) => row.sourceLine === compareState.activeMarkedLine);
  const nextIndex = currentIndex < 0
    ? (direction > 0 ? 0 : markedRows.length - 1)
    : (currentIndex + direction + markedRows.length) % markedRows.length;
  const targetRow = markedRows[nextIndex];
  const visibleIndex = compareState.visibleRows.indexOf(targetRow);
  if (visibleIndex < 0) return;
  compareState.activeMarkedLine = targetRow.sourceLine;
  scrollCompareRowIndexIntoView(side, visibleIndex);
  renderCompareRows(side);
  updateCompareMarkedButtons(side);
}

function confirmCompareJump(side) {
  const compareState = getCompareSideState(side);
  if (!compareState) return;
  const sideEls = getCompareSideEls(side);
  const sourceLine = Number.parseInt(sideEls.jumpInput.value, 10);
  if (!Number.isFinite(sourceLine) || sourceLine < 1) {
    showToast(state.language === "en" ? "Enter a valid line number." : "请输入有效行号。");
    return;
  }
  const visibleIndex = compareState.visibleRows.findIndex((row) => row.sourceLine === sourceLine);
  if (visibleIndex < 0) {
    showToast(state.language === "en"
      ? "That line is not visible in the current filter."
      : "当前过滤结果中没有该行。");
    return;
  }
  compareState.activeMarkedLine = sourceLine;
  scrollCompareRowIndexIntoView(side, visibleIndex);
  renderCompareRows(side);
  updateCompareMarkedButtons(side);
}

function scrollCompareRowIndexIntoView(side, index) {
  const wrap = side === "left" ? els.compareLeftWrap : els.compareRightWrap;
  const viewportHeight = wrap.clientHeight || 0;
  wrap.scrollTop = Math.max(0, index * LOG_ROW_HEIGHT - Math.max(0, viewportHeight - LOG_ROW_HEIGHT) / 2);
}

function updateCompareMarkedButtons(side) {
  const hasMarkedRows = getVisibleCompareMarkedRows(side).length > 0;
  const sideEls = getCompareSideEls(side);
  for (const button of [sideEls.prevMark, sideEls.nextMark]) {
    button.disabled = !hasMarkedRows;
    button.classList.toggle("available", hasMarkedRows);
  }
}

function scheduleCompareRowsRender(side) {
  if (side === "left") {
    if (compareLeftVirtualScrollFrame) return;
    compareLeftVirtualScrollFrame = window.requestAnimationFrame(() => {
      compareLeftVirtualScrollFrame = 0;
      renderCompareRows("left");
    });
    return;
  }
  if (compareRightVirtualScrollFrame) return;
  compareRightVirtualScrollFrame = window.requestAnimationFrame(() => {
    compareRightVirtualScrollFrame = 0;
    renderCompareRows("right");
  });
}

function openImportModal() {
  els.importModal.classList.remove("hidden");
  checkAnalysisService();
}

function closeImportModal() {
  els.importModal.classList.add("hidden");
  closeFilterHistoryPopover();
}

function handleFilterAction() {
  if (els.filterInput.value.trim()) {
    filterLogsByBreakpointText();
    return;
  }
  openImportModal();
}

function renderCommonFilters() {
  els.commonFilterList.textContent = "";
  if (!state.commonFilters.length) {
    const empty = document.createElement("div");
    empty.className = "common-filter-empty";
    empty.textContent = t("commonFilterEmpty");
    els.commonFilterList.append(empty);
    return;
  }

  for (const item of state.commonFilters) {
    const row = document.createElement("div");
    row.className = "common-filter-item";
    row.draggable = true;
    row.dataset.id = item.id;
    const main = document.createElement("button");
    main.type = "button";
    main.className = "common-filter-item-main";
    const title = document.createElement("span");
    title.className = "common-filter-item-title";
    title.textContent = item.title;
    const preview = document.createElement("span");
    preview.className = "common-filter-item-preview";
    preview.textContent = item.filterText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).join(" | ");
    main.append(title, preview);
    main.addEventListener("click", () => applyCommonFilter(item));

    const actions = document.createElement("div");
    actions.className = "common-filter-item-actions";
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.title = t("edit");
    editButton.setAttribute("aria-label", t("edit"));
    editButton.textContent = "✎";
    editButton.addEventListener("click", (event) => {
      event.stopPropagation();
      openCommonFilterModal(item);
    });
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger";
    deleteButton.title = t("delete");
    deleteButton.setAttribute("aria-label", t("delete"));
    deleteButton.textContent = "×";
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteCommonFilter(item);
    });
    actions.append(editButton, deleteButton);

    row.append(main, actions);
    row.addEventListener("dragstart", (event) => {
      state.draggedCommonFilterId = item.id;
      row.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", item.id);
    });
    row.addEventListener("dragend", () => {
      state.draggedCommonFilterId = "";
      row.classList.remove("dragging");
    });
    row.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    });
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      reorderCommonFilter(state.draggedCommonFilterId || event.dataTransfer.getData("text/plain"), item.id);
    });
    els.commonFilterList.append(row);
  }
}

function openCommonFilterModal(item = null) {
  state.editingCommonFilterId = item ? item.id : "";
  els.commonFilterTitleInput.value = item ? item.title : "";
  els.commonFilterTextInput.value = item ? item.filterText : "";
  document.getElementById("commonFilterModalTitle").textContent = item ? t("editCommonFilter") : t("addCommonFilter");
  els.commonFilterModal.classList.remove("hidden");
  window.requestAnimationFrame(() => els.commonFilterTitleInput.focus());
}

function closeCommonFilterModal() {
  state.editingCommonFilterId = "";
  els.commonFilterModal.classList.add("hidden");
}

function saveCommonFilter() {
  const title = els.commonFilterTitleInput.value.trim();
  const filterText = els.commonFilterTextInput.value.trim();
  if (!title || !filterText) {
    showToast(state.language === "en" ? "Enter a title and filter." : "请输入标题和过滤词。");
    return;
  }

  if (state.editingCommonFilterId) {
    state.commonFilters = state.commonFilters.map((item) => (
      item.id === state.editingCommonFilterId ? { ...item, title, filterText } : item
    ));
  } else {
    state.commonFilters.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title,
      filterText,
    });
  }
  saveCommonFilters();
  renderCommonFilters();
  renderSettingsCommonFilters();
  closeCommonFilterModal();
}

function deleteCommonFilter(item) {
  const confirmed = window.confirm(state.language === "en"
    ? `Delete "${item.title}"?`
    : `确认删除“${item.title}”？`);
  if (!confirmed) return;
  state.commonFilters = state.commonFilters.filter((value) => value.id !== item.id);
  saveCommonFilters();
  renderCommonFilters();
  renderSettingsCommonFilters();
}

function exportCommonFilters() {
  const content = JSON.stringify({
    version: 1,
    commonFilters: state.commonFilters.map(({ title, filterText }) => ({ title, filterText })),
  }, null, 2);
  downloadText(content, "mylogger-common-filters.json");
}

function openCommonFilterFilePicker() {
  els.commonFilterFileInput.value = "";
  els.commonFilterFileInput.click();
}

async function importCommonFilters(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (error) {
    showToast(state.language === "en" ? `Invalid JSON: ${error.message}` : `JSON 无效：${error.message}`);
    return;
  }

  const source = Array.isArray(data) ? data : data && data.commonFilters;
  if (!Array.isArray(source)) {
    showToast(state.language === "en" ? "No common filters found." : "未找到常用过滤。");
    return;
  }

  const imported = source
    .map((item) => ({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: String(item.title || "").trim(),
      filterText: String(item.filterText || "").trim(),
    }))
    .filter((item) => item.title && item.filterText);
  if (!imported.length) {
    showToast(state.language === "en" ? "No valid common filters found." : "未找到有效的常用过滤。");
    return;
  }

  const existingByText = new Map(state.commonFilters.map((item) => [item.filterText, item]));
  for (const item of imported) {
    existingByText.set(item.filterText, item);
  }
  state.commonFilters = Array.from(existingByText.values());
  saveCommonFilters();
  renderCommonFilters();
  renderSettingsCommonFilters();
  showToast(state.language === "en"
    ? `Imported ${imported.length} common filters.`
    : `已导入 ${imported.length} 条常用过滤。`);
}

function reorderCommonFilter(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const sourceIndex = state.commonFilters.findIndex((item) => item.id === sourceId);
  const targetIndex = state.commonFilters.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return;
  const next = state.commonFilters.slice();
  const [source] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, source);
  state.commonFilters = next;
  saveCommonFilters();
  renderCommonFilters();
  renderSettingsCommonFilters();
}

function applyCommonFilter(item) {
  const confirmed = window.confirm(state.language === "en"
    ? `Replace the top Filter with "${item.title}"?`
    : `确认使用“${item.title}”覆盖顶部过滤内容？`);
  if (!confirmed) return;
  els.filterInput.value = item.filterText;
  rememberFilterHistory(item.filterText, item.title);
  applyFilter();
}

function toggleFilterHistoryPopover(event) {
  event.stopPropagation();
  const hidden = els.filterHistoryPopover.classList.contains("hidden");
  if (hidden) {
    renderFilterHistory();
    positionFilterHistoryPopover();
    els.filterHistoryPopover.classList.remove("hidden");
  } else {
    closeFilterHistoryPopover();
  }
}

function positionFilterHistoryPopover() {
  const rect = els.openFilterHistory.getBoundingClientRect();
  const width = Math.min(460, window.innerWidth - 24);
  els.filterHistoryPopover.style.width = `${width}px`;
  els.filterHistoryPopover.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`;
  els.filterHistoryPopover.style.top = `${rect.bottom + 4}px`;
}

function closeFilterHistoryPopover() {
  els.filterHistoryPopover.classList.add("hidden");
}

function renderFilterHistory() {
  els.filterHistoryPopover.textContent = "";
  if (!state.filterHistory.length) {
    const empty = document.createElement("div");
    empty.className = "filter-history-empty";
    empty.textContent = t("filterHistoryEmpty");
    els.filterHistoryPopover.append(empty);
    return;
  }

  for (const item of state.filterHistory.slice(0, 20)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-history-item";
    const title = document.createElement("span");
    title.className = "filter-history-title";
    title.textContent = item.title;
    const preview = document.createElement("span");
    preview.className = "filter-history-preview";
    preview.textContent = item.filterText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).join(" | ");
    button.append(title, preview);
    button.addEventListener("click", () => applyFilterHistory(item));
    els.filterHistoryPopover.append(button);
  }
}

function applyFilterHistory(item) {
  els.filterInput.value = item.filterText;
  rememberFilterHistory(item.filterText, item.title);
  applyFilter();
  closeFilterHistoryPopover();
  closeImportModal();
}

function openFilterLogFilePicker() {
  els.filterLogFileInput.value = "";
  els.filterLogFileInput.click();
}

async function importFilterLogFile(file) {
  const text = await file.text();
  const filterText = extractBreakpointLogText(text).trim();
  if (!filterText) {
    showToast(state.language === "en"
      ? "No filter logs found in this file."
      : "文件中未找到过滤日志。");
    return;
  }

  els.filterInput.value = filterText;
  rememberFilterHistory(filterText, file.name);
  applyFilter();
  closeImportModal();
  showToast(state.language === "en"
    ? `Imported filter logs: ${file.name}`
    : `已导入过滤日志：${file.name}`);
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

function syncServiceEndpoint(value) {
  const endpoint = String(value || "").trim() || DEFAULT_ANALYSIS_ENDPOINT;
  state.serviceEndpoint = endpoint;
  localStorage.setItem(SERVICE_ENDPOINT_STORAGE_KEY, endpoint);
  els.analysisEndpoint.value = endpoint;
  if (els.settingsServiceEndpoint) els.settingsServiceEndpoint.value = endpoint;
}

function openSettingsModal() {
  els.settingsServiceEndpoint.value = state.serviceEndpoint || DEFAULT_ANALYSIS_ENDPOINT;
  els.settingsLanguage.value = state.language;
  renderSettings();
  els.settingsModal.classList.remove("hidden");
}

function closeSettingsModal() {
  els.settingsModal.classList.add("hidden");
}

function renderSettings() {
  if (!els.settingsCommonFilterList || !els.settingsFilterHistoryList) return;
  els.settingsLanguage.value = state.language;
  els.settingsServiceEndpoint.value = state.serviceEndpoint || DEFAULT_ANALYSIS_ENDPOINT;
  renderSettingsCommonFilters();
  renderSettingsFilterHistory();
}

function renderSettingsCommonFilters() {
  els.settingsCommonFilterList.textContent = "";
  if (!state.commonFilters.length) {
    const empty = document.createElement("div");
    empty.className = "settings-empty";
    empty.textContent = t("commonFilterEmpty");
    els.settingsCommonFilterList.append(empty);
    return;
  }

  for (const item of state.commonFilters) {
    const row = document.createElement("div");
    row.className = "settings-list-item";
    const content = document.createElement("div");
    content.className = "settings-list-item-content";
    const title = document.createElement("strong");
    title.textContent = item.title;
    const preview = document.createElement("span");
    preview.textContent = item.filterText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).join(" | ");
    content.append(title, preview);

    const actions = document.createElement("div");
    actions.className = "settings-list-item-actions";
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = t("edit");
    editButton.addEventListener("click", () => openCommonFilterModal(item));
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger";
    deleteButton.textContent = t("delete");
    deleteButton.addEventListener("click", () => deleteCommonFilter(item));
    actions.append(editButton, deleteButton);
    row.append(content, actions);
    els.settingsCommonFilterList.append(row);
  }
}

function renderSettingsFilterHistory() {
  els.settingsFilterHistoryList.textContent = "";
  if (!state.filterHistory.length) {
    const empty = document.createElement("div");
    empty.className = "settings-empty";
    empty.textContent = t("filterHistoryEmpty");
    els.settingsFilterHistoryList.append(empty);
    return;
  }

  for (const item of state.filterHistory.slice().sort((left, right) => right.createdAt - left.createdAt)) {
    const row = document.createElement("div");
    row.className = "settings-list-item";
    const content = document.createElement("div");
    content.className = "settings-list-item-content";
    const title = document.createElement("strong");
    title.textContent = item.title;
    const preview = document.createElement("span");
    preview.textContent = item.filterText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).join(" | ");
    content.append(title, preview);

    const actions = document.createElement("div");
    actions.className = "settings-list-item-actions";
    const useButton = document.createElement("button");
    useButton.type = "button";
    useButton.textContent = t("confirm");
    useButton.addEventListener("click", () => {
      applyFilterHistory(item);
      closeSettingsModal();
    });
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger";
    deleteButton.textContent = t("delete");
    deleteButton.addEventListener("click", () => deleteFilterHistory(item));
    actions.append(useButton, deleteButton);
    row.append(content, actions);
    els.settingsFilterHistoryList.append(row);
  }
}

function saveSettingsBasics() {
  syncServiceEndpoint(els.settingsServiceEndpoint.value);
  setLanguage(els.settingsLanguage.value);
  checkAnalysisService();
  showToast(state.language === "en" ? "Settings saved." : "配置已保存。");
}

function deleteFilterHistory(item) {
  state.filterHistory = state.filterHistory.filter((value) => value.id !== item.id);
  saveFilterHistory();
  renderFilterHistoryPopover();
  renderSettingsFilterHistory();
}

function clearFilterHistory() {
  if (!state.filterHistory.length) return;
  const confirmed = window.confirm(state.language === "en" ? "Clear all filter history?" : "确认清除全部历史过滤？");
  if (!confirmed) return;
  state.filterHistory = [];
  saveFilterHistory();
  renderFilterHistoryPopover();
  renderSettingsFilterHistory();
}

function createSettingsBackup() {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    serviceEndpoint: state.serviceEndpoint || DEFAULT_ANALYSIS_ENDPOINT,
    language: state.language,
    commonFilters: state.commonFilters.map(({ title, filterText }) => ({ title, filterText })),
    filterHistory: state.filterHistory.map(({ title, filterText, createdAt }) => ({ title, filterText, createdAt })),
  };
}

function backupSettings() {
  downloadText(JSON.stringify(createSettingsBackup(), null, 2), "mylogger-settings-backup.json");
}

function openSettingsBackupPicker() {
  els.settingsBackupInput.value = "";
  els.settingsBackupInput.click();
}

async function restoreSettings(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (error) {
    showToast(state.language === "en" ? `Invalid JSON: ${error.message}` : `JSON 无效：${error.message}`);
    return;
  }

  if (!data || typeof data !== "object") {
    showToast(state.language === "en" ? "Invalid settings backup." : "配置备份无效。");
    return;
  }

  syncServiceEndpoint(data.serviceEndpoint || DEFAULT_ANALYSIS_ENDPOINT);
  if (data.language === "zh" || data.language === "en") {
    state.language = data.language;
    localStorage.setItem(LANGUAGE_STORAGE_KEY, data.language);
  }
  state.commonFilters = normalizeCommonFilters(data.commonFilters);
  state.filterHistory = normalizeFilterHistory(data.filterHistory);
  saveCommonFilters();
  saveFilterHistory();
  applyLanguage();
  checkAnalysisService();
  showToast(state.language === "en" ? "Settings restored." : "配置已恢复。");
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
    const filterText = extractBreakpointLogText(resultText);
    els.filterInput.value = filterText;
    rememberFilterHistory(filterText, state.breakpointsFileName || t("getBreakpointLogs"));
    applyFilter();
    closeImportModal();
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
  rememberFilterHistory(els.filterInput.value, t("filter"));

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
  if (!els.compareModal.classList.contains("hidden")) {
    showCompareToast(message);
    return;
  }
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 1800);
}

function showCompareToast(message) {
  els.compareToast.textContent = message;
  els.compareToast.classList.add("show");
  window.clearTimeout(showCompareToast.timer);
  showCompareToast.timer = window.setTimeout(() => els.compareToast.classList.remove("show"), 1800);
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

function toggleTopMenu(menuName, event) {
  event.stopPropagation();
  openTopMenu(menuName);
}

function openTopMenu(menuName) {
  const button = menuName === "file" ? els.fileMenuButton : els.analysisMenuButton;
  const popover = menuName === "file" ? els.fileMenuPopover : els.analysisMenuPopover;
  closeTopMenus();
  popover.classList.remove("hidden");
  button.classList.add("active");
  button.setAttribute("aria-expanded", "true");
}

function closeTopMenus() {
  for (const [button, popover] of [
    [els.fileMenuButton, els.fileMenuPopover],
    [els.analysisMenuButton, els.analysisMenuPopover],
  ]) {
    popover.classList.add("hidden");
    button.classList.remove("active");
    button.setAttribute("aria-expanded", "false");
  }
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
  const files = Array.from(event.target.files || []);
  void openFiles(files);
  els.fileInput.value = "";
});

els.fileMenuButton.addEventListener("click", (event) => toggleTopMenu("file", event));
els.analysisMenuButton.addEventListener("click", (event) => toggleTopMenu("analysis", event));
els.fileMenuButton.parentElement.addEventListener("mouseenter", () => openTopMenu("file"));
els.fileMenuButton.parentElement.addEventListener("mouseleave", closeTopMenus);
els.analysisMenuButton.parentElement.addEventListener("mouseenter", () => openTopMenu("analysis"));
els.analysisMenuButton.parentElement.addEventListener("mouseleave", closeTopMenus);
els.fileMenuPopover.addEventListener("click", (event) => event.stopPropagation());
els.analysisMenuPopover.addEventListener("click", (event) => event.stopPropagation());
document.addEventListener("click", closeTopMenus);

els.openFileMenuItem.addEventListener("click", () => {
  closeTopMenus();
  els.fileInput.click();
});

els.openFolderButton.addEventListener("click", openFolder);

els.analysisMenuCompareAction.addEventListener("click", openComparePicker);

els.directoryInput.addEventListener("change", (event) => {
  const files = Array.from(event.target.files || []);
  void openFiles(files, { onlyText: true });
  els.directoryInput.value = "";
});

els.breakpointsInput.addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (file) openBreakpointsFile(file);
});

els.filterLogFileInput.addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (file) importFilterLogFile(file);
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
els.jumpLineButton.addEventListener("click", toggleJumpLinePopover);
els.jumpLinePopover.addEventListener("click", (event) => event.stopPropagation());
els.confirmJumpLine.addEventListener("click", confirmJumpLine);
els.jumpLineInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  confirmJumpLine();
});
document.addEventListener("click", closeJumpLinePopover);
els.searchInput.addEventListener("input", markSearchDirty);
els.languageButton.addEventListener("click", toggleLanguagePopover);
els.languagePopover.addEventListener("click", (event) => {
  event.stopPropagation();
  const button = event.target.closest("button[data-language]");
  if (button) setLanguage(button.dataset.language);
});
document.addEventListener("click", closeLanguagePopover);
els.analysisEndpoint.addEventListener("input", () => {
  const endpoint = els.analysisEndpoint.value.trim();
  state.serviceEndpoint = endpoint;
  if (endpoint) {
    localStorage.setItem(SERVICE_ENDPOINT_STORAGE_KEY, endpoint);
  } else {
    localStorage.removeItem(SERVICE_ENDPOINT_STORAGE_KEY);
  }
  if (els.settingsServiceEndpoint) els.settingsServiceEndpoint.value = endpoint;
  scheduleAnalysisServiceCheck();
});
els.analysisStatusButton.addEventListener("click", checkAnalysisService);
els.viewFilterResults.addEventListener("click", handleFilterAction);
els.importFilterLogFile.addEventListener("click", openFilterLogFilePicker);
els.openFilterHistory.addEventListener("click", toggleFilterHistoryPopover);
els.filterHistoryPopover.addEventListener("click", (event) => event.stopPropagation());
document.addEventListener("click", closeFilterHistoryPopover);
els.openToolsPage.addEventListener("click", openToolsPage);
els.addCommonFilter.addEventListener("click", openCommonFilterModal);
els.importCommonFilters.addEventListener("click", openCommonFilterFilePicker);
els.exportCommonFilters.addEventListener("click", exportCommonFilters);
els.commonFilterFileInput.addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (file) importCommonFilters(file);
});
els.commonFilterModal.addEventListener("click", (event) => {
  if (event.target === els.commonFilterModal) closeCommonFilterModal();
});
els.closeCommonFilterModal.addEventListener("click", closeCommonFilterModal);
els.saveCommonFilter.addEventListener("click", saveCommonFilter);
els.commonFilterTextInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
  event.preventDefault();
  saveCommonFilter();
});
els.openSearchResults.addEventListener("click", openSearchResults);
els.openMarkedRows.addEventListener("click", openMarkedRows);
els.closeSearchModal.addEventListener("click", closeSearchModal);
els.contextModal.addEventListener("click", (event) => {
  if (event.target === els.contextModal) closeContextModal();
});
els.closeContextModal.addEventListener("click", closeContextModal);
els.closeAnalysisModal.addEventListener("click", closeAnalysisModal);
els.importModal.addEventListener("click", (event) => {
  if (event.target === els.importModal) closeImportModal();
});
els.closeImportModal.addEventListener("click", closeImportModal);
els.closeBreakpointsModal.addEventListener("click", closeBreakpointsModal);
els.openHelpModal.addEventListener("click", openHelpModal);
els.closeHelpModal.addEventListener("click", closeHelpModal);
els.openSettingsModal.addEventListener("click", openSettingsModal);
els.settingsModal.addEventListener("click", (event) => {
  if (event.target === els.settingsModal) closeSettingsModal();
});
els.closeSettingsModal.addEventListener("click", closeSettingsModal);
els.saveSettingsBasics.addEventListener("click", saveSettingsBasics);
els.backupSettings.addEventListener("click", backupSettings);
els.restoreSettings.addEventListener("click", openSettingsBackupPicker);
els.settingsBackupInput.addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (file) restoreSettings(file);
});
els.settingsAddCommonFilter.addEventListener("click", () => openCommonFilterModal());
els.clearFilterHistory.addEventListener("click", clearFilterHistory);
els.comparePickerModal.addEventListener("click", (event) => {
  if (event.target === els.comparePickerModal) closeComparePicker();
});
els.cancelComparePicker.addEventListener("click", closeComparePicker);
els.confirmComparePicker.addEventListener("click", confirmComparePicker);
els.compareModal.addEventListener("click", (event) => {
  if (event.target === els.compareModal) requestCloseCompareModal();
});
els.closeCompareModal.addEventListener("click", requestCloseCompareModal);
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
els.tableWrap.addEventListener("scroll", () => {
  state.tableScrollTop = els.tableWrap.scrollTop;
});
els.tableWrap.addEventListener("scroll", closeTimeFilterPopover);
els.tableWrap.addEventListener("scroll", closeLevelFilterPopover);
els.tableWrap.addEventListener("scroll", closeTagFilterPopover);
els.tableWrap.addEventListener("scroll", closeJumpLinePopover);
els.searchTableWrap.addEventListener("scroll", scheduleSearchModalRowsRender);
els.contextTableWrap.addEventListener("scroll", scheduleContextRowsRender);
els.compareLeftWrap.addEventListener("scroll", () => scheduleCompareRowsRender("left"));
els.compareRightWrap.addEventListener("scroll", () => scheduleCompareRowsRender("right"));
els.compareLeftFilter.addEventListener("input", () => applyCompareFilter("left"));
els.compareRightFilter.addEventListener("input", () => applyCompareFilter("right"));
els.compareLeftRegex.addEventListener("change", () => applyCompareFilter("left"));
els.compareRightRegex.addEventListener("change", () => applyCompareFilter("right"));
els.compareLeftCase.addEventListener("change", () => applyCompareFilter("left"));
els.compareRightCase.addEventListener("change", () => applyCompareFilter("right"));
els.compareLeftPrevMark.addEventListener("click", () => goCompareMarkedLine("left", -1));
els.compareLeftNextMark.addEventListener("click", () => goCompareMarkedLine("left", 1));
els.compareRightPrevMark.addEventListener("click", () => goCompareMarkedLine("right", -1));
els.compareRightNextMark.addEventListener("click", () => goCompareMarkedLine("right", 1));
els.compareLeftJumpButton.addEventListener("click", () => confirmCompareJump("left"));
els.compareRightJumpButton.addEventListener("click", () => confirmCompareJump("right"));
els.compareLeftJumpInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  confirmCompareJump("left");
});
els.compareRightJumpInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  confirmCompareJump("right");
});
els.scrollToTop.addEventListener("click", () => scrollMainLogTo("top"));
els.scrollToBottom.addEventListener("click", () => scrollMainLogTo("bottom"));
els.saveFiltered.addEventListener("click", saveFiltered);
els.analyzeButton.addEventListener("click", analyzeVisible);

els.analysisEndpoint.value = state.serviceEndpoint || DEFAULT_ANALYSIS_ENDPOINT;
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
    const files = Array.from(event.dataTransfer.files || []);
    void openFiles(files);
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
  if (event.key === "Escape" && !els.comparePickerModal.classList.contains("hidden")) {
    closeComparePicker();
  }
  if (event.key === "Escape" && !els.compareModal.classList.contains("hidden")) {
    requestCloseCompareModal();
  }
  if (event.key === "Escape" && !els.importModal.classList.contains("hidden")) {
    closeImportModal();
  }
  if (event.key === "Escape" && !els.commonFilterModal.classList.contains("hidden")) {
    closeCommonFilterModal();
  }
  if (event.key === "Escape" && !els.breakpointsModal.classList.contains("hidden")) {
    closeBreakpointsModal();
  }
  if (event.key === "Escape" && !els.helpModal.classList.contains("hidden")) {
    closeHelpModal();
  }
  if (event.key === "Escape" && !els.settingsModal.classList.contains("hidden")) {
    closeSettingsModal();
  }
});
