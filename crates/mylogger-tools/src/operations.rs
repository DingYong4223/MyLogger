use crate::adb::{AdbDevice, parse_adb_devices};
use crate::process::{SHORT_TIMEOUT, run_adb, semantic_error, shell_quote};
use anyhow::{Context, Result, bail};
use mylogger_core::actions::{OperationResult, TaskStatus};
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
static NEXT_FILE: AtomicU64 = AtomicU64::new(0);
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone)]
pub enum Operation {
    Devices,
    DeviceInfo,
    Apps,
    AppInfo(String),
    Install {
        apk: PathBuf,
        launch: Option<String>,
    },
    Start(String),
    Stop(String),
    Restart(String),
    Current,
    Schema {
        uri: String,
        package: Option<String>,
    },
    Screenshot {
        output: Option<PathBuf>,
    },
    Push {
        local: PathBuf,
        remote: String,
        overwrite: bool,
    },
    Pull {
        remote: String,
        local: PathBuf,
        overwrite: bool,
    },
    Ports {
        reverse: bool,
    },
    AddPort {
        reverse: bool,
        source: u16,
        destination: u16,
    },
    RemovePort {
        reverse: bool,
        source: u16,
    },
}

impl Operation {
    pub fn title(&self) -> &'static str {
        match self {
            Self::Devices => "设备列表",
            Self::DeviceInfo => "设备信息",
            Self::Apps => "应用列表",
            Self::AppInfo(_) => "应用信息",
            Self::Install { .. } => "安装 APK",
            Self::Start(_) => "启动应用",
            Self::Stop(_) => "停止应用",
            Self::Restart(_) => "重启应用",
            Self::Current => "当前 Activity",
            Self::Schema { .. } => "打开 schema",
            Self::Screenshot { .. } => "设备截图",
            Self::Push { .. } => "上传文件",
            Self::Pull { .. } => "下载文件",
            Self::Ports { .. } => "端口映射",
            Self::AddPort { .. } => "添加端口映射",
            Self::RemovePort { .. } => "删除端口映射",
        }
    }
    pub fn package(&self) -> Option<&str> {
        match self {
            Self::AppInfo(p) | Self::Start(p) | Self::Stop(p) | Self::Restart(p) => Some(p),
            Self::Schema { package, .. } => package.as_deref(),
            Self::Install { launch, .. } => launch.as_deref(),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub model: String,
    pub release: String,
    pub api: String,
    pub abi: String,
    pub screen: String,
    pub density: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppInfo {
    pub package: String,
    pub version: String,
    pub uid: Option<u32>,
    pub debuggable: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortMapping {
    pub device: String,
    pub source: u16,
    pub destination: u16,
    pub reverse: bool,
}
#[derive(Debug, Clone)]
pub enum ResponseData {
    None,
    Devices(Vec<AdbDevice>),
    DeviceInfo(DeviceInfo),
    Apps(Vec<String>),
    AppInfo(AppInfo),
    Ports(Vec<PortMapping>),
}
pub struct OperationResponse {
    pub result: OperationResult,
    pub data: ResponseData,
}

pub fn validate_package(package: &str) -> Result<()> {
    if package.is_empty()
        || !package
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_')
        || !package.contains('.')
    {
        bail!("包名格式无效：{package}");
    }
    Ok(())
}

pub fn unique_output(directory: &Path, prefix: &str, extension: &str) -> Result<PathBuf> {
    std::fs::create_dir_all(directory)?;
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    Ok(directory.join(format!(
        "{prefix}-{}-{nanos}-{}.{extension}",
        std::process::id(),
        NEXT_FILE.fetch_add(1, Ordering::Relaxed)
    )))
}

pub(crate) fn prepare_file(path: &Path, overwrite: bool) -> Result<(PathBuf, File)> {
    if path.exists() && !overwrite {
        bail!("目标已存在，未覆盖：{}", path.display());
    }
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)?;
    }
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let partial = unique_output(parent, "mylogger-partial", "partial")?;
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&partial)?;
    Ok((partial, file))
}

pub(crate) fn finish_file(partial: &Path, final_path: &Path, overwrite: bool) -> Result<()> {
    if overwrite {
        std::fs::rename(partial, final_path)?;
    } else {
        std::fs::hard_link(partial, final_path)
            .with_context(|| format!("未覆盖目标；部分产物保留在 {}", partial.display()))?;
        std::fs::remove_file(partial)?;
    }
    Ok(())
}

