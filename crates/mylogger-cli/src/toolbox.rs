use anyhow::{Context, Result, bail};
use clap::{Args, Subcommand};
use mylogger_core::actions::TaskStatus;
use mylogger_tools::{
    favorites::{SchemaFavorite, favorites_path, load_favorites, save_favorite},
    operations::{Operation, ResponseData, execute_operation},
};
use std::{
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
};

#[derive(Debug, Args)]
pub struct Target {
    #[arg(long)]
    device: Option<String>,
    #[arg(long)]
    json: bool,
}

#[derive(Debug, Subcommand)]
pub enum Commands {
    /// List devices (including offline/unauthorized).
    Devices {
        #[arg(long)]
        json: bool,
    },
    DeviceInfo {
        #[command(flatten)]
        target: Target,
    },
    Apps {
        #[command(flatten)]
        target: Target,
    },
    AppInfo {
        package: String,
        #[command(flatten)]
        target: Target,
    },
    Install {
        apk: PathBuf,
        #[arg(long)]
        launch: Option<String>,
        #[command(flatten)]
        target: Target,
    },
    Start {
        package: String,
        #[command(flatten)]
        target: Target,
    },
    Stop {
        package: String,
        #[command(flatten)]
        target: Target,
    },
    Restart {
        package: String,
        #[command(flatten)]
        target: Target,
    },
    Current {
        #[command(flatten)]
        target: Target,
    },
    #[command(alias = "打开schema")]
    Schema {
        uri: String,
        #[arg(long)]
        package: Option<String>,
        #[command(flatten)]
        target: Target,
    },
    Screenshot {
        #[arg(short, long)]
        output: Option<PathBuf>,
        #[command(flatten)]
        target: Target,
    },
    Push {
        local: PathBuf,
        remote: String,
        #[arg(long)]
        overwrite: bool,
        #[command(flatten)]
        target: Target,
    },
    Pull {
        remote: String,
        local: PathBuf,
        #[arg(long)]
        overwrite: bool,
        #[command(flatten)]
        target: Target,
    },
    Reverse {
        #[command(subcommand)]
        command: PortCommand,
        #[command(flatten)]
        target: Target,
    },
    Forward {
        #[command(subcommand)]
        command: PortCommand,
        #[command(flatten)]
        target: Target,
    },
    Favorites {
        #[command(subcommand)]
        command: FavoriteCommand,
    },
}
#[derive(Debug, Subcommand)]
pub enum PortCommand {
    List,
    Add { source: u16, destination: u16 },
    Remove { source: u16 },
}
#[derive(Debug, Subcommand)]
pub enum FavoriteCommand {
    List,
    Save {
        name: String,
        uri: String,
        #[arg(long)]
        package: Option<String>,
    },
}

pub fn resolve_device(requested: Option<&str>, cancel: &AtomicBool) -> Result<String> {
    let response = execute_operation(Operation::Devices, None, cancel);
    if response.result.status != TaskStatus::Success {
        bail!("{}", response.result.output);
    }
    let ResponseData::Devices(devices) = response.data else {
        unreachable!()
    };
    let available = devices
        .into_iter()
        .filter(|d| d.state.is_available())
        .collect::<Vec<_>>();
    if let Some(serial) = requested {
        return available
            .iter()
            .find(|d| d.serial == serial)
            .map(|d| d.serial.clone())
            .with_context(|| format!("设备不可用：{serial}"));
    }
    match available.as_slice() {
        [device] => Ok(device.serial.clone()),
        [] => bail!("未检测到可用设备"),
        _ => bail!("检测到多个设备，请通过 --device SERIAL 指定目标"),
    }
}

pub fn run(command: Commands) -> Result<()> {
    use Commands::*;
    let (operation, target) = match command {
        Devices { json } => (Operation::Devices, Target { device: None, json }),
        DeviceInfo { target } => (Operation::DeviceInfo, target),
        Apps { target } => (Operation::Apps, target),
        AppInfo { package, target } => (Operation::AppInfo(package), target),
        Install {
            apk,
            launch,
            target,
        } => (Operation::Install { apk, launch }, target),
        Start { package, target } => (Operation::Start(package), target),
        Stop { package, target } => (Operation::Stop(package), target),
        Restart { package, target } => (Operation::Restart(package), target),
        Current { target } => (Operation::Current, target),
        Schema {
            uri,
            package,
            target,
        } => (Operation::Schema { uri, package }, target),
        Screenshot { output, target } => (Operation::Screenshot { output }, target),
        Push {
            local,
            remote,
            overwrite,
            target,
        } => (
            Operation::Push {
                local,
                remote,
                overwrite,
            },
            target,
        ),
        Pull {
            remote,
            local,
            overwrite,
            target,
        } => (
            Operation::Pull {
                remote,
                local,
                overwrite,
            },
            target,
        ),
        Reverse { command, target } => (port_operation(command, true), target),
        Forward { command, target } => (port_operation(command, false), target),
        Favorites { command } => {
            let path = favorites_path()?;
            match command {
                FavoriteCommand::List => {
                    println!("{}", serde_json::to_string_pretty(&load_favorites(&path)?)?)
                }
                FavoriteCommand::Save { name, uri, package } => {
                    if let Some(package) = &package {
                        mylogger_tools::operations::validate_package(package)?;
                    }
                    save_favorite(&path, SchemaFavorite { name, uri, package })?;
                    println!("收藏已保存：{}", path.display());
                }
            }
            return Ok(());
        }
    };
    let cancel = mylogger_tools::capture::interrupt_flag()?;
    cancel.store(false, Ordering::Relaxed);
    let serial = if matches!(operation, Operation::Devices) {
        None
    } else {
        Some(resolve_device(target.device.as_deref(), &cancel)?)
    };
    let response = execute_operation(operation, serial.as_deref(), &cancel);
    if target.json {
        println!("{}", serde_json::to_string_pretty(&response.result)?);
    } else {
        println!(
            "{} · {} · {} ms",
            response.result.title,
            response.result.status.label(),
            response.result.elapsed_ms
        );
        match response.data {
            ResponseData::Devices(devices) => {
                for d in devices {
                    println!("{}\t{}", d.serial, d.state);
                }
            }
            ResponseData::Apps(apps) => {
                for app in apps {
                    println!("{app}");
                }
            }
            ResponseData::Ports(ports) => {
                for port in ports {
                    println!(
                        "{} tcp:{} → tcp:{}",
                        port.device, port.source, port.destination
                    );
                }
            }
            _ => println!("{}", response.result.output),
        }
        for path in &response.result.artifacts {
            println!("产物：{}", path.display());
        }
    }
    if response.result.status != TaskStatus::Success {
        bail!("{}", response.result.output);
    }
    Ok(())
}
fn port_operation(command: PortCommand, reverse: bool) -> Operation {
    match command {
        PortCommand::List => Operation::Ports { reverse },
        PortCommand::Add {
            source,
            destination,
        } => Operation::AddPort {
            reverse,
            source,
            destination,
        },
        PortCommand::Remove { source } => Operation::RemovePort { reverse, source },
    }
}
