use anyhow::{Context, Result};
use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind, KeyModifiers},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use mylogger_core::{
    AnalysisOptions, Intent, LogLevel, analyze_file, generate_markdown_report, route_intent,
};
use mylogger_tools::{AdbDevice, CaptureOptions, capture_logcat, list_adb_devices};
use ratatui::{
    Terminal,
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, List, ListItem, Paragraph, Wrap},
};
use std::io::{self, IsTerminal, Write};
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use unicode_width::UnicodeWidthStr;

#[derive(Debug, Default)]
pub struct SessionState {
    pub selected_device: Option<String>,
    pub current_log_file: Option<PathBuf>,
    pub last_capture_file: Option<PathBuf>,
}

#[derive(Debug, Default)]
struct UiState {
    input: String,
    cursor: usize,
    messages: Vec<String>,
    menu_visible: bool,
    menu_selected: usize,
    device_picker: Option<DevicePicker>,
}

#[derive(Debug, Clone)]
struct DevicePicker {
    devices: Vec<AdbDevice>,
    selected: usize,
    time_named: bool,
}

pub fn run_repl() -> Result<()> {
    if !io::stdin().is_terminal() {
        return run_line_repl();
    }

    let mut terminal = TerminalSession::enter()?;
    let mut session = SessionState::default();
    let mut ui = UiState {
        messages: welcome_messages(),
        ..Default::default()
    };

    loop {
        terminal.draw(|frame| render(frame, &ui))?;

        let Event::Key(key) = event::read().context("failed to read terminal event")? else {
            continue;
        };
        if key.kind != KeyEventKind::Press {
            continue;
        }

        match key.code {
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => break,
            KeyCode::Esc if ui.device_picker.is_some() => {
                ui.device_picker = None;
                ui.messages.push("已取消设备选择。".to_string());
            }
            KeyCode::Up if ui.device_picker.is_some() => {
                if let Some(picker) = ui.device_picker.as_mut() {
                    picker.selected = previous_index(picker.selected, picker.devices.len());
                }
            }
            KeyCode::Down if ui.device_picker.is_some() => {
                if let Some(picker) = ui.device_picker.as_mut() {
                    picker.selected = next_index(picker.selected, picker.devices.len());
                }
            }
            KeyCode::Enter if ui.device_picker.is_some() => {
                let Some(picker) = ui.device_picker.take() else {
                    continue;
                };
                if let Some(device) = picker.devices.get(picker.selected) {
                    let time_named = picker.time_named;
                    let command_label = capture_command_label(time_named);
                    let output = execute_capture_with_terminal_restore(
                        &mut terminal,
                        time_named,
                        device.serial.clone(),
                        &mut session,
                    )?;
                    ui.messages.push(format!("> {command_label}\n{output}"));
                }
            }
            _ if ui.device_picker.is_some() => {}
            KeyCode::Esc if ui.menu_visible => {
                ui.menu_visible = false;
            }
            KeyCode::Esc if !ui.input.is_empty() => ui.clear_input(),
            KeyCode::Up if ui.menu_visible => {
                ui.menu_selected = previous_index(ui.menu_selected, ui.visible_menu_items().len());
            }
            KeyCode::Down if ui.menu_visible => {
                ui.menu_selected = next_index(ui.menu_selected, ui.visible_menu_items().len());
            }
            KeyCode::Enter if ui.menu_visible => {
                if let Some(item) = ui.selected_menu_item() {
                    if ui.input.trim() == item.command {
                        let command = item.command.to_string();
                        ui.clear_input();
                        ui.menu_visible = false;
                        if matches!(route_intent(&command), Intent::Quit) {
                            break;
                        }
                        let output =
                            execute_tui_command(&mut terminal, &command, &mut session, &mut ui)?;
                        ui.messages.push(format!("> {command}\n{output}"));
                    } else {
                        ui.input = item.command.to_string();
                        ui.cursor = ui.input.chars().count();
                        ui.menu_visible = false;
                    }
                } else {
                    ui.menu_visible = false;
                }
            }
            KeyCode::Enter => {
                let command = ui.input.trim().to_string();
                ui.clear_input();
                ui.menu_visible = false;
                if command.is_empty() {
                    continue;
                }
                if matches!(route_intent(&command), Intent::Quit) {
                    break;
                }
                let output = execute_tui_command(&mut terminal, &command, &mut session, &mut ui)?;
                ui.messages.push(format!("> {command}\n{output}"));
            }
            KeyCode::Backspace => {
                ui.backspace();
            }
            KeyCode::Delete => ui.delete(),
            KeyCode::Left => ui.move_left(),
            KeyCode::Right => ui.move_right(),
            KeyCode::Home => ui.move_home(),
            KeyCode::End => ui.move_end(),
            KeyCode::Char(ch) => {
                if !key
                    .modifiers
                    .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT)
                {
                    ui.insert_char(ch);
                }
            }
            _ => {}
        }
    }

    terminal.leave()
}

