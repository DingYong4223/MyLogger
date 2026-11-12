use super::*;
use mylogger_core::actions::{
    ACTIONS, ActionId, ActionSpec, OperationResult, TaskStatus, find_action, search_actions,
};
use mylogger_tools::{
    capture::capture_stream,
    command_usage::CommandUsage,
    favorites::{SchemaFavorite, favorites_path, load_favorites, save_favorite},
    operations::{Operation, OperationResponse, ResponseData, execute_operation},
};
use std::{
    collections::VecDeque,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, SyncSender},
    },
    thread::JoinHandle,
};

const ACCENT: Color = Color::Rgb(133, 205, 211);
const SUCCESS: Color = Color::Rgb(106, 206, 156);
const BG: Color = Color::Rgb(20, 25, 31);
const MUTED: Color = Color::Rgb(144, 160, 177);

#[derive(Clone)]
enum Request {
    Action(ActionId),
    Capture { time_named: bool, clear: bool },
    Favorite(SchemaFavorite),
}
#[derive(Clone)]
enum Purpose {
    Normal,
    Devices(Request),
    Apps(Option<ActionId>),
}
enum Message {
    Done(usize, Box<OperationResponse>, Purpose),
    Log(usize, String),
}
struct Task {
    started: Instant,
    result: OperationResult,
    cancel: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
    log: bool,
    lines: VecDeque<String>,
}
struct Picker {
    title: String,
    items: Vec<(String, String)>,
    selected: usize,
    kind: PickerKind,
}
enum PickerKind {
    Devices(Request),
    Apps(Option<ActionId>),
    Favorites(Vec<SchemaFavorite>),
}
struct Field {
    label: &'static str,
    value: String,
}
struct Form {
    action: ActionId,
    fields: Vec<Field>,
    index: usize,
    serial: Option<String>,
    package: Option<String>,
}
#[derive(PartialEq)]
enum Focus {
    Input,
    Results,
}
struct Workbench {
    editor: UiState,
    session: SessionState,
    package: Option<String>,
    focus: Focus,
    menu: bool,
    menu_index: usize,
    command_usage: CommandUsage,
    picker: Option<Picker>,
    form: Option<Form>,
    return_form: Option<(Form, String)>,
    tasks: Vec<Task>,
    selected_task: usize,
    scroll: usize,
    max_scroll: usize,
    task_area: Rect,
    detail_area: Rect,
    notice: String,
    sender: SyncSender<Message>,
    receiver: Receiver<Message>,
    paused: bool,
    filter: String,
    level: Option<mylogger_core::LogLevel>,
    frozen: Option<Vec<String>>,
    last_schema: Option<SchemaFavorite>,
    pending: Option<usize>,
    quit: bool,
}
impl Workbench {
    fn new() -> Self {
        let (sender, receiver) = mpsc::sync_channel(512);
        Self {
            editor: UiState::default(),
            session: SessionState::default(),
            package: None,
            focus: Focus::Input,
            menu: false,
            menu_index: 0,
            command_usage: CommandUsage::default(),
            picker: None,
            form: None,
            return_form: None,
            tasks: vec![],
            selected_task: 0,
            scroll: 0,
            max_scroll: 0,
            task_area: Rect::default(),
            detail_area: Rect::default(),
            notice: "输入 / 搜索命令；Tab 切换结果和输入。".into(),
            sender,
            receiver,
            paused: false,
            filter: String::new(),
            level: None,
            frozen: None,
            last_schema: None,
            pending: None,
            quit: false,
        }
    }
    fn notice(&mut self, text: impl Into<String>) {
        self.notice = text.into();
    }
    fn set_input(&mut self, value: String) {
        self.editor.clear_input();
        self.editor.input = value;
        self.editor.move_end();
        self.menu = false;
        self.menu_index = 0;
    }
    fn palette_actions(&self) -> Vec<&'static ActionSpec> {
        let mut actions = search_actions(&self.editor.input);
        let exact = find_action(&self.editor.input);
        actions.sort_by_key(|action| {
            std::cmp::Reverse((
                Some(action.id) == exact,
                self.command_usage.rank(action.command),
            ))
        });
        actions
    }
    fn record_action(&mut self, action: ActionId) {
        let command = ACTIONS.iter().find(|a| a.id == action).unwrap().command;
        self.command_usage.record(command);
    }
    fn target(&mut self, serial: String) {
        if self.session.selected_device.as_ref() != Some(&serial) {
            self.package = None;
        }
        self.session.selected_device = Some(serial);
    }
    fn add_task(
        &mut self,
        title: &str,
        serial: Option<String>,
        package: Option<String>,
        log: bool,
    ) -> usize {
        let id = self.tasks.len();
        self.tasks.push(Task {
            started: Instant::now(),
            result: OperationResult {
                title: title.into(),
                device: serial,
                package,
                status: TaskStatus::Running,
                command: String::new(),
                output: String::new(),
                elapsed_ms: 0,
                exit_code: None,
                artifacts: vec![],
            },
            cancel: Arc::new(AtomicBool::new(false)),
            worker: None,
            log,
            lines: VecDeque::new(),
        });
        self.selected_task = id;
        self.scroll = 0;
        self.paused = false;
        self.frozen = None;
        id
    }
    fn spawn(&mut self, operation: Operation, serial: Option<String>, purpose: Purpose) {
        let id = self.add_task(
            operation.title(),
            serial.clone(),
            operation.package().map(str::to_owned),
            false,
        );
        if !matches!(purpose, Purpose::Normal) {
            self.pending = Some(id);
        }
        let sender = self.sender.clone();
        let cancel = self.tasks[id].cancel.clone();
        self.tasks[id].worker = Some(std::thread::spawn(move || {
            let response = execute_operation(operation, serial.as_deref(), &cancel);
            let _ = sender.send(Message::Done(id, Box::new(response), purpose));
        }));
    }
    fn request(&mut self, request: Request) {
        self.menu = false;
        self.focus = Focus::Input;
        if self.pending.is_some() {
            self.notice("正在加载选择列表，Esc 可取消。");
            return;
        }
        match &request {
            Request::Action(action)
                if !ACTIONS
                    .iter()
                    .find(|a| a.id == *action)
                    .unwrap()
                    .needs_device
                    && *action != ActionId::Devices =>
            {
                self.ready(request)
            }
            _ => self.spawn(Operation::Devices, None, Purpose::Devices(request)),
        }
    }
    fn ready(&mut self, request: Request) {
        if let Request::Capture { time_named, clear } = request {
            self.start_log(time_named, clear, false);
            return;
        }
        if let Request::Favorite(favorite) = request {
            self.open_form(
                ActionId::Schema,
                vec![("schema", favorite.uri)],
                favorite.package,
            );
            return;
        }
        let Request::Action(action) = request else {
            unreachable!()
        };
        let serial = self.session.selected_device.clone();
        let needs_package = ACTIONS
            .iter()
            .find(|a| a.id == action)
            .unwrap()
            .needs_package;
        if needs_package && self.package.is_none() {
            self.spawn(Operation::Apps, serial, Purpose::Apps(Some(action)));
            return;
        }
        use ActionId::*;
        match action {
            Devices | DeviceInfo => self.spawn(Operation::DeviceInfo, serial, Purpose::Normal),
            Apps => self.spawn(Operation::Apps, serial, Purpose::Apps(None)),
            AppInfo => self.spawn(
                Operation::AppInfo(self.package.clone().unwrap()),
                serial,
                Purpose::Normal,
            ),
            Start | Stop | Restart => {
                let p = self.package.clone().unwrap();
                let op = match action {
                    Start => Operation::Start(p),
                    Stop => Operation::Stop(p),
                    _ => Operation::Restart(p),
                };
                self.spawn(op, serial, Purpose::Normal);
            }
            Current => self.spawn(Operation::Current, serial, Purpose::Normal),
            Install => self.open_form(action, vec![("本地 APK 路径", String::new())], None),
            Schema => self.open_form(action, vec![("schema", String::new())], None),
            Log => self.start_log(false, false, true),
            CaptureClear => self.start_log(false, true, false),
            CaptureTimed => self.start_log(true, true, false),
            Logcat => self.start_log(false, false, false),
            Screenshot => self.spawn(
                Operation::Screenshot { output: None },
                serial,
                Purpose::Normal,
            ),
            Push => self.open_form(
                action,
                vec![
                    ("本地文件路径", String::new()),
                    ("设备目标路径（目录以 / 结尾）", "/sdcard/doc/".into()),
                    ("覆盖已存在目标？输入 YES 确认，否则留空", String::new()),
                ],
                None,
            ),
            Pull => self.open_form(
                action,
                vec![
                    ("设备绝对文件路径", String::new()),
                    ("本地目标文件路径", String::new()),
                    ("覆盖已存在目标？输入 YES 确认，否则留空", String::new()),
                ],
                None,
            ),
            Reverse | Forward => {
                self.spawn(
                    Operation::Ports {
                        reverse: action == Reverse,
                    },
                    serial,
                    Purpose::Normal,
                );
                self.open_form(
                    action,
                    vec![
                        ("操作 list / add / remove", "list".into()),
                        ("来源端口（设备 reverse / 电脑 forward）", String::new()),
                        ("目标端口", String::new()),
                    ],
                    None,
                );
            }
            Favorites => self.show_favorites(),
            History => {
                self.notice(
                    "↑/↓ 恢复执行输入及草稿；Tab 到结果区后 ↑/↓ 查看任务，Enter 查看详情。",
                );
                self.focus = Focus::Results;
            }
            Tasks => {
                self.focus = Focus::Results;
                self.notice(
                    "任务区滚轮或 ↑/↓ 选择任务；详情区滚轮或 PageUp/PageDown 滚动；Ctrl+C 停止日志，Ctrl+X 停止其它任务。",
                );
            }
            Analyze => self.open_form(
                action,
                vec![
                    ("本地日志路径（留空使用 yazi）", String::new()),
                    ("用 Neovim 打开报告？YES 或留空", String::new()),
                ],
                None,
            ),
            StartService => {
                let id = self.add_task("启动分析服务", None, None, false);
                let sender = self.sender.clone();
                self.tasks[id].worker = Some(std::thread::spawn(move || {
                    let result = super::start_service_text();
                    let response = text_response("启动分析服务", result);
                    let _ = sender.send(Message::Done(id, Box::new(response), Purpose::Normal));
                }));
            }
            Help => {
                let id = self.add_task("使用帮助", None, None, false);
                let mut text="Tab 切换任务 / 输入；↑↓ 按焦点切换列表或输入历史\n任务区滚轮选择任务；详情区滚轮/PgUp/PgDn 滚动；结果区 Home/End 跳到顶部/底部\nCtrl+C 停止日志，Ctrl+X 停止其它任务\nCtrl+P 暂停日志显示；Ctrl+F 关键词；Ctrl+L 最低级别\nCtrl+S 收藏 schema；Ctrl+G 指定/取消当前应用\nEsc 取消输入或选择；Ctrl+C 停止日志（无采集时退出）；/quit 退出\n\n可用命令（参数通过表单填写）：\n".to_string();
                text.push_str(
                    &ACTIONS
                        .iter()
                        .map(|a| format!("{}  {}", a.command, a.title))
                        .collect::<Vec<_>>()
                        .join("\n"),
                );
                self.tasks[id].result = text_response("使用帮助", Ok(text)).result;
            }
            Quit => self.quit = true,
        }
    }
    fn open_form(
        &mut self,
        action: ActionId,
        fields: Vec<(&'static str, String)>,
        package: Option<String>,
    ) {
        let fields = fields
            .into_iter()
            .map(|(label, value)| Field { label, value })
            .collect::<Vec<_>>();
        self.set_input(fields[0].value.clone());
        self.editor.awaiting_schema = action == ActionId::Schema;
        self.form = Some(Form {
            action,
            fields,
            index: 0,
            serial: self.session.selected_device.clone(),
            package,
        });
        self.focus = Focus::Input;
        self.notice("Enter 提交当前项；Tab 切换字段；Esc 取消。schema 可直接 Enter 执行，Ctrl+G 指定当前应用。");
    }
    fn restore_schema_form(&mut self) {
        if let Some((form, input)) = self.return_form.take() {
            self.form = Some(form);
            self.editor.awaiting_schema = true;
            self.set_input(input);
        }
    }
    fn show_favorites(&mut self) {
        match favorites_path().and_then(|p| load_favorites(&p)) {
            Ok(entries) if entries.is_empty() => {
                self.notice("暂无收藏。输入 schema 后 Ctrl+S，输入名称保存；历史不会自动持久化。")
            }
            Ok(entries) => {
                self.picker = Some(Picker {
                    title: "schema 收藏 · Enter 填入后再次确认执行".into(),
                    items: entries
                        .iter()
                        .map(|e| (format!("{} · {}", e.name, e.uri), e.name.clone()))
                        .collect(),
                    selected: 0,
                    kind: PickerKind::Favorites(entries),
                });
                self.set_input(String::new());
            }
            Err(error) => self.notice(format!("{error:#}")),
        }
    }
    fn start_log(&mut self, time_named: bool, clear: bool, application: bool) {
        let serial = self.session.selected_device.clone().unwrap();
        if self.tasks.iter().any(|t| {
            t.log
                && t.result.device.as_ref() == Some(&serial)
                && matches!(t.result.status, TaskStatus::Running | TaskStatus::Saving)
        }) {
            self.notice("此设备已有日志任务，请先停止。Ctrl+C 停止日志，Ctrl+X 停止其它任务。");
            return;
        }
        if application && self.package.is_none() {
            self.spawn(
                Operation::Apps,
                Some(serial),
                Purpose::Apps(Some(ActionId::Log)),
            );
            return;
        }
        let package = if application {
            self.package.clone()
        } else {
            None
        };
        let path = mylogger_tools::resolve_capture_output_path(&CaptureOptions {
            time_named,
            ..Default::default()
        });
        let path = match path {
            Ok(p) => p,
            Err(e) => {
                self.notice(format!("{e:#}"));
                return;
            }
        };
        if self.tasks.iter().any(|task| {
            task.log
                && matches!(task.result.status, TaskStatus::Running | TaskStatus::Saving)
                && task.result.artifacts.contains(&path)
        }) {
            self.notice("123.txt 正在被日志任务使用，请先停止该任务。Ctrl+C 停止日志，Ctrl+X 停止其它任务。");
            return;
        }
        let id = self.add_task("日志采集", Some(serial.clone()), package.clone(), true);
        self.tasks[id].result.artifacts.push(path.clone());
        self.tasks[id].result.command = format!("adb -s {serial} logcat -v threadtime");
        let cancel = self.tasks[id].cancel.clone();
        let sender = self.sender.clone();
        let events = sender.clone();
        self.tasks[id].worker = Some(std::thread::spawn(move || {
            let started = Instant::now();
            let result = capture_stream(
                &CaptureOptions {
                    device: Some(serial.clone()),
                    package: package.clone(),
                    output: time_named.then(|| path.clone()),
                    time_named,
                    clear_before_capture: clear,
                },
                cancel.clone(),
                move |line| {
                    let _ = events.try_send(Message::Log(id, line.into()));
                },
            );
            let (status, output) = match result {
                Ok(_) => (TaskStatus::Success, "采集已停止，日志已刷新到文件。".into()),
                Err(e) => (
                    if cancel.load(Ordering::Relaxed) {
                        TaskStatus::Cancelled
                    } else {
                        TaskStatus::Failed
                    },
                    format!("{e:#}"),
                ),
            };
            let response = OperationResponse {
                result: OperationResult {
                    title: "日志采集".into(),
                    device: Some(serial),
                    package,
                    status,
                    command: "logcat（UID 或 PID 过滤详情见采集提示）".into(),
                    output,
                    elapsed_ms: started.elapsed().as_millis(),
                    exit_code: None,
                    artifacts: if path.exists() { vec![path] } else { vec![] },
                },
                data: ResponseData::None,
            };
            let _ = sender.send(Message::Done(id, Box::new(response), Purpose::Normal));
        }));
        self.notice(
            "日志后台采集中，可继续操作。滚轮/PgUp 上翻，回到底部继续跟随；Ctrl+P 暂停；Ctrl+C 停止；完整日志持续写入文件。",
        );
    }
    fn messages(&mut self) {
        for _ in 0..1024 {
            let Ok(message) = self.receiver.try_recv() else {
                break;
            };
            match message {
                Message::Log(id, line) => {
                    if let Some(task) = self.tasks.get_mut(id) {
                        if task.lines.len() >= 2000 {
                            task.lines.pop_front();
                        }
                        task.lines.push_back(line);
                    }
                }
                Message::Done(id, response, purpose) => {
                    let success = response.result.status == TaskStatus::Success;
                    if let Some(task) = self.tasks.get_mut(id) {
                        task.result = response.result;
                        if let Some(worker) = task.worker.take() {
                            let _ = worker.join();
                        }
                        if task.log
                            && success
                            && let Some(path) = task.result.artifacts.first()
                        {
                            self.session.current_log_file = Some(path.clone());
                            self.session.last_capture_file = Some(path.clone());
                        }
                    }
                    let active_selection = self.pending == Some(id);
                    if active_selection {
                        self.pending = None;
                    }
                    if !matches!(purpose, Purpose::Normal) && !active_selection {
                        continue;
                    }
                    if !success {
                        self.notice(
                            "操作失败或取消；结果区保留命令、目标和错误详情，可切换任务查看。",
                        );
                        continue;
                    }
                    match (purpose, response.data) {
                        (Purpose::Devices(request), ResponseData::Devices(devices)) => {
                            let all = devices
                                .iter()
                                .map(|d| format!("{} ({})", d.serial, d.state))
                                .collect::<Vec<_>>()
                                .join(" · ");
                            let available = devices
                                .into_iter()
                                .filter(|d| d.state.is_available())
                                .collect::<Vec<_>>();
                            match available.as_slice() {
                                [] => self.notice(format!("未检测到可用设备。{all}")),
                                [device] => {
                                    self.target(device.serial.clone());
                                    self.ready(request);
                                }
                                _ => {
                                    let selected = available
                                        .iter()
                                        .position(|d| {
                                            Some(&d.serial) == self.session.selected_device.as_ref()
                                        })
                                        .unwrap_or(0);
                                    self.picker = Some(Picker {
                                        title: format!("选择设备 · {all}"),
                                        items: available
                                            .into_iter()
                                            .map(|d| (d.serial.clone(), d.serial))
                                            .collect(),
                                        selected,
                                        kind: PickerKind::Devices(request),
                                    });
                                    self.set_input(String::new());
                                }
                            }
                        }
                        (Purpose::Apps(after), ResponseData::Apps(apps)) => {
                            self.picker = Some(Picker {
                                title: "选择应用 · 输入包名搜索".into(),
                                items: apps.into_iter().map(|p| (p.clone(), p)).collect(),
                                selected: 0,
                                kind: PickerKind::Apps(after),
                            });
                            self.set_input(String::new());
                        }
                        _ => {}
                    }
                }
            }
        }
    }
    fn picker_items(&self) -> Vec<usize> {
        let query = self.editor.input.to_lowercase();
        self.picker
            .as_ref()
            .map(|p| {
                p.items
                    .iter()
                    .enumerate()
                    .filter(|(_, item)| item.0.to_lowercase().contains(&query))
                    .map(|(i, _)| i)
                    .collect()
            })
            .unwrap_or_default()
    }
    fn choose(&mut self) {
        let visible = self.picker_items();
        let Some(picker) = self.picker.take() else {
            return;
        };
        let Some(index) = visible.get(picker.selected).copied() else {
            self.picker = Some(picker);
            return;
        };
        let value = picker.items[index].1.clone();
        self.set_input(String::new());
        match picker.kind {
            PickerKind::Devices(request) => {
                self.target(value);
                self.ready(request);
            }
            PickerKind::Apps(after) => {
                self.package = Some(value.clone());
                match after {
                    Some(action) => self.ready(Request::Action(action)),
                    None => self.spawn(
                        Operation::AppInfo(value),
                        self.session.selected_device.clone(),
                        Purpose::Normal,
                    ),
                }
            }
            PickerKind::Favorites(entries) => {
                self.request(Request::Favorite(entries[index].clone()))
            }
        }
    }
    fn submit_form(&mut self, terminal: &mut TerminalSession) -> Result<()> {
        let mut form = self.form.take().unwrap();
        form.fields[form.index].value = self.editor.input.clone();
        if form.index + 1 < form.fields.len() {
            form.index += 1;
            self.set_input(form.fields[form.index].value.clone());
            self.form = Some(form);
            return Ok(());
        }
        let values = form
            .fields
            .iter()
            .map(|f| f.value.clone())
            .collect::<Vec<_>>();
        if form.action == ActionId::Schema && values[0].trim().is_empty() {
            self.form = Some(form);
            self.notice("schema 不能为空。");
            return Ok(());
        }
        if form.action == ActionId::Favorites {
            if let Some(mut favorite) = self.last_schema.clone() {
                favorite.name = values[0].clone();
                if let Err(error) = favorites_path().and_then(|p| save_favorite(&p, favorite)) {
                    self.notice(format!("{error:#}"));
                    self.form = Some(form);
                    return Ok(());
                }
            }
            self.set_input(String::new());
            self.restore_schema_form();
            self.notice("schema 收藏已保存，原输入可继续编辑执行。");
            return Ok(());
        }
        if form.action == ActionId::Help {
            self.filter = values[0].clone();
            if self.paused {
                self.frozen = Some(self.log_lines());
            }
            self.scroll = 0;
            self.set_input(String::new());
            self.notice("日志关键词筛选已更新；原始文件保持完整。");
            return Ok(());
        }
        if form.action == ActionId::Analyze {
            let path = if values[0].is_empty() {
                match select_file_with_yazi(Some(terminal), "日志文件") {
                    Ok(p) => p,
                    Err(e) => {
                        self.notice(format!("{e:#}"));
                        return Ok(());
                    }
                }
            } else {
                PathBuf::from(&values[0])
            };
            if values[1] == "YES" {
                let result = execute_tui_analyze_open(
                    terminal,
                    Some(path.to_string_lossy().into()),
                    &mut self.session,
                );
                let id = self.add_task("分析并打开报告", None, None, false);
                self.tasks[id].result = text_response("分析并打开报告", result).result;
            } else {
                self.session.current_log_file = Some(path.clone());
                let id = self.add_task("分析本地日志", None, None, false);
                let sender = self.sender.clone();
                self.tasks[id].worker = Some(std::thread::spawn(move || {
                    let result = analyze_file(&path, &AnalysisOptions::default())
                        .map(|s| format_summary(&path, &s));
                    let _ = sender.send(Message::Done(
                        id,
                        Box::new(text_response("分析本地日志", result)),
                        Purpose::Normal,
                    ));
                }));
            }
            self.set_input(String::new());
            return Ok(());
        }
        let operation = (|| -> Result<Operation> {
            Ok(match form.action {
                ActionId::Schema => Operation::Schema {
                    uri: values[0].clone(),
                    package: form.package.clone(),
                },
                ActionId::Install => Operation::Install {
                    apk: PathBuf::from(&values[0]),
                    launch: None,
                },
                ActionId::Push => Operation::Push {
                    local: PathBuf::from(&values[0]),
                    remote: values[1].clone(),
                    overwrite: values[2] == "YES",
                },
                ActionId::Pull => Operation::Pull {
                    remote: values[0].clone(),
                    local: PathBuf::from(&values[1]),
                    overwrite: values[2] == "YES",
                },
                ActionId::Reverse | ActionId::Forward => {
                    let reverse = form.action == ActionId::Reverse;
                    match values[0].trim() {
                        "list" => Operation::Ports { reverse },
                        "add" => Operation::AddPort {
                            reverse,
                            source: values[1].parse().context("来源端口无效")?,
                            destination: values[2].parse().context("目标端口无效")?,
                        },
                        "remove" => Operation::RemovePort {
                            reverse,
                            source: values[1].parse().context("来源端口无效")?,
                        },
                        _ => anyhow::bail!("操作必须是 list / add / remove"),
                    }
                }
                _ => unreachable!(),
            })
        })();
        match operation {
            Ok(operation) => {
                if form.action == ActionId::Schema {
                    self.editor.remember_input(values[0].clone(), true);
                    self.last_schema = Some(SchemaFavorite {
                        name: String::new(),
                        uri: values[0].clone(),
                        package: form.package,
                    });
                } else {
                    self.editor.remember_input(
                        ACTIONS
                            .iter()
                            .find(|a| a.id == form.action)
                            .unwrap()
                            .command
                            .into(),
                        false,
                    );
                }
                self.editor.awaiting_schema = false;
                self.set_input(String::new());
                self.spawn(operation, form.serial, Purpose::Normal);
            }
            Err(e) => {
                self.notice(format!("{e:#}"));
                self.form = Some(form);
            }
        }
        Ok(())
    }
    fn select_push_file(&mut self, terminal: &mut TerminalSession) {
        if !self
            .form
            .as_ref()
            .is_some_and(|form| form.action == ActionId::Push && form.fields[0].value.is_empty())
        {
            return;
        }
        let mut form = self.form.take().unwrap();
        self.set_input(String::new());
        let selected = select_file_with_yazi(Some(terminal), "要上传的文件").and_then(|path| {
            anyhow::ensure!(path.is_file(), "请选择本地文件，暂不支持目录上传");
            Ok(path.to_str().context("无效的本地路径")?.to_owned())
        });
        match selected {
            Ok(path) => {
                form.fields[0].value = path;
                form.index = 1;
                self.set_input(form.fields[1].value.clone());
                self.form = Some(form);
                self.notice(
                    "已选定本地文件；输入设备目标路径，目录以 / 结尾；Enter 下一项，Esc 取消。",
                );
            }
            Err(error) => self.notice(format!("{error:#}")),
        }
    }
    fn command(&mut self, command: String, terminal: &mut TerminalSession) -> Result<()> {
        if let Some(action) = find_action(&command) {
            self.record_action(action);
            self.request(Request::Action(action));
            return Ok(());
        }
        match route_intent(normalize_command(&command)) {
            Intent::Capture {
                time_named,
                clear_before_capture,
            } => {
                self.record_action(if time_named {
                    ActionId::CaptureTimed
                } else if clear_before_capture {
                    ActionId::CaptureClear
                } else {
                    ActionId::Logcat
                });
                self.request(Request::Capture {
                    time_named,
                    clear: clear_before_capture,
                });
            }
            Intent::OpenSchema => {
                self.record_action(ActionId::Schema);
                self.request(Request::Action(ActionId::Schema));
            }
            Intent::Analyze { path, open } => {
                self.record_action(ActionId::Analyze);
                self.open_form(
                    ActionId::Analyze,
                    vec![
                        ("本地日志路径（留空使用 yazi）", path.unwrap_or_default()),
                        (
                            "用 Neovim 打开报告？YES 或留空",
                            if open { "YES".into() } else { String::new() },
                        ),
                    ],
                    None,
                );
                if self
                    .form
                    .as_ref()
                    .is_some_and(|f| !f.fields[0].value.is_empty())
                {
                    self.form.as_mut().unwrap().index = 1;
                    let value = self.form.as_ref().unwrap().fields[1].value.clone();
                    self.set_input(value);
                    self.submit_form(terminal)?;
                }
            }
            Intent::StartService => {
                self.record_action(ActionId::StartService);
                self.ready(Request::Action(ActionId::StartService));
            }
            Intent::Help => {
                self.record_action(ActionId::Help);
                self.ready(Request::Action(ActionId::Help));
            }
            Intent::Quit => {
                self.record_action(ActionId::Quit);
                self.quit = true;
            }
            _ => self
                .notice("未识别命令。输入 / 搜索功能。参数通过表单填写；脚本请使用 CLI --help。"),
        }
        Ok(())
    }
    fn stop_task(&mut self) {
        if let Some(task) = self.tasks.get_mut(self.selected_task)
            && task.result.status == TaskStatus::Running
        {
            task.cancel.store(true, Ordering::Relaxed);
            task.result.status = TaskStatus::Saving;
            self.notice("正在停止任务并刷新文件；安装取消后请重新查询应用状态。");
        }
    }
    fn interrupt(&mut self) {
        let active_log = |task: &Task| {
            task.log && matches!(task.result.status, TaskStatus::Running | TaskStatus::Saving)
        };
        let index = if self.tasks.get(self.selected_task).is_some_and(active_log) {
            Some(self.selected_task)
        } else {
            self.tasks.iter().rposition(active_log)
        };
        if let Some(index) = index {
            self.select_task(index);
            self.stop_task();
            self.notice("正在停止日志采集并刷新文件，完成后留在工作台。");
        } else {
            self.quit = true;
        }
    }
    fn select_task(&mut self, index: usize) {
        let index = index.min(self.tasks.len().saturating_sub(1));
        if self.selected_task != index {
            self.scroll = 0;
            self.paused = false;
            self.frozen = None;
        }
        self.selected_task = index;
    }
    fn scroll_results(&mut self, older: bool, rows: usize) {
        let log = self
            .tasks
            .get(self.selected_task)
            .is_some_and(|task| task.log);
        if log && older && !self.paused && self.max_scroll > 0 {
            self.paused = true;
            self.frozen = Some(self.log_lines());
        }
        self.scroll = if older == log {
            self.scroll.saturating_add(rows).min(self.max_scroll)
        } else {
            self.scroll.saturating_sub(rows)
        };
        if log && !older && self.scroll == 0 {
            self.paused = false;
            self.frozen = None;
        }
    }
    fn mouse(&mut self, mouse: event::MouseEvent) {
        if self.form.is_some() || self.picker.is_some() || self.menu {
            return;
        }
        let older = match mouse.kind {
            event::MouseEventKind::ScrollUp => true,
            event::MouseEventKind::ScrollDown => false,
            _ => return,
        };
        let position = (mouse.column, mouse.row).into();
        if self.task_area.contains(position) {
            self.select_task(if older {
                self.selected_task.saturating_sub(3)
            } else {
                self.selected_task.saturating_add(3)
            });
        } else if self.detail_area.contains(position) {
            self.scroll_results(older, 3);
        }
    }
    fn key(&mut self, key: event::KeyEvent, terminal: &mut TerminalSession) -> Result<()> {
        if key.modifiers.contains(KeyModifiers::CONTROL) {
            match key.code {
                KeyCode::Char('c') => self.interrupt(),
                KeyCode::Char('x')
                    if self
                        .tasks
                        .get(self.selected_task)
                        .is_some_and(|task| !task.log) =>
                {
                    self.stop_task()
                }
                KeyCode::Char('p') => {
                    self.scroll = 0;
                    self.paused = !self.paused;
                    self.frozen = if self.paused {
                        Some(self.log_lines())
                    } else {
                        None
                    };
                }
                KeyCode::Char('l') => {
                    use mylogger_core::LogLevel::*;
                    self.level = match self.level {
                        None => Some(Debug),
                        Some(Debug) => Some(Info),
                        Some(Info) => Some(Warn),
                        Some(Warn) => Some(Error),
                        _ => None,
                    };
                    if self.paused {
                        self.frozen = Some(self.log_lines());
                    }
                    self.scroll = 0;
                }
                KeyCode::Char('f') if self.form.is_none() && self.picker.is_none() => self
                    .open_form(
                        ActionId::Help,
                        vec![("日志显示关键词（留空清除）", self.filter.clone())],
                        None,
                    ),
                KeyCode::Char('g') => {
                    if let Some(form) = self.form.as_mut().filter(|f| f.action == ActionId::Schema)
                    {
                        form.package = if form.package.is_some() {
                            None
                        } else {
                            self.package.clone()
                        };
                        let text = format!(
                            "schema 目标应用：{}",
                            form.package
                                .as_deref()
                                .unwrap_or("系统解析（可先 /apps 选择应用）")
                        );
                        self.notice(text);
                    }
                }
                KeyCode::Char('s')
                    if self.picker.is_none()
                        && self
                            .form
                            .as_ref()
                            .is_none_or(|f| f.action == ActionId::Schema) =>
                {
                    if self.editor.awaiting_schema && !self.editor.input.trim().is_empty() {
                        self.last_schema = Some(SchemaFavorite {
                            name: String::new(),
                            uri: self.editor.input.clone(),
                            package: self.form.as_ref().and_then(|f| f.package.clone()),
                        });
                    }
                    if self.last_schema.is_some() {
                        if let Some(form) = self.form.take() {
                            self.return_form = Some((form, self.editor.input.clone()));
                        }
                        self.editor.awaiting_schema = false;
                        self.open_form(
                            ActionId::Favorites,
                            vec![("收藏名称（同名更新）", String::new())],
                            None,
                        );
                    } else {
                        self.notice("请先输入或执行 schema，再按 Ctrl+S 收藏。");
                    }
                }
                _ => {}
            }
            return Ok(());
        }
        if key.code == KeyCode::Esc {
            if let Some(id) = self.pending.take() {
                self.tasks[id].cancel.store(true, Ordering::Relaxed);
            }
            if self.picker.take().is_some() {
                self.set_input(String::new());
            } else if self.form.take().is_some() {
                self.editor.awaiting_schema = false;
                self.set_input(String::new());
                self.restore_schema_form();
            } else if self.menu {
                self.menu = false;
            } else {
                self.editor.awaiting_schema = false;
                self.set_input(String::new());
                self.focus = Focus::Input;
            }
            self.notice("已取消当前输入。日志采集可用 Ctrl+C 停止，其它任务用 Ctrl+X。");
            return Ok(());
        }
        if self.form.is_none() && self.picker.is_none() && !self.menu {
            if matches!(key.code, KeyCode::PageUp | KeyCode::PageDown) {
                self.scroll_results(
                    key.code == KeyCode::PageUp,
                    usize::from(self.detail_area.height.saturating_sub(2)).max(1),
                );
                return Ok(());
            }
            if self.focus == Focus::Results && matches!(key.code, KeyCode::Home | KeyCode::End) {
                self.scroll_results(key.code == KeyCode::Home, usize::MAX);
                return Ok(());
            }
        }
        if self.picker.is_some() {
            let len = self.picker_items().len();
            match key.code {
                KeyCode::Up => {
                    let p = self.picker.as_mut().unwrap();
                    p.selected = previous_index(p.selected, len);
                }
                KeyCode::Down => {
                    let p = self.picker.as_mut().unwrap();
                    p.selected = next_index(p.selected, len);
                }
                KeyCode::Enter => self.choose(),
                _ => {
                    self.edit_key(key);
                    if let Some(p) = self.picker.as_mut() {
                        p.selected = 0;
                    }
                }
            }
            return Ok(());
        }
        if key.code == KeyCode::Tab || key.code == KeyCode::BackTab {
            if let Some(form) = self.form.as_mut() {
                form.fields[form.index].value = self.editor.input.clone();
                form.index = if key.code == KeyCode::BackTab {
                    previous_index(form.index, form.fields.len())
                } else {
                    next_index(form.index, form.fields.len())
                };
                let value = form.fields[form.index].value.clone();
                self.set_input(value);
            } else {
                self.focus = match self.focus {
                    Focus::Input => Focus::Results,
                    Focus::Results => Focus::Input,
                };
                self.menu = false;
            }
            return Ok(());
        }
        if self.focus == Focus::Results {
            match key.code {
                KeyCode::Up => self.select_task(self.selected_task.saturating_sub(1)),
                KeyCode::Down => self.select_task(self.selected_task.saturating_add(1)),
                KeyCode::Enter => {
                    self.scroll = 0;
                    self.paused = false;
                    self.frozen = None;
                }
                KeyCode::Char('/') => {
                    self.focus = Focus::Input;
                    self.set_input("/".into());
                    self.menu = true;
                }
                _ => {}
            }
            return Ok(());
        }
        if key.code == KeyCode::Enter {
            if self.form.is_some() {
                return self.submit_form(terminal);
            }
            if self.editor.awaiting_schema {
                if self.editor.input.trim().is_empty() {
                    self.notice("schema 不能为空。");
                    return Ok(());
                }
                let uri = self.editor.input.clone();
                self.record_action(ActionId::Schema);
                self.editor.remember_input(uri.clone(), true);
                self.editor.awaiting_schema = false;
                self.set_input(String::new());
                self.last_schema = Some(SchemaFavorite {
                    name: String::new(),
                    uri: uri.clone(),
                    package: None,
                });
                self.spawn(
                    Operation::Schema { uri, package: None },
                    self.session.selected_device.clone(),
                    Purpose::Normal,
                );
                return Ok(());
            }
            let command = if self.menu {
                self.palette_actions()
                    .get(self.menu_index)
                    .map(|a| a.command.to_string())
                    .unwrap_or_else(|| self.editor.input.clone())
            } else {
                self.editor.input.clone()
            };
            if !command.trim().is_empty() {
                self.editor.remember_input(command.clone(), false);
            }
            self.set_input(String::new());
            if !command.trim().is_empty() {
                self.command(command, terminal)?;
            }
            return Ok(());
        }
        if self.menu && matches!(key.code, KeyCode::Up | KeyCode::Down) {
            let len = self.palette_actions().len();
            self.menu_index = if key.code == KeyCode::Up {
                previous_index(self.menu_index, len)
            } else {
                next_index(self.menu_index, len)
            };
            return Ok(());
        }
        if matches!(key.code, KeyCode::Up | KeyCode::Down) {
            if self
                .form
                .as_ref()
                .is_some_and(|f| f.action != ActionId::Schema)
            {
                return Ok(());
            }
            self.editor.navigate_history(key.code == KeyCode::Up);
            self.menu = false;
            // Only the schema field uses general execution history; other form fields stay literal.
            if self
                .form
                .as_ref()
                .is_some_and(|f| f.action == ActionId::Schema)
                && !self.editor.awaiting_schema
            {
                self.form = None;
            }
            return Ok(());
        }
        self.edit_key(key);
        self.menu = self.form.is_none()
            && !self.editor.awaiting_schema
            && self.editor.input.starts_with('/')
            && !self.editor.input.contains(char::is_whitespace);
        self.menu_index = 0;
        Ok(())
    }
    fn edit_key(&mut self, key: event::KeyEvent) {
        match key.code {
            KeyCode::Backspace => self.editor.backspace(),
            KeyCode::Delete => self.editor.delete(),
            KeyCode::Left => self.editor.move_left(),
            KeyCode::Right => self.editor.move_right(),
            KeyCode::Home => self.editor.move_home(),
            KeyCode::End => self.editor.move_end(),
            KeyCode::Char(c)
                if !key
                    .modifiers
                    .intersects(KeyModifiers::ALT | KeyModifiers::CONTROL) =>
            {
                self.editor.insert_char(c)
            }
            _ => {}
        }
    }
    fn log_lines(&self) -> Vec<String> {
        self.tasks
            .get(self.selected_task)
            .map(|t| {
                t.lines
                    .iter()
                    .filter(|l| {
                        l.contains(&self.filter)
                            && mylogger_core::parse_line(0, l)
                                .level
                                .matches_filter(self.level)
                    })
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }
}
impl Drop for Workbench {
    fn drop(&mut self) {
        for task in &self.tasks {
            task.cancel.store(true, Ordering::Relaxed);
        }
        // Drain completion messages while workers stop so a full UI queue cannot block shutdown.
        while self
            .tasks
            .iter()
            .any(|t| t.worker.as_ref().is_some_and(|w| !w.is_finished()))
        {
            while self.receiver.try_recv().is_ok() {}
            std::thread::sleep(Duration::from_millis(20));
        }
        for task in &mut self.tasks {
            if let Some(worker) = task.worker.take() {
                let _ = worker.join();
            }
        }
    }
}
fn text_response(title: &str, outcome: Result<String>) -> OperationResponse {
    let (status, output) = match outcome {
        Ok(s) => (TaskStatus::Success, s),
        Err(e) => (TaskStatus::Failed, format!("{e:#}")),
    };
    OperationResponse {
        result: OperationResult {
            title: title.into(),
            device: None,
            package: None,
            status,
            command: String::new(),
            output,
            elapsed_ms: 0,
            exit_code: None,
            artifacts: vec![],
        },
        data: ResponseData::None,
    }
}

pub(super) fn run() -> Result<()> {
    let mut terminal = TerminalSession::enter()?;
    let mut app = Workbench::new();
    let usage_path = match favorites_path().and_then(|path| {
        let path = path.with_file_name("command-usage.json");
        Ok((CommandUsage::load(&path)?, path))
    }) {
        Ok((usage, path)) => {
            app.command_usage = usage;
            Some(path)
        }
        Err(error) => {
            app.notice(format!("{error:#}；本次仅使用会话内的命令排序。"));
            None
        }
    };
    while !app.quit {
        app.messages();
        app.select_push_file(&mut terminal);
        terminal.draw(|f| render_workbench(f, &mut app))?;
        if !event::poll(Duration::from_millis(50))? {
            continue;
        }
        match event::read()? {
            Event::Key(key) if key.kind == KeyEventKind::Press => app.key(key, &mut terminal)?,
            Event::Mouse(mouse) => app.mouse(mouse),
            Event::Paste(text) => {
                for c in text.chars().filter(|c| !c.is_control()) {
                    app.editor.insert_char(c);
                }
            }
            _ => {}
        }
    }
    // shortcut: save ranking on clean exit; persist each command if crash recovery is needed.
    let saved = usage_path.map_or(Ok(()), |path| app.command_usage.save(&path));
    drop(app);
    terminal.leave()?;
    saved
}

fn panel(title: impl Into<Line<'static>>, active: bool) -> Block<'static> {
    Block::default()
        .borders(Borders::ALL)
        .title(title)
        .border_style(Style::default().fg(if active {
            ACCENT
        } else {
            Color::Rgb(49, 61, 73)
        }))
}
fn render_workbench(frame: &mut ratatui::Frame<'_>, app: &mut Workbench) {
    let area = frame.area();
    frame.render_widget(
        Block::default().style(Style::default().bg(BG).fg(Color::Rgb(222, 231, 239))),
        area,
    );
    let narrow = area.width < 86 && area.height >= 16;
    let sections = Layout::vertical([
        Constraint::Length(if narrow { 4 } else { 3 }),
        Constraint::Min(1),
        Constraint::Length(2),
        Constraint::Length(3),
    ])
    .split(area);
    let header = format!(
        " MyLogger · ADB 工作台    设备 {}    应用 {}",
        app.session.selected_device.as_deref().unwrap_or("未选择"),
        app.package.as_deref().unwrap_or("未选择")
    );
    let header = if narrow {
        format!(
            "设备 {}\n应用 {}",
            app.session.selected_device.as_deref().unwrap_or("未选择"),
            app.package.as_deref().unwrap_or("未选择")
        )
    } else {
        header
    };
    frame.render_widget(
        Paragraph::new(header)
            .style(Style::default().fg(ACCENT).add_modifier(Modifier::BOLD))
            .block(panel(" DEVELOPER TOOLBOX ", false)),
        sections[0],
    );
    let body = sections[1];
    render_results(frame, body, app);
    frame.render_widget(
        Paragraph::new(app.notice.as_str())
            .style(Style::default().fg(MUTED))
            .wrap(Wrap { trim: false }),
        sections[2],
    );
    let title = if let Some(p) = &app.picker {
        format!(" 搜索 · {} ", p.title)
    } else if let Some(form) = &app.form {
        format!(
            " {} [{}/{}] · {} ",
            ACTIONS.iter().find(|a| a.id == form.action).unwrap().title,
            form.index + 1,
            form.fields.len(),
            form.fields[form.index].label
        )
    } else if app.editor.awaiting_schema {
        " schema · Enter 使用当前设备执行 ".into()
    } else {
        " 命令 / 搜索 · ↑↓ 历史 · Tab 焦点 ".into()
    };
    let input = sections[3];
    let inner = panel(title.clone(), true).inner(input);
    frame.render_widget(panel(title, app.focus == Focus::Input), input);
    let (text, cursor) = app.editor.input_view(inner.width.saturating_sub(2));
    frame.render_widget(Paragraph::new(format!("> {text}")), inner);
    if app.focus == Focus::Input {
        set_input_cursor(frame, input, cursor);
    }
    if let Some(form) = &app.form {
        let mut lines = form
            .fields
            .iter()
            .enumerate()
            .map(|(i, f)| {
                Line::from(format!(
                    "{} {}: {}",
                    if i == form.index { "›" } else { " " },
                    f.label,
                    if i == form.index {
                        &app.editor.input
                    } else {
                        &f.value
                    }
                ))
            })
            .collect::<Vec<_>>();
        lines.push(Line::from(format!(
            "设备: {} · 目标应用: {}",
            form.serial.as_deref().unwrap_or("本地"),
            form.package.as_deref().unwrap_or("系统解析")
        )));
        let popup = centered_rect(body, 86, (lines.len() as u16 + 4).min(body.height));
        frame.render_widget(Clear, popup);
        frame.render_widget(
            Paragraph::new(lines)
                .wrap(Wrap { trim: false })
                .block(panel(" 操作参数 · Enter 下一项/执行 · Esc 取消 ", true)),
            popup,
        );
    }
    if let Some(picker) = &app.picker {
        let visible = app.picker_items();
        let height = body.height.saturating_sub(4).clamp(1, 16) as usize;
        let start = picker.selected.saturating_sub(height.saturating_sub(1));
        let items = visible
            .iter()
            .enumerate()
            .skip(start)
            .take(height)
            .map(|(n, i)| {
                ListItem::new(format!(
                    "{} {}",
                    if n == picker.selected { "›" } else { " " },
                    picker.items[*i].0
                ))
                .style(Style::default().fg(if n == picker.selected {
                    ACCENT
                } else {
                    MUTED
                }))
            })
            .collect::<Vec<_>>();
        let popup = centered_rect(body, 90, (height as u16 + 3).min(body.height));
        frame.render_widget(Clear, popup);
        frame.render_widget(
            List::new(if items.is_empty() {
                vec![ListItem::new("无匹配项，修改搜索或 Esc 返回")]
            } else {
                items
            })
            .block(panel(format!(" {} · ↑↓ Enter ", picker.title), true)),
            popup,
        );
    } else if app.menu {
        let actions = app.palette_actions();
        let height = body.height.saturating_sub(2).clamp(1, 12) as usize;
        let start = app.menu_index.saturating_sub(height.saturating_sub(1));
        let items = actions
            .iter()
            .enumerate()
            .skip(start)
            .take(height)
            .map(|(i, a)| {
                ListItem::new(format!(
                    "{} {}  {}  {}",
                    if i == app.menu_index { "›" } else { " " },
                    a.title,
                    a.command,
                    a.category
                ))
                .style(Style::default().fg(if i == app.menu_index {
                    ACCENT
                } else {
                    MUTED
                }))
            })
            .collect::<Vec<_>>();
        let popup = menu_popup_area(area, input, height as u16 + 2);
        frame.render_widget(Clear, popup);
        frame.render_widget(
            List::new(items).block(panel(" 命令搜索 · ↑↓ Enter ", true)),
            popup,
        );
    }
}
fn wrap_display_lines(text: &str, width: u16) -> Vec<String> {
    let width = usize::from(width).max(1);
    let mut rows = Vec::new();
    for text in text.split('\n') {
        let mut row = String::new();
        let mut columns = 0;
        for ch in text.chars() {
            let size = unicode_width::UnicodeWidthChar::width(ch).unwrap_or(0);
            if columns + size > width && !row.is_empty() {
                rows.push(std::mem::take(&mut row));
                columns = 0;
            }
            row.push(ch);
            columns += size;
        }
        rows.push(row);
    }
    rows
}
fn render_results(frame: &mut ratatui::Frame<'_>, area: Rect, app: &mut Workbench) {
    let items = app
        .tasks
        .iter()
        .enumerate()
        .map(|(i, t)| {
            let color = match t.result.status {
                TaskStatus::Success => SUCCESS,
                TaskStatus::Failed => Color::LightRed,
                TaskStatus::Running | TaskStatus::Saving => Color::Yellow,
                TaskStatus::Cancelled => MUTED,
            };
            let mut lines = vec![Line::from(format!(
                "{} #{:02} [{}] {} · {}",
                if i == app.selected_task { "›" } else { " " },
                i + 1,
                t.result.status.label(),
                t.result.title,
                t.result.device.as_deref().unwrap_or("本地")
            ))];
            if t.log {
                for path in &t.result.artifacts {
                    lines.extend(
                        wrap_display_lines(
                            &format!("日志：{}", path.display()),
                            area.width.saturating_sub(2),
                        )
                        .into_iter()
                        .map(Line::from),
                    );
                }
            }
            ListItem::new(lines).style(Style::default().fg(color))
        })
        .collect::<Vec<_>>();
    let selected_height = items
        .get(app.selected_task)
        .map_or(0, |item| item.height() + 2);
    let task_height = selected_height
        .max(if area.height >= 18 { 7 } else { 3 })
        .min(usize::from(area.height.saturating_sub(3)));
    let parts =
        Layout::vertical([Constraint::Length(task_height as u16), Constraint::Min(1)]).split(area);
    let mut task_state = ratatui::widgets::ListState::default()
        .with_selected((!app.tasks.is_empty()).then_some(app.selected_task));
    frame.render_stateful_widget(
        List::new(if items.is_empty() {
            vec![ListItem::new("尚无任务；输入 / 选择操作")]
        } else {
            items
        })
        .block(panel(
            " 会话任务 · 滚轮/↑↓ 选择 · Ctrl+C 停止日志 ",
            app.focus == Focus::Results,
        )),
        parts[0],
        &mut task_state,
    );
    app.task_area = parts[0];
    app.detail_area = parts[1];
    app.max_scroll = 0;
    let Some(task) = app.tasks.get(app.selected_task) else {
        frame.render_widget(Paragraph::new("开发工作台\n\n选择设备 → 选择应用 → 安装 / 启动 / schema 联调\n\n日志、截图、文件传输、端口映射共享设备上下文。\n每项结果保留目标、命令、错误与产物路径。\n\n输入 / 搜索所有可用功能；Tab 切换输入和任务结果。").wrap(Wrap{trim:false}).block(panel(" 操作与结果 ",false)),parts[1]);
        return;
    };
    let mut lines = vec![
        format!(
            "{} · {} · {} ms · exit {:?}",
            task.result.title,
            task.result.status.label(),
            if matches!(task.result.status, TaskStatus::Running | TaskStatus::Saving) {
                task.started.elapsed().as_millis()
            } else {
                task.result.elapsed_ms
            },
            task.result.exit_code
        ),
        format!(
            "设备 {} · 应用 {}",
            task.result.device.as_deref().unwrap_or("本地"),
            task.result.package.as_deref().unwrap_or("无")
        ),
    ];
    for path in &task.result.artifacts {
        lines.push(format!("产物：{}", path.display()));
    }
    lines.push(format!("命令：{}", task.result.command));
    lines.extend(task.result.output.lines().map(str::to_owned));
    if task.log {
        lines.push(format!(
            "── 实时日志 · {} · 级别 {} · 关键词 {} ──",
            if app.paused {
                "暂停显示（文件继续写入）"
            } else {
                "跟随"
            },
            app.level
                .map(|l| l.to_string())
                .unwrap_or_else(|| "全部".into()),
            app.filter
        ));
        lines.extend(if app.paused {
            app.frozen.clone().unwrap_or_default()
        } else {
            app.log_lines()
        });
    }
    let available = usize::from(parts[1].height.saturating_sub(2));
    let rows = wrap_display_lines(&lines.join("\n"), parts[1].width.saturating_sub(2));
    app.max_scroll = rows.len().saturating_sub(available);
    app.scroll = app.scroll.min(app.max_scroll);
    let offset = if task.log {
        app.max_scroll - app.scroll
    } else {
        app.scroll
    };
    let text = rows
        .iter()
        .skip(offset)
        .take(available)
        .cloned()
        .collect::<Vec<_>>()
        .join("\n");
    let title = if task.log {
        format!(
            " 日志 · {} · 级别 {} · {}/{} · 滚轮/PgUp/PgDn ",
            if app.paused { "查看历史" } else { "跟随" },
            app.level
                .map(|l| l.to_string())
                .unwrap_or_else(|| "全部".into()),
            offset + 1,
            rows.len()
        )
    } else {
        " 执行详情 · 滚轮/PgUp/PgDn ".into()
    };
    frame.render_widget(Paragraph::new(text).block(panel(title, false)), parts[1]);
    if app.max_scroll > 0 && available > 0 {
        let mut state = ratatui::widgets::ScrollbarState::new(app.max_scroll + 1)
            .position(offset)
            .viewport_content_length(available);
        frame.render_stateful_widget(
            ratatui::widgets::Scrollbar::default()
                .begin_symbol(None)
                .end_symbol(None),
            Rect::new(parts[1].x, parts[1].y + 1, parts[1].width, available as u16),
            &mut state,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn palette_ranks_frequency_then_recency_and_keeps_unused_order() {
        let mut app = Workbench::new();
        app.set_input("/".into());
        assert_eq!(
            app.palette_actions()
                .iter()
                .map(|a| a.id)
                .collect::<Vec<_>>(),
            ACTIONS.iter().map(|a| a.id).collect::<Vec<_>>()
        );
        app.record_action(find_action("/打开schema").unwrap());
        app.record_action(find_action("/SCHEMA").unwrap());
        app.record_action(ActionId::Log);
        app.record_action(ActionId::Devices);
        let actions = app.palette_actions();
        assert_eq!(actions[0].id, ActionId::Schema);
        assert_eq!(actions[1].id, ActionId::Devices);
        assert_eq!(actions[2].id, ActionId::Log);
        assert_eq!(
            actions[3..].iter().map(|a| a.id).collect::<Vec<_>>(),
            ACTIONS
                .iter()
                .filter(|a| ![ActionId::Schema, ActionId::Devices, ActionId::Log].contains(&a.id))
                .map(|a| a.id)
                .collect::<Vec<_>>()
        );
        app.record_action(ActionId::Log);
        assert_eq!(app.palette_actions()[0].id, ActionId::Log);
    }
    #[test]
    fn palette_search_preserves_matching_and_renders_ranked_selection() {
        let mut app = Workbench::new();
        app.record_action(ActionId::Help);
        app.record_action(ActionId::Help);
        app.record_action(ActionId::Logcat);
        app.set_input("/日志".into());
        let actions = app.palette_actions();
        assert_eq!(actions[0].id, ActionId::Logcat);
        assert!(!actions.iter().any(|a| a.id == ActionId::Help));
        assert_eq!(actions.len(), search_actions("/日志").len());
        app.menu = true;
        let mut terminal = Terminal::new(ratatui::backend::TestBackend::new(120, 32)).unwrap();
        terminal
            .draw(|frame| render_workbench(frame, &mut app))
            .unwrap();
        let buffer = terminal.backend().buffer();
        let text = (0..32)
            .map(|y| {
                (0..120)
                    .map(|x| buffer[(x, y)].symbol())
                    .collect::<String>()
            })
            .collect::<Vec<_>>()
            .join("\n");
        assert!(text.replace(' ', "").contains("›采集设备日志（不清空）"));
        app.set_input("/SCREENSHOT".into());
        assert_eq!(app.palette_actions()[0].id, ActionId::Screenshot);
        app.set_input("/log".into());
        assert_eq!(app.palette_actions()[0].id, ActionId::Log);
        app.set_input("/no-such-command".into());
        assert!(app.palette_actions().is_empty());
        app.menu_index = 5;
        app.set_input("/".into());
        assert_eq!(app.menu_index, 0);
    }
    fn draw_details(app: &mut Workbench, width: u16) -> String {
        let mut terminal = Terminal::new(ratatui::backend::TestBackend::new(width, 24)).unwrap();
        terminal
            .draw(|frame| render_results(frame, frame.area(), app))
            .unwrap();
        let buffer = terminal.backend().buffer();
        (app.detail_area.y + 1..app.detail_area.bottom() - 1)
            .map(|y| {
                (1..width - 1)
                    .map(|x| buffer[(x, y)].symbol())
                    .collect::<String>()
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
    #[test]
    fn following_shows_tail_of_long_wrapped_log_records() {
        for width in [24, 60, 120] {
            let mut app = Workbench::new();
            let id = app.add_task("log", None, None, true);
            app.tasks[id]
                .lines
                .push_back(format!("{}TAIL-MARK", "长日志 content ".repeat(500)));
            let text = draw_details(&mut app, width).replace([' ', '\n'], "");
            assert!(text.ends_with("TAIL-MARK"), "missing log tail at {width}");
            assert!(app.max_scroll > 0);
            assert_eq!(app.scroll, 0);
        }
    }
    #[test]
    fn scrolling_freezes_history_across_buffer_rollover_and_bottom_resumes() {
        let mut app = Workbench::new();
        let id = app.add_task("log", None, None, true);
        for n in 0..2000 {
            app.tasks[id].lines.push_back(format!("record-{n:04}"));
        }
        draw_details(&mut app, 60);
        let mut mouse = event::MouseEvent {
            kind: event::MouseEventKind::ScrollUp,
            column: 10,
            row: 1,
            modifiers: KeyModifiers::NONE,
        };
        app.mouse(mouse);
        assert!(!app.paused, "scroll outside details must be ignored");
        mouse.row = app.detail_area.y + 2;
        app.menu = true;
        app.mouse(mouse);
        assert!(!app.paused, "command overlay must block scrolling");
        app.menu = false;
        app.mouse(mouse);
        assert_eq!(app.scroll, 3);
        assert!(app.paused);
        let before = draw_details(&mut app, 60);
        for n in 2000..2050 {
            app.sender
                .send(Message::Log(id, format!("record-{n:04}")))
                .unwrap();
        }
        app.messages();
        assert_eq!(app.tasks[id].lines.len(), 2000);
        assert_eq!(app.tasks[id].lines.front().unwrap(), "record-0050");
        assert_eq!(before, draw_details(&mut app, 60));
        app.scroll_results(true, usize::MAX);
        assert_eq!(app.scroll, app.max_scroll);
        assert!(draw_details(&mut app, 60).contains("record-0000"));
        app.scroll_results(false, usize::MAX);
        assert!(!app.paused);
        assert!(app.frozen.is_none());
        assert_eq!(app.scroll, 0);
        assert!(draw_details(&mut app, 60).contains("record-2049"));
    }
    #[test]
    fn ordinary_results_scroll_by_wrapped_rows_with_bounds() {
        let mut app = Workbench::new();
        let id = app.add_task("details", None, None, false);
        app.tasks[id].result.output = format!("{}\nLAST-RESULT", "result data ".repeat(500));
        let top = draw_details(&mut app, 60);
        app.scroll_results(true, usize::MAX);
        assert_eq!(app.scroll, 0);
        app.scroll_results(false, 1);
        assert_ne!(top, draw_details(&mut app, 60));
        app.scroll_results(false, usize::MAX);
        assert!(draw_details(&mut app, 60).contains("LAST-RESULT"));
        assert_eq!(app.scroll, app.max_scroll);
        assert!(!app.paused);
    }
    #[test]
    fn mouse_wheel_browses_session_tasks_and_updates_details_with_bounds() {
        let mut app = Workbench::new();
        for n in 0..12 {
            let id = app.add_task(&format!("task-{n:02}"), None, None, false);
            app.tasks[id].result.output = format!("output-{n:02}");
        }
        assert!(draw_details(&mut app, 60).contains("output-11"));
        let mut mouse = event::MouseEvent {
            kind: event::MouseEventKind::ScrollUp,
            column: 10,
            row: app.task_area.y + 2,
            modifiers: KeyModifiers::NONE,
        };
        app.menu = true;
        app.mouse(mouse);
        assert_eq!(app.selected_task, 11);
        app.menu = false;
        app.mouse(mouse);
        assert_eq!(app.selected_task, 8);
        assert!(draw_details(&mut app, 60).contains("output-08"));
        for _ in 0..10 {
            app.mouse(mouse);
        }
        assert_eq!(app.selected_task, 0);
        assert!(draw_details(&mut app, 60).contains("output-00"));
        app.scroll = 5;
        app.paused = true;
        app.frozen = Some(vec!["previous task".into()]);
        mouse.kind = event::MouseEventKind::ScrollDown;
        app.mouse(mouse);
        assert_eq!(app.selected_task, 3);
        assert_eq!(app.scroll, 0);
        assert!(!app.paused);
        assert!(app.frozen.is_none());
        assert!(draw_details(&mut app, 60).contains("output-03"));
        for _ in 0..10 {
            app.mouse(mouse);
        }
        assert_eq!(app.selected_task, 11);
    }
    #[test]
    fn ctrl_c_stops_background_log_without_quitting_then_exits_when_idle() {
        let mut app = Workbench::new();
        let log = app.add_task("日志", Some("first".into()), None, true);
        let other = app.add_task("截图", Some("second".into()), None, false);
        app.interrupt();
        assert_eq!(app.selected_task, log);
        assert!(app.tasks[log].cancel.load(Ordering::Relaxed));
        assert!(!app.tasks[other].cancel.load(Ordering::Relaxed));
        assert_eq!(app.tasks[log].result.status, TaskStatus::Saving);
        assert!(!app.quit);
        app.interrupt();
        assert!(!app.quit);
        app.tasks[log].result.status = TaskStatus::Success;
        app.interrupt();
        assert!(app.quit);
    }
    #[test]
    fn completed_log_keeps_full_wrapped_path_in_session_task_panel() {
        for width in [40, 120] {
            let mut app = Workbench::new();
            for _ in 0..8 {
                app.add_task("旧任务", None, None, false);
            }
            let id = app.add_task("日志采集", Some("first".into()), None, true);
            let path = PathBuf::from(
                "/Users/developer/开发项目/very-long-working-directory/another-directory/123.txt",
            );
            app.tasks[id].result.artifacts.push(path.clone());
            let mut result = app.tasks[id].result.clone();
            result.status = TaskStatus::Success;
            app.sender
                .send(Message::Done(
                    id,
                    Box::new(OperationResponse {
                        result,
                        data: ResponseData::None,
                    }),
                    Purpose::Normal,
                ))
                .unwrap();
            app.messages();
            let mut terminal =
                Terminal::new(ratatui::backend::TestBackend::new(width, 24)).unwrap();
            terminal
                .draw(|frame| render_results(frame, frame.area(), &mut app))
                .unwrap();
            let buffer = terminal.backend().buffer();
            let bottom = (0..24).find(|y| buffer[(0, *y)].symbol() == "└").unwrap();
            let text = (1..bottom)
                .map(|y| {
                    (1..width - 1)
                        .map(|x| buffer[(x, y)].symbol())
                        .collect::<String>()
                })
                .collect::<Vec<_>>()
                .join("");
            let text = text.replace(' ', "");
            assert!(text.contains("已完成"));
            assert!(text.contains(&format!("日志：{}", path.display())));
        }
    }
    #[test]
    fn context_switch_does_not_retarget_running_task() {
        let mut app = Workbench::new();
        app.target("first".into());
        app.package = Some("com.demo.app".into());
        let id = app.add_task("test", Some("first".into()), app.package.clone(), true);
        app.target("second".into());
        assert!(app.package.is_none());
        assert_eq!(app.tasks[id].result.device.as_deref(), Some("first"));
        assert_eq!(
            app.tasks[id].result.package.as_deref(),
            Some("com.demo.app")
        );
    }
    #[test]
    fn layout_and_unicode_cursor_fit_standard_and_narrow_terminals() {
        for (width, height) in [(120, 32), (60, 20), (20, 10), (8, 5)] {
            let mut terminal =
                Terminal::new(ratatui::backend::TestBackend::new(width, height)).unwrap();
            let mut app = Workbench::new();
            app.open_form(
                ActionId::Schema,
                vec![("schema", "demo://中文/long/path?value=123456789".into())],
                None,
            );
            terminal.draw(|f| render_workbench(f, &mut app)).unwrap();
            if height >= 20 {
                let buffer = terminal.backend().buffer();
                let text = (0..height)
                    .map(|y| {
                        (0..width)
                            .map(|x| buffer[(x, y)].symbol())
                            .collect::<String>()
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                assert!(!text.contains("功能导航"));
                assert_eq!(buffer[(0, if width < 86 { 4 } else { 3 })].symbol(), "┌");
            }

            let cursor = terminal.get_cursor_position().unwrap();
            assert!(cursor.x < width && cursor.y < height);
        }
    }
    #[test]
    fn paused_display_is_frozen_while_stream_buffer_updates() {
        let mut app = Workbench::new();
        let id = app.add_task("log", Some("one".into()), None, true);
        app.tasks[id].lines.push_back("first".into());
        app.frozen = Some(app.log_lines());
        app.paused = true;
        app.tasks[id].lines.push_back("second".into());
        assert_eq!(app.frozen.as_ref().unwrap().len(), 1);
        assert_eq!(app.log_lines().len(), 2);
    }
}
