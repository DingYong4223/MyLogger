use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::io::{self, Write};
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum DeviceState {
    Device,
    Offline,
    Unauthorized,
    Other(String),
}

impl DeviceState {
    pub fn is_available(&self) -> bool {
        matches!(self, Self::Device)
    }
}

impl std::fmt::Display for DeviceState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Device => f.write_str("device"),
            Self::Offline => f.write_str("offline"),
            Self::Unauthorized => f.write_str("unauthorized"),
            Self::Other(value) => f.write_str(value),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdbDevice {
    pub serial: String,
    pub state: DeviceState,
}

pub fn list_adb_devices() -> Result<Vec<AdbDevice>> {
    let output = Command::new("adb")
        .arg("devices")
        .output()
        .context("failed to execute adb devices; please ensure adb is installed and in PATH")?;

    if !output.status.success() {
        bail!(
            "adb devices failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }

    Ok(parse_adb_devices(&String::from_utf8_lossy(&output.stdout)))
}

pub fn parse_adb_devices(output: &str) -> Vec<AdbDevice> {
    output
        .lines()
        .skip(1)
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            let mut parts = line.split_whitespace();
            let serial = parts.next()?.to_string();
            let state = match parts.next().unwrap_or_default() {
                "device" => DeviceState::Device,
                "offline" => DeviceState::Offline,
                "unauthorized" => DeviceState::Unauthorized,
                other => DeviceState::Other(other.to_string()),
            };
            Some(AdbDevice { serial, state })
        })
        .collect()
}

pub fn select_device(requested: Option<&str>) -> Result<AdbDevice> {
    let devices = list_adb_devices()?;
    let available: Vec<AdbDevice> = devices
        .into_iter()
        .filter(|device| device.state.is_available())
        .collect();

    if let Some(serial) = requested {
        return available
            .into_iter()
            .find(|device| device.serial == serial)
            .with_context(|| format!("requested adb device `{serial}` is not available"));
    }

    match available.len() {
        0 => bail!("no available Android device; connect a device or start an emulator"),
        1 => Ok(available[0].clone()),
        _ => prompt_device_selection(&available),
    }
}

fn prompt_device_selection(devices: &[AdbDevice]) -> Result<AdbDevice> {
    println!("检测到多个 Android 设备，请选择要抓取日志的设备：\n");
    for (index, device) in devices.iter().enumerate() {
        println!("  {}. {}\t{}", index + 1, device.serial, device.state);
    }
    print!("\n输入序号或设备 serial：");
    io::stdout().flush().ok();

    let mut input = String::new();
    io::stdin()
        .read_line(&mut input)
        .context("failed to read device selection")?;
    let input = input.trim();
    if let Ok(index) = input.parse::<usize>()
        && (1..=devices.len()).contains(&index)
    {
        return Ok(devices[index - 1].clone());
    }

    devices
        .iter()
        .find(|device| device.serial == input)
        .cloned()
        .with_context(|| format!("invalid device selection `{input}`"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_adb_devices() {
        let devices = parse_adb_devices(
            "List of devices attached\nemulator-5554\tdevice\nR5CT123ABC\tunauthorized\n",
        );
        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].serial, "emulator-5554");
        assert_eq!(devices[0].state, DeviceState::Device);
        assert_eq!(devices[1].state, DeviceState::Unauthorized);
    }
}