struct Client<'a> {
    serial: Option<&'a str>,
    cancel: &'a AtomicBool,
    commands: Vec<String>,
    output: Vec<String>,
    exit: Option<i32>,
}
impl Client<'_> {
    fn adb(&mut self, args: &[&str], timeout: Duration) -> Result<String> {
        self.commands.push(format!(
            "adb {}{}",
            self.serial
                .map(|s| format!("-s {} ", s))
                .unwrap_or_default(),
            args.iter()
                .map(|s| shell_quote(s))
                .collect::<Result<Vec<_>>>()?
                .join(" ")
        ));
        self.exit = None;
        let out = run_adb(self.serial, args, self.cancel, timeout, None)?;
        self.exit = out.code;
        let text = out.text();
        if out.code != Some(0) || semantic_error(&text) {
            self.output.push(text.clone());
            bail!("Android 返回失败：{text}");
        }
        self.output.push(text.clone());
        Ok(text)
    }
    fn shell(&mut self, args: &[&str]) -> Result<String> {
        let command = args
            .iter()
            .map(|s| shell_quote(s))
            .collect::<Result<Vec<_>>>()?
            .join(" ");
        self.adb(&["shell", &command], SHORT_TIMEOUT)
    }
    fn start(&mut self, package: &str) -> Result<()> {
        validate_package(package)?;
        let resolved = self.shell(&[
            "cmd",
            "package",
            "resolve-activity",
            "--brief",
            "--user",
            "0",
            "-a",
            "android.intent.action.MAIN",
            "-c",
            "android.intent.category.LAUNCHER",
            package,
        ])?;
        let component = resolved
            .lines()
            .map(str::trim)
            .find(|s| s.starts_with(&format!("{package}/")) && !s.contains(char::is_whitespace))
            .context("目标应用没有可解析的 Launcher Activity")?;
        self.shell(&["am", "start", "-W", "--user", "0", "-n", component])?;
        Ok(())
    }
}

