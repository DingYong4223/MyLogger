use crate::adb::select_device;
use crate::operations::{parse_app_info, unique_output, validate_package};
use crate::process::{SHORT_TIMEOUT, run_adb, shell_quote};
use anyhow::{Context, Result, bail};
use chrono::Local;
use std::collections::HashSet;
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{
    Arc, Mutex, OnceLock,
    atomic::{AtomicBool, Ordering},
};
use std::time::{Duration, Instant};

static INTERRUPTED: OnceLock<Arc<AtomicBool>> = OnceLock::new();

#[derive(Debug, Clone, Default)]
pub struct CaptureOptions {
    pub device: Option<String>,
    pub package: Option<String>,
    pub output: Option<PathBuf>,
    pub time_named: bool,
    pub clear_before_capture: bool,
}

pub fn resolve_capture_output_path(options: &CaptureOptions) -> Result<PathBuf> {
    if let Some(output) = &options.output {
        return Ok(output.clone());
    }
    let path = std::env::current_dir()?.join(if options.time_named {
        Local::now()
            .format("mylogger-%Y%m%d-%H%M%S.log")
            .to_string()
    } else {
        "123.txt".into()
    });
    if options.time_named && path.exists() {
        return unique_output(path.parent().unwrap(), "mylogger", "log");
    }
    Ok(path)
}

pub fn capture_logcat(options: &CaptureOptions) -> Result<PathBuf> {
    let cancel = interrupt_flag()?;
    cancel.store(false, Ordering::Relaxed);
    let mut options = options.clone();
    options.device = Some(select_device(options.device.as_deref())?.serial);
    println!("开始采集日志，按 Ctrl+C 停止；默认覆盖当前目录的 123.txt。");
    capture_stream(&options, cancel, |line| {
        if line.starts_with("[MyLogger]") {
            eprintln!("{line}");
        }
    })
}

pub fn interrupt_flag() -> Result<Arc<AtomicBool>> {
    if let Some(flag) = INTERRUPTED.get() {
        return Ok(flag.clone());
    }
    let flag = Arc::new(AtomicBool::new(false));
    let handler = flag.clone();
    ctrlc::set_handler(move || handler.store(true, Ordering::Relaxed))?;
    let _ = INTERRUPTED.set(flag.clone());
    Ok(flag)
}

fn shell(serial: &str, args: &[&str], cancel: &AtomicBool) -> Result<String> {
    let command = args
        .iter()
        .map(|a| shell_quote(a))
        .collect::<Result<Vec<_>>>()?
        .join(" ");
    let output = run_adb(
        Some(serial),
        &["shell", &command],
        cancel,
        SHORT_TIMEOUT,
        None,
    )?;
    if output.code != Some(0) {
        bail!("进程查询失败：{}", output.text());
    }
    Ok(output.stdout)
}

fn package_pids(text: &str, package: &str) -> HashSet<u32> {
    text.lines()
        .filter_map(|line| {
            let fields = line.split_whitespace().collect::<Vec<_>>();
            let [pid, name, ..] = fields.as_slice() else {
                return None;
            };
            (name == &package || name.starts_with(&format!("{package}:")))
                .then(|| pid.parse().ok())
                .flatten()
        })
        .collect()
}

fn log_pid(line: &str) -> Option<u32> {
    // threadtime: MM-DD HH:MM:SS.mmm PID TID LEVEL TAG: message
    line.split_whitespace().nth(2)?.parse().ok()
}

