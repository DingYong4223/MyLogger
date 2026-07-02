use anyhow::{Context, Result, bail};
use std::env;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct StartServiceOptions {
    pub host: String,
    pub port: u16,
    pub repo_root: Option<PathBuf>,
}

impl Default for StartServiceOptions {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 7878,
            repo_root: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct StartServiceResult {
    pub endpoint: String,
    pub repo_root: PathBuf,
    pub pid: Option<u32>,
    pub already_running: bool,
}

pub fn start_backend_service(options: &StartServiceOptions) -> Result<StartServiceResult> {
    let endpoint = format!("http://{}:{}/analyze", options.host, options.port);
    if is_tcp_port_open(&options.host, options.port) {
        return Ok(StartServiceResult {
            endpoint,
            repo_root: resolve_repo_root(options.repo_root.as_ref())?,
            pid: None,
            already_running: true,
        });
    }

    let repo_root = resolve_repo_root(options.repo_root.as_ref())?;
    let script = repo_root.join("backend").join("analysis_server.py");
    if !script.is_file() {
        bail!("backend service script not found: {}", script.display());
    }

    let child = Command::new("python3")
        .arg(&script)
        .arg("--host")
        .arg(&options.host)
        .arg("--port")
        .arg(options.port.to_string())
        .current_dir(&repo_root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .with_context(|| format!("failed to start backend service: {}", script.display()))?;

    Ok(StartServiceResult {
        endpoint,
        repo_root,
        pid: Some(child.id()),
        already_running: false,
    })
}

fn is_tcp_port_open(host: &str, port: u16) -> bool {
    let Ok(addrs) = (host, port).to_socket_addrs() else {
        return false;
    };
    addrs
        .into_iter()
        .any(|addr| TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok())
}

fn resolve_repo_root(explicit_root: Option<&PathBuf>) -> Result<PathBuf> {
    if let Some(root) = explicit_root {
        return Ok(root.clone());
    }
    if let Ok(root) = env::var("MYLOGGER_REPO_ROOT") {
        return Ok(PathBuf::from(root));
    }

    let current_dir = env::current_dir().context("failed to resolve current directory")?;
    for dir in current_dir.ancestors() {
        if dir.join("backend").join("analysis_server.py").is_file() {
            return Ok(dir.to_path_buf());
        }
    }

    bail!("failed to find MyLogger repository root; run from the repo or set MYLOGGER_REPO_ROOT")
}