pub fn execute_operation(
    operation: Operation,
    serial: Option<&str>,
    cancel: &AtomicBool,
) -> OperationResponse {
    let started = Instant::now();
    let title = operation.title().to_string();
    let package = operation.package().map(str::to_owned);
    let mut client = Client {
        serial,
        cancel,
        commands: vec![],
        output: vec![],
        exit: None,
    };
    let mut artifacts = vec![];
    let outcome = (|| -> Result<ResponseData> {
        if !matches!(operation, Operation::Devices) && serial.is_none_or(str::is_empty) {
            bail!("请先选择目标设备");
        }
        match &operation {
            Operation::Devices => Ok(ResponseData::Devices(parse_adb_devices(
                &client.adb(&["devices"], SHORT_TIMEOUT)?,
            ))),
            Operation::DeviceInfo => {
                let mut prop = |name: &str| {
                    client
                        .shell(&["getprop", name])
                        .map(|s| s.trim().to_string())
                };
                let model = prop("ro.product.model")?;
                let release = prop("ro.build.version.release")?;
                let api = prop("ro.build.version.sdk")?;
                let abi = prop("ro.product.cpu.abi")?;
                let screen = client.shell(&["wm", "size"])?;
                let density = client.shell(&["wm", "density"])?;
                client.output.insert(0,format!("型号 {model} · Android {release} · API {api} · ABI {abi}\n{screen}{density}\n原始返回："));
                Ok(ResponseData::DeviceInfo(DeviceInfo {
                    model,
                    release,
                    api,
                    abi,
                    screen,
                    density,
                }))
            }
            Operation::Apps => {
                let text = client.shell(&["pm", "list", "packages", "--user", "0"])?;
                let mut apps = text
                    .lines()
                    .filter_map(|l| l.trim().strip_prefix("package:"))
                    .map(str::to_owned)
                    .collect::<Vec<_>>();
                apps.sort();
                apps.dedup();
                Ok(ResponseData::Apps(apps))
            }
            Operation::AppInfo(package) => {
                validate_package(package)?;
                let text = client.shell(&["dumpsys", "package", package])?;
                let info = parse_app_info(package, &text)?;
                client.output.insert(
                    0,
                    format!(
                        "包名 {} · 版本 {} · UID {:?} · debuggable {}\n原始返回：",
                        info.package, info.version, info.uid, info.debuggable
                    ),
                );
                Ok(ResponseData::AppInfo(info))
            }
            Operation::Install { apk, launch } => {
                if !apk.is_file()
                    || !apk
                        .extension()
                        .is_some_and(|s| s.eq_ignore_ascii_case("apk"))
                {
                    bail!("请选择存在的 APK 文件：{}", apk.display());
                }
                if let Some(package) = launch {
                    validate_package(package)?;
                }
                let apk = apk.canonicalize()?;
                let path = apk.to_str().context("APK 路径不是有效 UTF-8")?;
                let text = client.adb(&["install", "-r", path], Duration::from_secs(300))?;
                if !text.lines().any(|l| l.trim() == "Success") {
                    bail!("安装结果未包含 Success：{text}");
                }
                if let Some(package) = launch {
                    client.start(package)?;
                }
                Ok(ResponseData::None)
            }
            Operation::Start(p) => {
                client.start(p)?;
                Ok(ResponseData::None)
            }
            Operation::Stop(p) | Operation::Restart(p) => {
                validate_package(p)?;
                let info = client.shell(&["dumpsys", "package", p])?;
                parse_app_info(p, &info)?;
                client.shell(&["am", "force-stop", "--user", "0", p])?;
                if matches!(operation, Operation::Restart(_)) {
                    client.start(p)?;
                }
                Ok(ResponseData::None)
            }
            Operation::Current => {
                let text = client.shell(&["dumpsys", "activity", "activities"])?;
                let current = text
                    .lines()
                    .filter(|l| l.contains("mResumedActivity") || l.contains("topResumedActivity"))
                    .collect::<Vec<_>>()
                    .join("\n");
                client.output.insert(
                    0,
                    format!(
                        "当前 Activity：{}\n原始输出：",
                        if current.is_empty() {
                            "未知"
                        } else {
                            &current
                        }
                    ),
                );
                Ok(ResponseData::None)
            }
            Operation::Schema { uri, package } => {
                if uri.trim().is_empty() {
                    bail!("schema不能为空");
                }
                let mut args = vec![
                    "am",
                    "start",
                    "-W",
                    "--user",
                    "0",
                    "-a",
                    "android.intent.action.VIEW",
                    "-d",
                    uri,
                ];
                if let Some(p) = package {
                    validate_package(p)?;
                    args.extend(["-p", p]);
                }
                client.shell(&args)?;
                Ok(ResponseData::None)
            }
            Operation::Screenshot { output } => {
                let path = match output {
                    Some(p) => p.clone(),
                    None => unique_output(Path::new("captures"), "screen", "png")?,
                };
                let (partial, file) = prepare_file(&path, false)?;
                client.commands.push(format!(
                    "adb -s {} exec-out screencap -p",
                    serial.unwrap_or_default()
                ));
                client.exit = None;
                let out = run_adb(
                    serial,
                    &["exec-out", "screencap", "-p"],
                    cancel,
                    SHORT_TIMEOUT,
                    Some(file),
                )
                .with_context(|| format!("部分产物：{}", partial.display()))?;
                client.exit = out.code;
                if out.code != Some(0) {
                    bail!("截图失败：{}；部分产物：{}", out.text(), partial.display());
                }
                validate_png(File::open(&partial)?).with_context(|| {
                    format!(
                        "无效或不完整的 PNG；部分产物：{}；{}",
                        partial.display(),
                        out.stderr
                    )
                })?;
                finish_file(&partial, &path, false)?;
                client
                    .output
                    .push(format!("截图已保存：{}", path.display()));
                artifacts.push(path);
                Ok(ResponseData::None)
            }
            Operation::Push {
                local,
                remote,
                overwrite,
            } => {
                if !local.is_file() {
                    bail!("本地文件不存在：{}", local.display());
                }
                validate_remote(remote)?;
                let probe = format!(
                    "if [ -d {0} ]; then printf DIRECTORY; elif [ -e {0} ]; then printf EXISTS; else printf NEW; fi",
                    shell_quote(remote)?
                );
                let probe_result = client.adb(&["shell", &probe], SHORT_TIMEOUT)?;
                if probe_result.trim() == "DIRECTORY" {
                    bail!("目标是目录，请指定完整文件路径");
                }
                let exists = probe_result.trim() == "EXISTS";
                if exists && !overwrite {
                    bail!("设备目标已存在，未覆盖；请显式确认覆盖：{remote}");
                }
                let local = local.canonicalize()?;
                let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
                let partial = format!(
                    "{remote}.mylogger-{}-{stamp}-{}.partial",
                    std::process::id(),
                    NEXT_FILE.fetch_add(1, Ordering::Relaxed)
                );
                client
                    .adb(
                        &["push", local.to_str().context("无效的本地路径")?, &partial],
                        Duration::from_secs(300),
                    )
                    .with_context(|| format!("设备上的部分产物：{partial}"))?;
                let flag = if *overwrite { "-f" } else { "-n" };
                // mv -n may exit successfully when it skips an existing destination; verify the staging file moved.
                let commit = format!(
                    "test ! -d {dest} && mv {flag} {src} {dest} && test ! -e {src}",
                    dest = shell_quote(remote)?,
                    src = shell_quote(&partial)?
                );
                client
                    .adb(&["shell", &commit], SHORT_TIMEOUT)
                    .with_context(|| format!("未完成替换；设备上的部分产物：{partial}"))?;
                client.output.push(format!("已上传：{remote}"));
                Ok(ResponseData::None)
            }
            Operation::Pull {
                remote,
                local,
                overwrite,
            } => {
                validate_remote(remote)?;
                let probe = format!("test -f {}", shell_quote(remote)?);
                client.adb(&["shell", &probe], SHORT_TIMEOUT)?;
                let (partial, file) = prepare_file(local, *overwrite)?;
                drop(file);
                let result = client.adb(
                    &["pull", remote, partial.to_str().context("无效路径")?],
                    Duration::from_secs(300),
                );
                result.with_context(|| format!("部分产物：{}", partial.display()))?;
                File::open(&partial)?.sync_all()?;
                finish_file(&partial, local, *overwrite)?;
                artifacts.push(local.clone());
                Ok(ResponseData::None)
            }
            Operation::Ports { reverse } => {
                let direction = if *reverse { "reverse" } else { "forward" };
                let text = client.adb(&[direction, "--list"], SHORT_TIMEOUT)?;
                let ports = parse_ports(&text, serial.unwrap_or_default(), *reverse);
                client.output.pop();
                client.output.push(if ports.is_empty() {
                    "当前设备无 TCP 映射（本批仅管理 TCP）".into()
                } else {
                    ports
                        .iter()
                        .map(|p| {
                            format!(
                                "{} · {} tcp:{} → tcp:{}",
                                p.device, direction, p.source, p.destination
                            )
                        })
                        .collect::<Vec<_>>()
                        .join("\n")
                });
                Ok(ResponseData::Ports(ports))
            }
            Operation::AddPort {
                reverse,
                source,
                destination,
            } => {
                if *source == 0 || *destination == 0 {
                    bail!("端口必须为 1—65535");
                }
                let direction = if *reverse { "reverse" } else { "forward" };
                client.adb(
                    &[
                        direction,
                        "--no-rebind",
                        &format!("tcp:{source}"),
                        &format!("tcp:{destination}"),
                    ],
                    SHORT_TIMEOUT,
                )?;
                Ok(ResponseData::None)
            }
            Operation::RemovePort { reverse, source } => {
                if *source == 0 {
                    bail!("端口必须为 1—65535");
                }
                let direction = if *reverse { "reverse" } else { "forward" };
                client.adb(
                    &[direction, "--remove", &format!("tcp:{source}")],
                    SHORT_TIMEOUT,
                )?;
                Ok(ResponseData::None)
            }
        }
    })();
    let (status, data) = match outcome {
        Ok(data) => (TaskStatus::Success, data),
        Err(error) => {
            client.output.push(format!("{error:#}"));
            (
                if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                    TaskStatus::Cancelled
                } else {
                    TaskStatus::Failed
                },
                ResponseData::None,
            )
        }
    };
    OperationResponse {
        result: OperationResult {
            title,
            device: serial.map(str::to_owned),
            package,
            status,
            command: client.commands.join("\n"),
            output: client.output.join("\n"),
            elapsed_ms: started.elapsed().as_millis(),
            exit_code: client.exit,
            artifacts,
        },
        data,
    }
}

