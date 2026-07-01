use crate::adb::select_device;
use anyhow::{Context, Result, bail};
use chrono::Local;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;

static INTERRUPTED: OnceLock<Arc<AtomicBool>> = OnceLock::new();

#[derive(Debug, Clone, Default)]
pub struct CaptureOptions {
    pub device: Option<String>,
    pub package: Option<String>,
    pub output: Option<PathBuf>,
    pub time_named: bool,
}

pub fn resolve_capture_output_path(options: &CaptureOptions) -> Result<PathBuf> {
    if let Some(output) = options.output.as_ref() {
        return Ok(output.clone());
    }
    if options.time_named {
        let name = Local::now()
            .format("mylogger-%Y%m%d-%H%M%S.log")
            .to_string();
        return Ok(std::env::current_dir()?.join(name));
    }
    Ok(std::env::current_dir()?.join("123.txt"))
}

pub fn capture_logcat(options: &CaptureOptions) -> Result<PathBuf> {
    let interrupted = install_ctrlc_handler()?;
    interrupted.store(false, Ordering::SeqCst);

    let device = select_device(options.device.as_deref())?;
    let output_path = resolve_capture_output_path(options)?;

    if output_path.exists() && options.output.is_none() && !options.time_named {
        eprintln!(
            "warning: {} already exists and will be overwritten",
            output_path.display()
        );
    }

    let mut command = Command::new("adb");
    command
        .arg("-s")
        .arg(&device.serial)
        .arg("logcat")
        .arg("-v")
        .arg("threadtime")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .with_context(|| format!("failed to start adb logcat for {}", device.serial))?;

    let stdout = child
        .stdout
        .take()
        .context("failed to capture adb logcat stdout")?;
    let stderr = child
        .stderr
        .take()
        .context("failed to capture adb logcat stderr")?;

    println!(
        "开始抓取设备 {} 的日志，写入 {}",
        device.serial,
        output_path.display()
    );
    println!("按 Ctrl+C 结束抓取。");

    let stderr_handle = std::thread::spawn(move || {
        let mut text = String::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if !line.trim().is_empty() {
                text.push_str(&line);
                text.push('\n');
            }
        }
        text
    });

    let output_for_reader = output_path.clone();
    let package = options.package.clone();
    let reader_handle = std::thread::spawn(move || -> Result<()> {
        let mut file = create_output_file(&output_for_reader)?;
        let mut stdout = BufReader::new(stdout);
        let mut line = Vec::new();
        loop {
            line.clear();
            let bytes = stdout
                .read_until(b'\n', &mut line)
                .context("failed to read adb logcat output")?;
            if bytes == 0 {
                break;
            }
            let line = String::from_utf8_lossy(&line);
            let line = line.trim_end_matches(['\r', '\n']);
            if let Some(package) = package.as_deref()
                && !line.contains(package)
            {
                continue;
            }
            writeln!(file, "{line}").context("failed to write captured log")?;
        }
        file.flush().context("failed to flush captured log")?;
        Ok(())
    });

    loop {
        if interrupted.load(Ordering::SeqCst) {
            let _ = child.kill();
            break;
        }
        if child
            .try_wait()
            .context("failed to poll adb logcat")?
            .is_some()
        {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    let _ = child.kill();
    let _ = child.wait();

    match reader_handle.join() {
        Ok(result) => result?,
        Err(_) => bail!("logcat reader thread panicked"),
    }

    let stderr_text = stderr_handle.join().unwrap_or_default();
    if !stderr_text.trim().is_empty() {
        eprintln!("{}", stderr_text.trim());
    }

    if !output_path.exists() {
        bail!("capture finished but output file was not created");
    }

    println!("日志抓取结束：{}", output_path.display());
    Ok(output_path)
}

fn install_ctrlc_handler() -> Result<Arc<AtomicBool>> {
    if let Some(flag) = INTERRUPTED.get() {
        return Ok(flag.clone());
    }

    let flag = Arc::new(AtomicBool::new(false));
    let handler_flag = flag.clone();
    match ctrlc::set_handler(move || {
        handler_flag.store(true, Ordering::SeqCst);
    }) {
        Ok(()) => {}
        Err(err) => {
            if INTERRUPTED.get().is_none() {
                return Err(err).context("failed to install Ctrl+C handler");
            }
        }
    }
    let _ = INTERRUPTED.set(flag.clone());
    Ok(flag)
}

fn create_output_file(path: &PathBuf) -> Result<File> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(path)
        .with_context(|| format!("failed to open {}", path.display()))
}
