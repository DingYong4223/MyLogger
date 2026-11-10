use super::*;
use mylogger_core::actions::{
    ACTIONS, ActionId, OperationResult, TaskStatus, find_action, search_actions,
};
use mylogger_tools::{
    capture::capture_stream,
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
    picker: Option<Picker>,
    form: Option<Form>,
    return_form: Option<(Form, String)>,
    tasks: Vec<Task>,
    selected_task: usize,
    scroll: u16,
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
            picker: None,
            form: None,
            return_form: None,
            tasks: vec![],
            selected_task: 0,
            scroll: 0,
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
                    ("设备绝对文件路径", String::new()),
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
                    "↑/↓ 选择任务；PageUp/PageDown 滚动；Ctrl+C 停止日志，Ctrl+X 停止其它任务。",
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
                let mut text="Tab 切换任务 / 输入；↑↓ 按焦点切换列表或输入历史\nPgUp/PgDn 滚动详情；Ctrl+C 停止日志，Ctrl+X 停止其它任务\nCtrl+P 暂停日志显示；Ctrl+F 关键词；Ctrl+L 最低级别\nCtrl+S 收藏 schema；Ctrl+G 指定/取消当前应用\nEsc 取消输入或选择；Ctrl+C 停止日志（无采集时退出）；/quit 退出\n\n可用命令（参数通过表单填写）：\n".to_string();
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
            "日志后台采集中，可继续操作。Ctrl+P 暂停显示；Ctrl+C 停止；完整日志持续写入文件。",
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
            self.set_input(String::new());
            self.notice("日志关键词筛选已更新；原始文件保持完整。");
            return Ok(());
        }
        if form.action == ActionId::Analyze {
            let path = if values[0].is_empty() {
                match select_log_file_with_yazi(Some(terminal)) {
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
    fn command(&mut self, command: String, terminal: &mut TerminalSession) -> Result<()> {
        if let Some(action) = find_action(&command) {
            self.request(Request::Action(action));
            return Ok(());
        }
        match route_intent(normalize_command(&command)) {
            Intent::Capture {
                time_named,
                clear_before_capture,
            } => self.request(Request::Capture {
                time_named,
                clear: clear_before_capture,
            }),
            Intent::OpenSchema => self.request(Request::Action(ActionId::Schema)),
            Intent::Analyze { path, open } => {
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
            Intent::StartService => self.ready(Request::Action(ActionId::StartService)),
            Intent::Help => self.ready(Request::Action(ActionId::Help)),
            Intent::Quit => self.quit = true,
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
            self.selected_task = index;
            self.stop_task();
            self.notice("正在停止日志采集并刷新文件，完成后留在工作台。");
        } else {
            self.quit = true;
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
        if matches!(key.code, KeyCode::PageUp | KeyCode::PageDown) {
            self.scroll = if (key.code == KeyCode::PageUp)
                == self.tasks.get(self.selected_task).is_some_and(|t| t.log)
            {
                self.scroll.saturating_add(8)
            } else {
                self.scroll.saturating_sub(8)
            };
            return Ok(());
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
            self.paused = false;
            self.frozen = None;
            self.scroll = 0;
            match key.code {
                KeyCode::Up => self.selected_task = self.selected_task.saturating_sub(1),
                KeyCode::Down => {
                    self.selected_task =
                        (self.selected_task + 1).min(self.tasks.len().saturating_sub(1))
                }
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
                search_actions(&self.editor.input)
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
            let len = search_actions(&self.editor.input).len();
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
        self.menu_index = self
            .menu_index
            .min(search_actions(&self.editor.input).len().saturating_sub(1));
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
    while !app.quit {
        app.messages();
        terminal.draw(|f| render_workbench(f, &mut app))?;
        if !event::poll(Duration::from_millis(50))? {
            continue;
        }
        match event::read()? {
            Event::Key(key) if key.kind == KeyEventKind::Press => app.key(key, &mut terminal)?,
            Event::Paste(text) => {
                for c in text.chars().filter(|c| !c.is_control()) {
                    app.editor.insert_char(c);
                }
            }
            _ => {}
        }
    }
    drop(app);
    terminal.leave()
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
        let actions = search_actions(&app.editor.input);
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
fn render_results(frame: &mut ratatui::Frame<'_>, area: Rect, app: &Workbench) {
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
                    let mut line = String::new();
                    let mut columns = 0;
                    let width = usize::from(area.width.saturating_sub(2)).max(1);
                    for ch in format!("日志：{}", path.display()).chars() {
                        let size = unicode_width::UnicodeWidthChar::width(ch).unwrap_or(0);
                        if columns + size > width && !line.is_empty() {
                            lines.push(Line::from(std::mem::take(&mut line)));
                            columns = 0;
                        }
                        line.push(ch);
                        columns += size;
                    }
                    if !line.is_empty() {
                        lines.push(Line::from(line));
                    }
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
            " 会话任务 · ↑↓ 选择 · Ctrl+C 停止日志 ",
            app.focus == Focus::Results,
        )),
        parts[0],
        &mut task_state,
    );
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
    let available = parts[1].height.saturating_sub(2) as usize;
    let offset = if task.log {
        lines
            .len()
            .saturating_sub(available)
            .saturating_sub(app.scroll as usize)
    } else {
        app.scroll.min(lines.len().saturating_sub(1) as u16) as usize
    };
    let text = lines
        .into_iter()
        .skip(offset)
        .collect::<Vec<_>>()
        .join("\n");
    frame.render_widget(
        Paragraph::new(text).wrap(Wrap { trim: false }).block(panel(
            if task.log {
                format!(
                    " 日志 · {} · 级别 {} · PgUp/PgDn ",
                    if app.paused { "暂停显示" } else { "跟随" },
                    app.level
                        .map(|l| l.to_string())
                        .unwrap_or_else(|| "全部".into())
                )
            } else {
                " 执行详情 · PgUp/PgDn ".into()
            },
            false,
        )),
        parts[1],
    );
}

#[cfg(test)]
mod tests {
    use super::*;
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
                .draw(|frame| render_results(frame, frame.area(), &app))
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
