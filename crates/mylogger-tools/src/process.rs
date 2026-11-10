use anyhow::{Context, Result, bail};
use std::fs::File;
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

pub const SHORT_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_TEXT: usize = 8 * 1024 * 1024;

pub fn shell_quote(value: &str) -> Result<String> {
    if value.contains('\0') {
        bail!("参数不能包含 NUL 字符");
    }
    Ok(format!("'{}'", value.replace('\'', "'\\''")))
}

#[derive(Debug)]
pub struct CommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub code: Option<i32>,
    pub command: String,
}

impl CommandOutput {
    pub fn text(&self) -> String {
        [self.stdout.trim(), self.stderr.trim()]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n")
    }
}

fn drain(mut reader: impl Read, mut file: Option<File>) -> Result<Vec<u8>> {
    let mut text = Vec::new();
    let mut buffer = [0u8; 16384];
    let mut truncated = false;
    let mut write_error = None;
    loop {
        let n = reader.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        if let Some(file) = file.as_mut() {
            if write_error.is_none()
                && let Err(error) = file.write_all(&buffer[..n])
            {
                write_error = Some(error);
            }
        } else {
            let keep = n.min(MAX_TEXT.saturating_sub(text.len()));
            text.extend_from_slice(&buffer[..keep]);
            truncated |= keep < n;
        }
    }
    if let Some(error) = write_error {
        return Err(error.into());
    }
    if let Some(file) = file.as_mut() {
        file.sync_all()?;
    }
    if truncated {
        bail!("命令输出超过 8 MiB，请使用更小的查询范围");
    }
    Ok(text)
}

pub fn run_adb(
    serial: Option<&str>,
    args: &[&str],
    cancel: &AtomicBool,
    timeout: Duration,
    file: Option<File>,
) -> Result<CommandOutput> {
    let mut command = Command::new("adb");
    if let Some(serial) = serial {
        command.args(["-s", serial]);
    }
    command.args(args);
    run_process(command, cancel, timeout, file)
}

fn run_process(
    mut command: Command,
    cancel: &AtomicBool,
    timeout: Duration,
    file: Option<File>,
) -> Result<CommandOutput> {
    let label = std::iter::once(command.get_program())
        .chain(command.get_args())
        .map(|a| shell_quote(&a.to_string_lossy()))
        .collect::<Result<Vec<_>>>()?
        .join(" ");
    if cancel.load(Ordering::Relaxed) {
        bail!("操作已取消");
    }
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("无法执行 adb，请确认 platform-tools 已安装并加入 PATH")?;
    let stdout = child.stdout.take().context("缺少 stdout")?;
    let stderr = child.stderr.take().context("缺少 stderr")?;
    let out = std::thread::spawn(move || drain(stdout, file));
    let err = std::thread::spawn(move || drain(stderr, None));
    let started = Instant::now();
    let mut interrupted = None;
    let status = loop {
        if cancel.load(Ordering::Relaxed) {
            interrupted = Some("操作已取消");
        } else if started.elapsed() >= timeout {
            interrupted = Some("命令超时");
        }
        if interrupted.is_some() {
            let _ = child.kill();
            break child.wait();
        }
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(e);
            }
        }
    };
    let stdout = out
        .join()
        .map_err(|_| anyhow::anyhow!("stdout 读取线程异常"))??;
    let stderr = err
        .join()
        .map_err(|_| anyhow::anyhow!("stderr 读取线程异常"))??;
    if let Some(reason) = interrupted {
        bail!("{reason}：{label}");
    }
    let status = status?;
    let result = CommandOutput {
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        code: status.code(),
        command: label,
    };
    Ok(result)
}

pub fn semantic_error(text: &str) -> bool {
    text.lines().any(|line| {
        let line = line.trim();
        line.starts_with("Error")
            || line.starts_with("Failure")
            || line.starts_with("Exception")
            || line.starts_with("java.lang.")
            || line
                .strip_prefix("Status:")
                .is_some_and(|s| s.trim() != "ok")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[test]
    fn shell_argument_is_literal_and_rejects_nul() {
        let value = "demo://中文 path?a=1&b='\";$(echo injected)`echo injected`\nnext";
        let output = Command::new("sh")
            .args([
                "-c",
                &format!("printf '%s' {}", shell_quote(value).unwrap()),
            ])
            .output()
            .unwrap();
        assert!(output.status.success());
        assert_eq!(String::from_utf8(output.stdout).unwrap(), value);
        assert!(shell_quote("a\0b").is_err());
    }
    #[cfg(unix)]
    #[test]
    fn cancellation_stops_running_process() {
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let flag = cancel.clone();
        let signal = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(60));
            flag.store(true, Ordering::Relaxed);
        });
        let mut cmd = Command::new("sh");
        cmd.args(["-c", "while :; do :; done"]);
        let started = Instant::now();
        let result = run_process(cmd, &cancel, Duration::from_secs(10), None);
        signal.join().unwrap();
        assert!(result.unwrap_err().to_string().contains("取消"));
        assert!(started.elapsed() < Duration::from_secs(2));
    }
    #[test]
    fn detects_android_semantic_failures() {
        for s in [
            "Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]",
            "Error: cannot resolve",
            "Status: timeout",
        ] {
            assert!(semantic_error(s));
        }
        assert!(!semantic_error(
            "Success\nStatus: ok\nWarning: task brought forward"
        ));
    }
    #[cfg(unix)]
    #[test]
    fn drains_both_pipes_and_enforces_timeout() {
        let mut cmd = Command::new("sh");
        cmd.args([
            "-c",
            "i=0; while [ $i -lt 12000 ]; do printf stdout; printf stderr >&2; i=$((i+1)); done",
        ]);
        let out = run_process(cmd, &AtomicBool::new(false), Duration::from_secs(2), None).unwrap();
        assert_eq!(out.stdout, "stdout".repeat(12000));
        assert_eq!(out.stderr, "stderr".repeat(12000));
        let mut cmd = Command::new("sh");
        cmd.args(["-c", "while :; do :; done"]);
        let started = Instant::now();
        assert!(
            run_process(
                cmd,
                &AtomicBool::new(false),
                Duration::from_millis(50),
                None
            )
            .unwrap_err()
            .to_string()
            .contains("超时")
        );
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}