fn validate_png(mut file: impl Read) -> Result<()> {
    let mut signature = [0u8; 8];
    file.read_exact(&mut signature)?;
    if signature != *b"\x89PNG\r\n\x1a\n" {
        bail!("PNG 签名无效");
    }
    let mut header = false;
    let mut data = false;
    loop {
        let mut chunk = [0u8; 8];
        file.read_exact(&mut chunk)?;
        let size = u32::from_be_bytes(chunk[..4].try_into().unwrap()) as usize;
        let kind = &chunk[4..];
        if size > 64 * 1024 * 1024 {
            bail!("PNG 数据块过大");
        }
        if !header && (kind != b"IHDR" || size != 13) {
            bail!("PNG 缺少 IHDR");
        }
        let mut bytes = vec![0; size];
        file.read_exact(&mut bytes)?;
        let mut crc = [0u8; 4];
        file.read_exact(&mut crc)?;
        let mut expected = 0xffff_ffffu32;
        for byte in kind.iter().chain(&bytes) {
            expected ^= u32::from(*byte);
            for _ in 0..8 {
                expected = (expected >> 1) ^ if expected & 1 != 0 { 0xedb8_8320 } else { 0 };
            }
        }
        if !expected != u32::from_be_bytes(crc) {
            bail!("PNG CRC 校验失败");
        }
        if kind == b"IHDR" {
            if header || size != 13 || bytes[..4] == [0; 4] || bytes[4..8] == [0; 4] {
                bail!("PNG 尺寸或头部无效");
            }
            header = true;
        }
        if kind == b"IDAT" {
            data = true;
        }
        if kind == b"IEND" {
            if !data || size != 0 {
                bail!("PNG 缺少图像数据");
            }
            return Ok(());
        }
    }
}