impl UiState {
    fn clear_input(&mut self) {
        self.input.clear();
        self.cursor = 0;
        self.refresh_menu();
    }

    fn insert_char(&mut self, ch: char) {
        let byte_index = byte_index_at_char(&self.input, self.cursor);
        self.input.insert(byte_index, ch);
        self.cursor += 1;
        self.refresh_menu();
    }

    fn backspace(&mut self) {
        if self.cursor == 0 {
            return;
        }
        let start = byte_index_at_char(&self.input, self.cursor - 1);
        let end = byte_index_at_char(&self.input, self.cursor);
        self.input.replace_range(start..end, "");
        self.cursor -= 1;
        self.refresh_menu();
    }

    fn delete(&mut self) {
        if self.cursor >= self.input.chars().count() {
            return;
        }
        let start = byte_index_at_char(&self.input, self.cursor);
        let end = byte_index_at_char(&self.input, self.cursor + 1);
        self.input.replace_range(start..end, "");
        self.refresh_menu();
    }

    fn move_left(&mut self) {
        self.cursor = self.cursor.saturating_sub(1);
    }

    fn move_right(&mut self) {
        self.cursor = (self.cursor + 1).min(self.input.chars().count());
    }

    fn move_home(&mut self) {
        self.cursor = 0;
    }

    fn move_end(&mut self) {
        self.cursor = self.input.chars().count();
    }

    fn refresh_menu(&mut self) {
        self.menu_visible = looks_like_slash_input(&self.input);
        let len = self.visible_menu_items().len();
        if len == 0 {
            self.menu_selected = 0;
        } else {
            self.menu_selected = self.menu_selected.min(len - 1);
        }
    }

    fn visible_menu_items(&self) -> Vec<&'static MenuItem> {
        slash_menu_items(&self.input)
    }

    fn selected_menu_item(&self) -> Option<&'static MenuItem> {
        self.visible_menu_items().get(self.menu_selected).copied()
    }
}

struct TerminalSession {
    terminal: Terminal<CrosstermBackend<io::Stdout>>,
    active: bool,
}

impl TerminalSession {
    fn enter() -> Result<Self> {
        enable_raw_mode().context("failed to enable raw mode")?;
        let mut stdout = io::stdout();
        execute!(stdout, EnterAlternateScreen).context("failed to enter alternate screen")?;
        let backend = CrosstermBackend::new(stdout);
        let terminal = Terminal::new(backend).context("failed to create terminal")?;
        Ok(Self {
            terminal,
            active: true,
        })
    }

