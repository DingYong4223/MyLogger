#![cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{
    fs,
    path::PathBuf,
    process::{Command, Output, Stdio},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
struct Fake {
    root: PathBuf,
}
impl Fake {
    fn new() -> Self {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../tmp")
            .join(format!(
                "mylogger-adb-test-{}-{}-{}",
                std::thread::current().name().unwrap(),
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
        fs::create_dir_all(&root).unwrap();
        let adb = root.join("adb");
        fs::write(&adb, include_str!("fixtures/adb.py")).unwrap();
        fs::set_permissions(&adb, fs::Permissions::from_mode(0o755)).unwrap();
        Self { root }
    }
    fn command(&self, mode: &str, args: &[&str]) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_MyLogger"));
        command
            .args(args)
            .current_dir(&self.root)
            .env(
                "PATH",
                format!("{}:{}", self.root.display(), std::env::var("PATH").unwrap()),
            )
            .env("MYLOGGER_FAKE_ROOT", &self.root)
            .env("MYLOGGER_FAKE_MODE", mode)
            .env("XDG_CONFIG_HOME", self.root.join("config"))
            .stdin(Stdio::null());
        command
    }
    fn run(&self, mode: &str, args: &[&str]) -> Output {
        self.command(mode, args).output().unwrap()
    }
    fn ok(&self, mode: &str, args: &[&str]) -> String {
        let out = self.run(mode, args);
        assert!(
            out.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8(out.stdout).unwrap()
    }
    fn calls(&self) -> Vec<Vec<String>> {
        fs::read_to_string(self.root.join("calls.jsonl"))
            .unwrap()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }
}
impl Drop for Fake {
    fn drop(&mut self) {
        if std::thread::panicking() {
            eprintln!("fixture retained at {}", self.root.display());
        } else {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
}
#[test]
fn device_scope_schema_and_failures() {
    let fake = Fake::new();
    assert!(!fake.run("two", &["schema", "demo://open"]).status.success());
    assert!(!fake.run("none", &["current"]).status.success());
    assert!(!fake.run("devices-error", &["devices"]).status.success());
    assert!(
        !fake
            .run("", &["current", "--device", "locked"])
            .status
            .success()
    );
    let uri = "demo://中文 path?a=1&quote='\";$(echo injected)`id`";
    fake.ok(
        "two",
        &[
            "schema",
            uri,
            "--device",
            "second",
            "--package",
            "com.demo.app",
        ],
    );
    let calls = fake.calls();
    let shell = calls
        .iter()
        .find(|c| c.get(2).is_some_and(|s| s == "shell"))
        .unwrap();
    assert_eq!(shell[1], "second");
    // Have a real POSIX shell recover the URI argument; no command interpolation may execute.
    let script = format!("am() {{ printf '%s' \"$8\"; }}; {}", shell[3]);
    let result = Command::new("sh").args(["-c", &script]).output().unwrap();
    assert_eq!(String::from_utf8(result.stdout).unwrap(), uri);
    assert!(
        !fake
            .run("semantic", &["schema", "demo://open"])
            .status
            .success()
    );
    let apk = fake.root.join("app with space.apk");
    fs::write(&apk, b"apk").unwrap();
    let out = fake.run("semantic", &["install", apk.to_str().unwrap(), "--json"]);
    assert!(!out.status.success());
    let result: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(result["status"], "Failed");
    assert_eq!(result["exit_code"], 0);
    let out = fake.run("exit-error", &["install", apk.to_str().unwrap(), "--json"]);
    assert!(!out.status.success());
    let result: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(result["exit_code"], 7);
    fake.ok(
        "",
        &["install", apk.to_str().unwrap(), "--launch", "com.demo.app"],
    );
    fake.ok("", &["restart", "com.demo.app"]);
    assert!(
        fake.ok("", &["current"])
            .contains("com.demo.app/.MainActivity")
    );
    assert!(fake.ok("", &["device-info"]).contains("Fake Pixel"));
    assert!(fake.ok("", &["apps"]).contains("com.demo.app"));
}
#[test]
fn binary_files_ports_and_explicit_favorites() {
    let fake = Fake::new();
    let png = fake.root.join("screen shot.png");
    fake.ok("", &["screenshot", "--output", png.to_str().unwrap()]);
    let bytes = fs::read(&png).unwrap();
    assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
    assert!(
        !fake
            .run("", &["screenshot", "--output", png.to_str().unwrap()])
            .status
            .success()
    );
    assert_eq!(fs::read(&png).unwrap(), bytes);
    let bad = fake.root.join("bad.png");
    assert!(
        !fake
            .run(
                "bad-png",
                &["screenshot", "--output", bad.to_str().unwrap()]
            )
            .status
            .success()
    );
    assert!(!bad.exists());
    assert!(
        !fake
            .run(
                "bad-crc",
                &["screenshot", "--output", bad.to_str().unwrap()]
            )
            .status
            .success()
    );
    assert!(!bad.exists());
    let local = fake.root.join("payload 'quoted'.bin");
    fs::write(&local, b"original binary\0\xff").unwrap();
    let remote = "/sdcard/path 'quoted'.bin";
    fake.ok("", &["push", local.to_str().unwrap(), remote]);
    assert!(
        !fake
            .run("", &["push", local.to_str().unwrap(), remote])
            .status
            .success()
    );
    fs::write(&local, b"replacement").unwrap();
    fake.ok(
        "",
        &["push", local.to_str().unwrap(), remote, "--overwrite"],
    );
    let pulled = fake.root.join("pulled.bin");
    fake.ok("", &["pull", remote, pulled.to_str().unwrap()]);
    assert_eq!(fs::read(&pulled).unwrap(), b"replacement");
    assert!(
        !fake
            .run("", &["pull", remote, pulled.to_str().unwrap()])
            .status
            .success()
    );
    for direction in ["reverse", "forward"] {
        fake.ok(
            "two",
            &[direction, "--device", "second", "add", "8081", "8082"],
        );
        assert!(
            !fake
                .run(
                    "two",
                    &[direction, "--device", "second", "add", "8081", "9000"]
                )
                .status
                .success()
        );
        let list = fake.ok("two", &[direction, "--device", "second", "list"]);
        assert!(list.contains("8081"));
        assert!(!list.contains("7777"));
        fake.ok("two", &[direction, "--device", "second", "remove", "8081"]);
        assert!(
            !fake
                .ok("two", &[direction, "--device", "second", "list"])
                .contains("8081")
        );
    }
    fake.ok(
        "",
        &[
            "favorites",
            "save",
            "开发首页",
            "demo://中文?a=1",
            "--package",
            "com.demo.app",
        ],
    );
    assert!(fake.ok("", &["favorites", "list"]).contains("开发首页"));
}
#[test]
fn log_capture_filters_main_subprocess_and_pid_restart_then_stops_cleanly() {
    for mode in ["pid", "uid"] {
        let fake = Fake::new();
        let path = fake.root.join("app.log");
        let mut child = fake
            .command(
                mode,
                &[
                    "capture",
                    "--package",
                    "com.demo.app",
                    "--output",
                    path.to_str().unwrap(),
                    "--no-clear",
                ],
            )
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while !fake.root.join("logcat.pid").exists() {
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(25));
        }
        std::thread::sleep(Duration::from_millis(2400));
        assert!(
            Command::new("kill")
                .args(["-INT", &child.id().to_string()])
                .status()
                .unwrap()
                .success()
        );
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let status = loop {
            if let Some(status) = child.try_wait().unwrap() {
                break status;
            }
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(25));
        };
        assert!(status.success(), "capture failed: {}", {
            let mut s = String::new();
            std::io::Read::read_to_string(child.stderr.as_mut().unwrap(), &mut s).unwrap();
            s
        });
        let log = fs::read_to_string(&path).unwrap();
        assert!(log.contains("selected-12"));
        assert!(log.contains("selected-22"));
        assert!(!log.contains("unrelated"));
        if mode == "pid" {
            assert!(log.contains("subprocess"));
        }
        let pid = fs::read_to_string(fake.root.join("logcat.pid")).unwrap();
        assert!(
            !Command::new("kill")
                .args(["-0", &pid])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .unwrap()
                .success()
        );
        let old = fs::read(&path).unwrap();
        assert!(
            !fake
                .run(
                    mode,
                    &["capture", "--output", path.to_str().unwrap(), "--no-clear"]
                )
                .status
                .success()
        );
        assert_eq!(fs::read(&path).unwrap(), old);
    }
}

#[test]
fn unexpected_logcat_exit_is_a_failure_and_preserves_partial_file() {
    let fake = Fake::new();
    let path = fake.root.join("partial.log");
    let result = fake.run(
        "log-error",
        &["capture", "--output", path.to_str().unwrap(), "--no-clear"],
    );
    assert!(!result.status.success());
    assert!(path.exists());
    assert!(String::from_utf8_lossy(&result.stderr).contains("device offline"));
}

#[test]
fn default_capture_reuses_current_directory_123_txt() {
    let fake = Fake::new();
    let path = fake.root.join("123.txt");
    for old in ["old capture", "second capture"] {
        fs::write(&path, old).unwrap();
        let _ = fs::remove_file(fake.root.join("logcat.pid"));
        let mut child = fake
            .command("uid", &["capture", "--no-clear"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while !fake.root.join("logcat.pid").exists() {
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(25));
        }
        std::thread::sleep(Duration::from_millis(100));
        assert!(
            Command::new("kill")
                .args(["-INT", &child.id().to_string()])
                .status()
                .unwrap()
                .success()
        );
        let status = loop {
            if let Some(status) = child.try_wait().unwrap() {
                break status;
            }
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(25));
        };
        assert!(status.success());
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains("selected-12"));
        assert!(!text.contains(old));
    }
    assert!(!fake.root.join("captures").exists());
    // Explicit time naming remains opt-in and uses the working directory.
    let result = fake.run("log-error", &["capture", "-t", "--no-clear"]);
    assert!(!result.status.success());
    assert!(fs::read_dir(&fake.root).unwrap().any(|e| {
        let name = e.unwrap().file_name().to_string_lossy().into_owned();
        name.starts_with("mylogger-") && name.ends_with(".log")
    }));
}