fn validate_remote(path: &str) -> Result<()> {
    if !path.starts_with('/') || path.ends_with('/') || path.contains('\0') {
        bail!("请输入设备上的绝对文件路径，不支持目录传输");
    }
    Ok(())
}

pub fn parse_app_info(package: &str, text: &str) -> Result<AppInfo> {
    if !text
        .lines()
        .any(|l| l.contains(&format!("Package [{package}]")))
    {
        bail!("未找到已安装应用：{package}");
    }
    let value = |key: &str| {
        text.lines()
            .find_map(|l| l.trim().strip_prefix(key))
            .and_then(|s| s.split_whitespace().next())
            .map(str::to_owned)
    };
    Ok(AppInfo {
        package: package.into(),
        version: value("versionName=").unwrap_or_else(|| "未知".into()),
        uid: value("userId=")
            .or_else(|| value("appId="))
            .and_then(|s| s.parse().ok()),
        debuggable: text.lines().any(|l| {
            (l.contains("flags=[") || l.contains("pkgFlags=["))
                && l.split_whitespace()
                    .any(|s| s.trim_matches(['[', ']']) == "DEBUGGABLE")
        }),
    })
}

pub fn parse_ports(text: &str, serial: &str, reverse: bool) -> Vec<PortMapping> {
    text.lines()
        .filter_map(|line| {
            let fields = line.split_whitespace().collect::<Vec<_>>();
            let (device, source, destination) = match fields.as_slice() {
                [device, s, d] => (*device, *s, *d),
                [s, d] => (serial, *s, *d),
                _ => return None,
            };
            // Reverse reports a transport label (e.g. UsbFfs); forward reports the serial.
            if !reverse && device != serial {
                return None;
            }
            Some(PortMapping {
                device: serial.into(),
                source: source.strip_prefix("tcp:")?.parse().ok()?,
                destination: destination.strip_prefix("tcp:")?.parse().ok()?,
                reverse,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalid_schema_fails_before_adb() {
        for uri in ["", " \t", "demo://a\0b"] {
            let response = execute_operation(
                Operation::Schema {
                    uri: uri.into(),
                    package: None,
                },
                Some("unused"),
                &AtomicBool::new(false),
            );
            assert_eq!(response.result.status, TaskStatus::Failed);
            assert!(response.result.command.is_empty());
        }
    }
    #[test]
    fn package_metadata_and_port_scope() {
        let app=parse_app_info("com.example.app","Package [com.example.app] (abc):\n  userId=10123\n  versionName=1.2\n  flags=[ HAS_CODE DEBUGGABLE ]").unwrap();
        assert_eq!(app.uid, Some(10123));
        assert!(app.debuggable);
        assert_eq!(app.version, "1.2");
        assert!(parse_app_info("com.missing.app", "Unable to find package").is_err());
        let ports = parse_ports(
            "other tcp:1 tcp:2\nselected tcp:8080 tcp:80",
            "selected",
            false,
        );
        assert_eq!(ports.len(), 1);
        assert_eq!(ports[0].source, 8080);
        assert_eq!(
            parse_ports("UsbFfs tcp:8081 tcp:8081", "selected", true)[0].device,
            "selected"
        );
        assert!(validate_package("com.example.app; id").is_err());
    }
    #[test]
    fn existing_files_are_not_overwritten() {
        let dir = std::env::temp_dir().join(format!(
            "mylogger-file-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let path = dir.join("result.png");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&path, b"original").unwrap();
        assert!(prepare_file(&path, false).is_err());
        let (partial, file) = prepare_file(&path, true).unwrap();
        drop(file);
        std::fs::write(&partial, b"replacement").unwrap();
        assert!(finish_file(&partial, &path, false).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