/// Writes the complete selected stream; callbacks may discard display updates without losing the file.
pub fn capture_stream<F>(
    options: &CaptureOptions,
    cancel: Arc<AtomicBool>,
    mut on_line: F,
) -> Result<PathBuf>
where
    F: FnMut(&str) + Send + 'static,
{
    let serial = options
        .device
        .as_deref()
        .context("日志任务需要明确的设备 serial")?;
    let mut uid = None;
    let mut pids = None;
    if let Some(package) = &options.package {
        validate_package(package)?;
        let info = shell(serial, &["dumpsys", "package", package], &cancel)?;
        let info = parse_app_info(package, &info)?;
        let help = run_adb(
            Some(serial),
            &["logcat", "--help"],
            &cancel,
            SHORT_TIMEOUT,
            None,
        )?;
        if help.code == Some(0) && help.text().contains("--uid") {
            uid = info.uid;
        }
        if uid.is_some() {
            on_line("[MyLogger] 按应用 UID 过滤；包含同 UID 进程，isolated process 不在覆盖范围。");
        } else {
            let ps = shell(serial, &["ps", "-A", "-o", "PID,NAME"], &cancel)?;
            if !ps
                .lines()
                .next()
                .is_some_and(|l| l.contains("PID") && l.contains("NAME"))
            {
                bail!("设备不支持 UID 或 PID 进程查询，无法可靠筛选应用日志");
            }
            pids = Some(Arc::new(Mutex::new(package_pids(&ps, package))));
            on_line(
                "[MyLogger] 按 PID 过滤，每秒刷新主/子进程；重启瞬间及 isolated process 可能缺失。",
            );
        }
    }
    if options.clear_before_capture {
        let clear = run_adb(
            Some(serial),
            &["logcat", "-c"],
            &cancel,
            SHORT_TIMEOUT,
            None,
        )?;
        if clear.code != Some(0) {
            bail!("清空日志失败：{}", clear.text());
        }
    }
    let path = resolve_capture_output_path(options)?;
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)?;
    }
    let mut file_options = OpenOptions::new();
    file_options.write(true);
    if options.output.is_none() && !options.time_named {
        file_options.create(true).truncate(true);
    } else {
        file_options.create_new(true);
    }
    let mut file = file_options
        .open(&path)
        .with_context(|| format!("无法打开日志文件：{}", path.display()))?;
    on_line(&format!("[MyLogger] 日志写入 {}", path.display()));
    let mut command = Command::new("adb");
    command.args(["-s", serial, "logcat", "-v", "threadtime"]);
    if let Some(uid) = uid {
        command.arg(format!("--uid={uid}"));
    }
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let read_pids = pids.clone();
    let reader = std::thread::spawn(move || -> Result<()> {
        for line in BufReader::new(stdout).lines() {
            let line = line?;
            if let Some(pids) = &read_pids {
                let pid = log_pid(&line);
                if !pid.is_some_and(|pid| pids.lock().unwrap().contains(&pid)) {
                    continue;
                }
            }
            writeln!(file, "{line}")?;
            on_line(&line);
        }
        file.flush()?;
        file.sync_all()?;
        Ok(())
    });
    let errors = std::thread::spawn(move || {
        let mut text = String::new();
        // Keep draining even when the retained diagnostic reaches the limit.
        for line in BufReader::new(stderr).lines() {
            let line = line?;
            if text.len() < 65536 {
                text.push_str(&line);
                text.push('\n');
            }
        }
        Ok::<_, std::io::Error>(text)
    });
    let mut refreshed = Instant::now();
    let status = loop {
        if cancel.load(Ordering::Relaxed) || reader.is_finished() {
            let _ = child.kill();
            break child.wait();
        }
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(error);
            }
            Ok(None) => {}
        }
        if refreshed.elapsed() >= Duration::from_secs(1) {
            if let (Some(pids), Some(package)) = (&pids, &options.package) {
                match shell(serial, &["ps", "-A", "-o", "PID,NAME"], &cancel) {
                    Ok(text) => *pids.lock().unwrap() = package_pids(&text, package),
                    Err(error) => {
                        let _ = child.kill();
                        let _ = child.wait();
                        let _ = reader.join();
                        let _ = errors.join();
                        return Err(error).with_context(|| {
                            format!("进程刷新失败，日志任务已停止；部分日志：{}", path.display())
                        });
                    }
                }
            }
            refreshed = Instant::now();
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    reader
        .join()
        .map_err(|_| anyhow::anyhow!("日志读取线程异常"))??;
    let diagnostic = errors
        .join()
        .map_err(|_| anyhow::anyhow!("日志诊断线程异常"))??;
    let status = status?;
    if !cancel.load(Ordering::Relaxed) {
        bail!(
            "logcat 意外结束（{status}）：{diagnostic}；部分日志：{}",
            path.display()
        );
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn filters_process_identity_instead_of_message_text() {
        let pids = package_pids(
            "PID NAME\n12 com.demo.app\n13 com.demo.app:worker\n14 com.demo.application\n15 other",
            "com.demo.app",
        );
        assert_eq!(pids, HashSet::from([12, 13]));
        assert_eq!(
            log_pid("11-10 10:00:00.000 13 13 I Tag: no package name"),
            Some(13)
        );
        assert!(!pids.contains(&log_pid("11-10 10:00:00.000 15 15 I Tag: com.demo.app").unwrap()));
    }
}
