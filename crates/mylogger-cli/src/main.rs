use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use mylogger_core::{AnalysisOptions, LogLevel, analyze_file, generate_markdown_report};
use mylogger_tools::{CaptureOptions, StartServiceOptions, capture_logcat, start_backend_service};
use std::path::PathBuf;

#[derive(Debug, Parser)]
#[command(
    name = "MyLogger",
    version,
    about = "Developer-focused log analysis assistant"
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Analyze a local log file.
    Analyze {
        file: PathBuf,
        #[arg(long)]
        keyword: Option<String>,
        #[arg(long)]
        tag: Option<String>,
        #[arg(long)]
        pid: Option<u32>,
        #[arg(long, value_parser = parse_level)]
        level: Option<LogLevel>,
        #[arg(long)]
        json: bool,
        #[arg(long = "report")]
        report: Option<PathBuf>,
    },
    /// Capture Android logcat. Defaults to ./123.txt. Press Ctrl+C to stop.
    Capture {
        #[arg(short = 't', long = "time")]
        time_named: bool,
        #[arg(long)]
        device: Option<String>,
        #[arg(long)]
        package: Option<String>,
        #[arg(short, long)]
        output: Option<PathBuf>,
    },
    /// Start the local backend analysis service.
    #[command(name = "StartService", alias = "start-service", alias = "service")]
    StartService {
        #[arg(long, default_value = "127.0.0.1")]
        host: String,
        #[arg(long, default_value_t = 7878)]
        port: u16,
        #[arg(long = "repo-root")]
        repo_root: Option<PathBuf>,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Some(Command::Analyze {
            file,
            keyword,
            tag,
            pid,
            level,
            json,
            report,
        }) => {
            let summary = analyze_file(
                &file,
                &AnalysisOptions {
                    keyword,
                    min_level: level,
                    tag,
                    pid,
                },
            )?;
            if json {
                println!("{}", serde_json::to_string_pretty(&summary)?);
            } else {
                print_cli_summary(&file, &summary);
            }
            if let Some(report_path) = report {
                std::fs::write(&report_path, generate_markdown_report(&summary))
                    .with_context(|| format!("failed to write {}", report_path.display()))?;
                println!("报告已生成：{}", report_path.display());
            }
        }
        Some(Command::Capture {
            time_named,
            device,
            package,
            output,
        }) => {
            let path = capture_logcat(&CaptureOptions {
                device,
                package,
                output,
                time_named,
            })?;
            println!("{}", path.display());
        }
        Some(Command::StartService {
            host,
            port,
            repo_root,
        }) => {
            let result = start_backend_service(&StartServiceOptions {
                host,
                port,
                repo_root,
            })?;
            if result.already_running {
                println!("服务已在运行：{}", result.endpoint);
            } else if let Some(pid) = result.pid {
                println!("服务已启动：{} (pid {})", result.endpoint, pid);
            } else {
                println!("服务已启动：{}", result.endpoint);
            }
            println!("工作目录：{}", result.repo_root.display());
        }
        None => {
            mylogger_tui::run_repl()?;
        }
    }
    Ok(())
}

fn parse_level(value: &str) -> Result<LogLevel, String> {
    match value.to_ascii_lowercase().as_str() {
        "trace" | "verbose" | "v" => Ok(LogLevel::Trace),
        "debug" | "d" => Ok(LogLevel::Debug),
        "info" | "i" => Ok(LogLevel::Info),
        "warn" | "warning" | "w" => Ok(LogLevel::Warn),
        "error" | "e" => Ok(LogLevel::Error),
        "fatal" | "f" => Ok(LogLevel::Fatal),
        other => Err(format!("unknown level `{other}`")),
    }
}

fn print_cli_summary(path: &PathBuf, summary: &mylogger_core::AnalysisSummary) {
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