    fn draw<F>(&mut self, f: F) -> Result<()>
    where
        F: FnOnce(&mut ratatui::Frame<'_>),
    {
        self.terminal.draw(f).context("failed to draw ui")?;
        Ok(())
    }

    fn suspend(&mut self) -> Result<()> {
        if self.active {
            disable_raw_mode().context("failed to disable raw mode")?;
            execute!(self.terminal.backend_mut(), LeaveAlternateScreen)
                .context("failed to leave alternate screen")?;
            self.active = false;
        }
        Ok(())
    }

    fn resume(&mut self) -> Result<()> {
        if !self.active {
            enable_raw_mode().context("failed to enable raw mode")?;
            execute!(self.terminal.backend_mut(), EnterAlternateScreen)
                .context("failed to enter alternate screen")?;
            self.terminal
                .clear()
                .context("failed to clear terminal after resume")?;
            self.active = true;
        }
        Ok(())
    }

    fn leave(mut self) -> Result<()> {
        self.suspend()
    }
}

impl Drop for TerminalSession {
    fn drop(&mut self) {
        if self.active {
            let _ = disable_raw_mode();
            let _ = execute!(self.terminal.backend_mut(), LeaveAlternateScreen);
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct MenuItem {
    command: &'static str,
    description: &'static str,
}

const MENU_ITEMS: &[MenuItem] = &[
    MenuItem {
        command: "/help",
        description: "查看帮助",
    },
    MenuItem {
        command: "/capture",
        description: "抓取 Android 日志，默认写入 ./123.txt",
    },
    MenuItem {
        command: "/capture -t",
        description: "抓取 Android 日志，写入时间命名文件",
    },
    MenuItem {
        command: "/analyze",
        description: "打开 yazi 选择日志文件并分析",
    },
    MenuItem {
        command: "/filter error",
        description: "只看 Error 及以上级别",
    },
    MenuItem {
        command: "/report",
        description: "基于当前日志生成 mylogger-report.md",
    },
    MenuItem {
        command: "/device",
        description: "查看 adb devices",
    },
    MenuItem {
        command: "/quit",
        description: "退出",
    },
];

fn previous_index(index: usize, len: usize) -> usize {
    if len == 0 {
        0
    } else if index == 0 {
        len - 1
    } else {
        index - 1
    }
}

fn next_index(index: usize, len: usize) -> usize {
    if len == 0 { 0 } else { (index + 1) % len }
}

fn render(frame: &mut ratatui::Frame<'_>, ui: &UiState) {
    let menu_items = ui.visible_menu_items();
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(8),
            Constraint::Length(if ui.menu_visible {
                (menu_items.len() as u16 + 2).clamp(3, 12)
            } else {
                0
            }),
            Constraint::Length(3),
        ])
        .split(frame.area());

    let messages: Vec<Line<'_>> = ui
        .messages
        .iter()
        .flat_map(|message| message.lines().map(Line::from).collect::<Vec<_>>())
        .collect();
    let transcript = Paragraph::new(messages)
        .block(Block::default().title("MyLogger").borders(Borders::ALL))
        .wrap(Wrap { trim: false });
    frame.render_widget(transcript, chunks[0]);

    if ui.menu_visible {
        render_menu(frame, chunks[1], ui, &menu_items);
    }

    let input = Paragraph::new(Line::from(vec![
        Span::styled("> ", Style::default().fg(Color::Cyan)),
        Span::raw(ui.input.as_str()),
    ]))
    .block(Block::default().borders(Borders::ALL).title("Input"));
    frame.render_widget(input, chunks[2]);
    set_input_cursor(frame, chunks[2], ui);

    if let Some(picker) = ui.device_picker.as_ref() {
        let area = centered_rect(frame.area(), 72, picker_height(picker));
        render_device_picker(frame, area, picker);
    }
}

fn render_device_picker(frame: &mut ratatui::Frame<'_>, area: Rect, picker: &DevicePicker) {
    let items = picker
        .devices
        .iter()
        .enumerate()
        .map(|(index, device)| {
            let style = if index == picker.selected {
                Style::default()
                    .fg(Color::Black)
                    .bg(Color::Yellow)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default()
            };
            ListItem::new(Line::from(vec![
                Span::styled(format!("{:>2}.  {:<24}", index + 1, device.serial), style),
                Span::styled(device.state.to_string(), style),
            ]))
            .style(style)
        })
        .collect::<Vec<_>>();
    let list = List::new(items).block(
        Block::default()
            .borders(Borders::ALL)
            .title("Devices  ↑/↓ 选择  Enter 开始抓取  Esc 取消"),
    );
    frame.render_widget(Clear, area);
    frame.render_widget(list, area);
}

fn picker_height(picker: &DevicePicker) -> u16 {
    (picker.devices.len() as u16 + 2).clamp(4, 12)
}

fn centered_rect(area: Rect, percent_x: u16, height: u16) -> Rect {
    let preferred_width = area.width.saturating_mul(percent_x).saturating_div(100);
    let width = if area.width >= 48 {
        preferred_width.clamp(48, area.width)
    } else {
        area.width
    };
    let height = if area.height >= 5 {
        height.clamp(3, area.height.saturating_sub(2))
    } else {
        area.height
    };
    Rect {
        x: area.x + area.width.saturating_sub(width) / 2,
        y: area.y + area.height.saturating_sub(height) / 2,
        width,
        height,
    }
}

fn render_menu(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    ui: &UiState,
    menu_items: &[&'static MenuItem],
) {
    let items = menu_items
        .iter()
        .enumerate()
        .map(|(index, item)| {
            let style = if index == ui.menu_selected {
                Style::default()
                    .fg(Color::Black)
                    .bg(Color::Yellow)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default()
            };
            ListItem::new(Line::from(vec![
                Span::styled(format!("{:<14}", item.command), style),
                Span::styled(item.description, style),
            ]))
            .style(style)
        })
        .collect::<Vec<_>>();
    let menu = List::new(items).block(
        Block::default()
            .borders(Borders::ALL)
            .title("Commands  ↑/↓ 选择  Enter 填入命令  Esc 关闭"),
    );
    frame.render_widget(menu, area);
}

fn set_input_cursor(frame: &mut ratatui::Frame<'_>, area: Rect, ui: &UiState) {
    let prompt = "> ";
    let cursor_prefix = chars_prefix(&ui.input, ui.cursor);
    let x_offset = UnicodeWidthStr::width(prompt) + UnicodeWidthStr::width(cursor_prefix.as_str());
    let x = area
        .x
        .saturating_add(1)
        .saturating_add(x_offset as u16)
        .min(area.x.saturating_add(area.width.saturating_sub(2)));
    let y = area.y.saturating_add(1);
    frame.set_cursor_position((x, y));
}

fn looks_like_slash_input(input: &str) -> bool {
    input.starts_with('/') && !input.contains(char::is_whitespace)
}

fn slash_menu_items(input: &str) -> Vec<&'static MenuItem> {
    if !looks_like_slash_input(input) {
        return Vec::new();
    }
    let prefix = input.trim_start_matches('/').to_ascii_lowercase();
    MENU_ITEMS
        .iter()
        .filter(|item| {
            let command = item.command.trim_start_matches('/').to_ascii_lowercase();
            command.starts_with(&prefix)
        })
        .collect()
}

fn byte_index_at_char(text: &str, char_index: usize) -> usize {
    if char_index == 0 {
        return 0;
    }
    text.char_indices()
        .nth(char_index)
        .map(|(index, _)| index)
        .unwrap_or(text.len())
}

fn chars_prefix(text: &str, char_count: usize) -> String {
    text.chars().take(char_count).collect()
}

fn run_line_repl() -> Result<()> {
    let mut session = SessionState::default();
    print_welcome_for_line_mode();
    loop {
        print!("MyLogger> ");
        io::stdout().flush().ok();
        let mut input = String::new();
        let bytes = io::stdin()
            .read_line(&mut input)
            .context("failed to read input")?;
        if bytes == 0 {
            println!();
            break;
        }
        let input = input.trim();
        if input.is_empty() {
            continue;
        }

        if let Err(err) = handle_input(input, &mut session) {
            eprintln!("error: {err:#}");
        }
    }
    Ok(())
}

fn execute_tui_command(
    terminal: &mut TerminalSession,
    command: &str,
    session: &mut SessionState,
    ui: &mut UiState,
) -> Result<String> {
    match route_intent(normalize_command(command)) {
        Intent::Capture { time_named } => {
            return prepare_tui_capture(terminal, time_named, session, ui);
        }
        Intent::Analyze { path: None } => {
            return execute_tui_analyze_with_yazi(terminal, session);
        }
        _ => {}
    }

    Ok(match execute_tui_command_inner(command, session) {
        Ok(output) => output,
        Err(err) => format!("执行失败：{err:#}"),
    })
}

fn execute_tui_analyze_with_yazi(
    terminal: &mut TerminalSession,
    session: &mut SessionState,
) -> Result<String> {
    let path = select_log_file_with_yazi(Some(terminal))?;
    let summary = analyze_file(&path, &AnalysisOptions::default())?;
    session.current_log_file = Some(path.clone());
    Ok(format_summary(&path, &summary))
}

fn prepare_tui_capture(
    terminal: &mut TerminalSession,
    time_named: bool,
    session: &mut SessionState,
    ui: &mut UiState,
) -> Result<String> {
    let devices = list_adb_devices()?;
    let available = devices
        .into_iter()
        .filter(|device| device.state.is_available())
        .collect::<Vec<_>>();

    match available.len() {
        0 => Ok("未检测到可用 Android 设备，请连接设备或启动模拟器。".to_string()),
        1 => execute_capture_with_terminal_restore(
            terminal,
            time_named,
            available[0].serial.clone(),
            session,
        ),
        _ => {
            ui.device_picker = Some(DevicePicker {
                devices: available,
                selected: 0,
                time_named,
            });
            Ok("检测到多个 Android 设备，请使用上下键选择设备后开始抓取。".to_string())
        }
    }
}

fn execute_capture_with_terminal_restore(
    terminal: &mut TerminalSession,
    time_named: bool,
    device: String,
    session: &mut SessionState,
) -> Result<String> {
    terminal.suspend()?;
    println!("MyLogger capture 已切换到终端模式。");
    println!("抓取过程中按 Ctrl+C 结束，结束后会自动返回 TUI。");
    println!();

    let result = capture_logcat(&CaptureOptions {
        device: Some(device),
        time_named,
        ..Default::default()
    });

    terminal.resume()?;
    drain_pending_terminal_events(Duration::from_millis(300));

    Ok(match result {
        Ok(path) => {
            session.last_capture_file = Some(path.clone());
            session.current_log_file = Some(path.clone());
            format!("日志抓取结束：{}", path.display())
        }
        Err(err) => format!("日志抓取失败：{err:#}"),
    })
}

fn drain_pending_terminal_events(max_duration: Duration) {
    let started = Instant::now();
    while started.elapsed() < max_duration {
        match event::poll(Duration::from_millis(25)) {
            Ok(true) => {
                let _ = event::read();
            }
            Ok(false) => break,
            Err(_) => break,
        }
    }
}

fn execute_tui_command_inner(command: &str, session: &mut SessionState) -> Result<String> {
    let normalized = normalize_command(command);

    match route_intent(normalized) {
        Intent::Capture { time_named: _ } => {
            unreachable!("capture is handled before inner command execution")
        }
        Intent::Analyze { path } => {
            let path = resolve_tui_log_path(path, session)?;
            let summary = analyze_file(&path, &AnalysisOptions::default())?;
            session.current_log_file = Some(path.clone());
            Ok(format_summary(&path, &summary))
        }
        Intent::FilterError => {
            let path = resolve_tui_log_path(None, session)?;
            let summary = analyze_file(
                &path,
                &AnalysisOptions {
                    min_level: Some(LogLevel::Error),
                    ..Default::default()
                },
            )?;
            Ok(format_summary(&path, &summary))
        }
        Intent::Report => {
            let path = resolve_tui_log_path(None, session)?;
            let summary = analyze_file(&path, &AnalysisOptions::default())?;
            let report = generate_markdown_report(&summary);
            let output = PathBuf::from("mylogger-report.md");
            std::fs::write(&output, report)
                .with_context(|| format!("failed to write {}", output.display()))?;
            Ok(format!("报告已生成：{}", output.display()))
        }
        Intent::Device => {
            let devices = list_adb_devices()?;
            if devices.is_empty() {
                Ok("未检测到 Android 设备。".to_string())
            } else {
                Ok(devices
                    .into_iter()
                    .map(|device| format!("{}\t{}", device.serial, device.state))
                    .collect::<Vec<_>>()
                    .join("\n"))
            }
        }
        Intent::CommandPalette => Ok(command_palette_text()),
        Intent::Help => Ok(help_text()),
        Intent::Quit => Ok("bye".to_string()),
        Intent::Unknown => Ok(
            "暂未识别该请求。可尝试：抓取日志、/analyze <file>、只看 Error、/report、/help。"
                .to_string(),
        ),
    }
}

fn normalize_command(command: &str) -> &str {
    match command {
        "1" => "capture",
        "2" => "/analyze",
        "3" => "分析崩溃",
        "4" => "只看 Error",
        "5" => "/report",
        "6" => "/device",
        other => other,
    }
}

fn resolve_tui_log_path(path: Option<String>, session: &SessionState) -> Result<PathBuf> {
    if let Some(path) = path {
        return Ok(PathBuf::from(path));
    }
    if let Some(path) = session.current_log_file.as_ref() {
        return Ok(path.clone());
    }
    if let Some(path) = session.last_capture_file.as_ref() {
        return Ok(path.clone());
    }
    anyhow::bail!("请指定日志文件路径，例如：/analyze app.log")
}

fn format_summary(path: &PathBuf, summary: &mylogger_core::AnalysisSummary) -> String {
    let mut out = String::new();
    out.push_str(&format!("分析文件：{}\n", path.display()));
    out.push_str(&format!("总行数：{}\n", summary.total_lines));
    out.push_str(&format!("命中行数：{}\n", summary.matched_lines));
    out.push_str(&format!("发现问题：{}\n", summary.issues.len()));
    if !summary.level_counts.is_empty() {
        out.push_str("级别统计：\n");
        for (level, count) in &summary.level_counts {
            out.push_str(&format!("  {level}: {count}\n"));
        }
    }
    if !summary.top_tags.is_empty() {
        out.push_str("Top Tag：\n");
        for (tag, count) in &summary.top_tags {
            out.push_str(&format!("  {tag}: {count}\n"));
        }
    }
    for issue in summary.issues.iter().take(5) {
        out.push_str(&format!(
            "- [{:?}] {} (line {}-{})\n",
            issue.issue_type, issue.title, issue.first_line, issue.last_line
        ));
    }
    out.trim_end().to_string()
}

fn help_text() -> String {
    [
        "可用输入：",
        "  /                 打开命令菜单",
        "  /capture          抓取日志，默认写入 ./123.txt，Ctrl+C 结束",
        "  /capture -t       抓取日志，写入 mylogger-YYYYMMDD-HHMMSS.log",
        "  /analyze          打开 yazi 选择日志文件并分析",
        "  /analyze <file>   直接分析指定日志文件",
        "  /filter error     对当前日志执行 Error 过滤分析",
        "  /report           对当前日志生成 mylogger-report.md",
        "  /device           查看 adb devices",
        "  /quit             退出",
    ]
    .join("\n")
}

fn command_palette_text() -> String {
    let mut out = String::from("支持的命令：\n");
    for item in MENU_ITEMS {
        out.push_str(&format!("  {:<16} {}\n", item.command, item.description));
    }
    out.trim_end().to_string()
}

fn capture_command_label(time_named: bool) -> &'static str {
    if time_named {
        "/capture -t"
    } else {
        "/capture"
    }
}

fn welcome_messages() -> Vec<String> {
    vec![String::from(
        "常用操作：\n\
         [1] 抓取 Android 日志\n\
         [2] 分析本地日志文件\n\
         [3] 提取崩溃\n\
         [4] 只看 Error\n\
         [5] 生成报告\n\
         [6] 查看设备\n\n\
         输入 / 打开命令菜单，使用上下键选择，Enter 填入命令。\n\
         Ctrl+C 退出。",
    )]
}

fn print_welcome_for_line_mode() {
    println!("MyLogger");
    println!();
    println!("常用操作：");
    println!("[1] 抓取 Android 日志");
    println!("[2] 分析本地日志文件");
    println!("[3] 提取崩溃");
    println!("[4] 只看 Error");
    println!("[5] 生成报告");
    println!("[6] 查看设备");
    println!();
    println!("请输入编号、命令或自然语言。输入 / 查看命令，/quit 退出。");
}

fn handle_input(input: &str, session: &mut SessionState) -> Result<()> {
    let normalized = match input {
        "1" => "capture",
        "2" => "/analyze",
        "3" => "分析崩溃",
        "4" => "只看 Error",
        "5" => "/report",
        "6" => "/device",
        other => other,
    };

    match route_intent(normalized) {
        Intent::Capture { time_named } => {
            let output = capture_logcat(&CaptureOptions {
                device: session.selected_device.clone(),
                time_named,
                ..Default::default()
            })?;
            session.last_capture_file = Some(output.clone());
            session.current_log_file = Some(output);
        }
        Intent::Analyze { path } => {
            let path = resolve_log_path(path, session)?;
            let summary = analyze_file(&path, &AnalysisOptions::default())?;
            session.current_log_file = Some(path.clone());
            print_summary(&path, &summary);
        }
        Intent::FilterError => {
            let path = resolve_log_path(None, session)?;
            let summary = analyze_file(
                &path,
                &AnalysisOptions {
                    min_level: Some(LogLevel::Error),
                    ..Default::default()
                },
            )?;
            print_summary(&path, &summary);
        }
        Intent::Report => {
            let path = resolve_log_path(None, session)?;
            let summary = analyze_file(&path, &AnalysisOptions::default())?;
            let report = generate_markdown_report(&summary);
            let output = PathBuf::from("mylogger-report.md");
            std::fs::write(&output, report)
                .with_context(|| format!("failed to write {}", output.display()))?;
            println!("报告已生成：{}", output.display());
        }
        Intent::Device => {
            let devices = list_adb_devices()?;
            if devices.is_empty() {
                println!("未检测到 Android 设备。");
            } else {
                for device in devices {
                    println!("{}\t{}", device.serial, device.state);
                }
            }
        }
        Intent::CommandPalette => print_command_palette(),
        Intent::Help => print_help(),
        Intent::Quit => {
            println!("bye");
            std::process::exit(0);
        }
        Intent::Unknown => {
            println!(
                "暂未识别该请求。可尝试：抓取日志、分析 app.log、只看 Error、生成报告、/help。"
            );
        }
    }
    Ok(())
}

fn resolve_log_path(path: Option<String>, session: &SessionState) -> Result<PathBuf> {
    if let Some(path) = path {
        return Ok(PathBuf::from(path));
    }
    select_log_file_with_yazi(None).or_else(|_| {
        if let Some(path) = session.current_log_file.as_ref() {
            return Ok(path.clone());
        }
        if let Some(path) = session.last_capture_file.as_ref() {
            return Ok(path.clone());
        }
        anyhow::bail!("请安装 yazi，或指定日志文件路径，例如：/analyze app.log")
    })
}

fn select_log_file_with_yazi(mut terminal: Option<&mut TerminalSession>) -> Result<PathBuf> {
    let chooser_file = std::env::temp_dir().join(format!(
        "mylogger-yazi-choice-{}-{}.txt",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let _ = std::fs::remove_file(&chooser_file);

    if let Some(terminal) = terminal.as_deref_mut() {
        terminal.suspend()?;
    }
    println!("MyLogger 已打开 yazi，请选择日志文件。");

    let status = Command::new("yazi")
        .arg("--chooser-file")
        .arg(&chooser_file)
        .status();

    if let Some(terminal) = terminal.as_deref_mut() {
        terminal.resume()?;
        drain_pending_terminal_events(Duration::from_millis(300));
    }

    let status =
        status.context("failed to start yazi; please install yazi and ensure it is in PATH")?;
    if !status.success() {
        anyhow::bail!("yazi exited with status {status}");
    }

    let selected = std::fs::read_to_string(&chooser_file).unwrap_or_default();
    let _ = std::fs::remove_file(&chooser_file);
    let selected = selected
        .lines()
        .next()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .context("未选择日志文件")?;
    Ok(PathBuf::from(selected))
}

fn print_summary(path: &PathBuf, summary: &mylogger_core::AnalysisSummary) {
    println!("分析文件：{}", path.display());
    println!("总行数：{}", summary.total_lines);
    println!("命中行数：{}", summary.matched_lines);
    println!("发现问题：{}", summary.issues.len());
    if !summary.level_counts.is_empty() {
        println!("级别统计：");
        for (level, count) in &summary.level_counts {
            println!("  {level}: {count}");
        }
    }
    if !summary.top_tags.is_empty() {
        println!("Top Tag：");
        for (tag, count) in &summary.top_tags {
            println!("  {tag}: {count}");
        }
    }
    for issue in summary.issues.iter().take(5) {
        println!(
            "- [{:?}] {} (line {}-{})",
            issue.issue_type, issue.title, issue.first_line, issue.last_line
        );
    }
}

fn print_help() {
    println!("可用输入：");
    println!("  /                 打开命令菜单");
    println!("  /capture          抓取日志，默认写入 ./123.txt，Ctrl+C 结束");
    println!("  /capture -t       抓取日志，写入 mylogger-YYYYMMDD-HHMMSS.log");
    println!("  /analyze          打开 yazi 选择日志文件并分析");
    println!("  /analyze <file>   直接分析指定日志文件");
    println!("  /filter error     对当前日志执行 Error 过滤分析");
    println!("  /report           对当前日志生成 mylogger-report.md");
    println!("  /device           查看 adb devices");
    println!("  /quit             退出");
}

fn print_command_palette() {
    println!("支持的命令：");
    for item in MENU_ITEMS {
        println!("  {:<16} {}", item.command, item.description);
    }
}
