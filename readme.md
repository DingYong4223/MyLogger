# MyLogger

MyLogger 是一个面向开发者的日志抓取、浏览和分析工具集。当前项目包含 Rust CLI/TUI、Chrome 本地日志查看器、Android Studio 断点导出插件，以及一个用于联调的本地分析服务。

## 能做什么

- 抓取 Android `logcat`，支持指定设备、包名、输出文件和按时间命名。
- 分析本地日志文件，输出行数、级别统计、Top Tag、问题摘要、JSON 或 Markdown 报告。
- 通过 TUI 交互式执行 `/capture`、`/analyze` 等常用工作流。
- 在 Chrome 扩展中打开、过滤、搜索和导出日志，并把日志路径与断点数据发送给本地分析服务。
- 通过 Android Studio 插件导出当前工程真实断点信息，供后续分析使用。

## 项目结构

```text
crates/mylogger-cli/    CLI 入口和命令分发，二进制名为 MyLogger
crates/mylogger-core/   日志解析、过滤、路由、工作流、分析摘要和报告生成
crates/mylogger-tools/  adb 抓取、本地服务启动等外部工具集成
crates/mylogger-tui/    交互式终端界面
crates/mylogger-llm/    LLM 集成边界
chrome/                 Chrome 本地日志查看器扩展
asplugin/               Android Studio 断点导出插件
backend/                Chrome 扩展联调用的本地分析服务
docs/                   产品、架构、发布和使用文档
skills/                 本项目的本地 agent skills
```

## 环境要求

基础开发：

- Rust 1.95+
- Cargo

按功能可选：

- Android 日志抓取：`adb`，并确保在 `PATH` 中。
- TUI 文件选择：`yazi`，用于 `/analyze` 交互式选文件。
- TUI 打开分析报告：`nvim`，用于 `/analyze --open`。
- Chrome 扩展构建：Node.js 和 npm。
- Android Studio 插件构建：Gradle / Android Studio 插件开发环境。

检查常用环境：

```bash
rustc --version
cargo --version
adb version
yazi --version
nvim --version
```

## 快速开始

构建整个 Rust workspace：

```bash
cargo build --workspace
```

启动交互式 TUI：

```bash
cargo run -p mylogger
```

查看 CLI 帮助：

```bash
cargo run -p mylogger -- --help
```

运行测试和格式化：

```bash
cargo test --workspace
cargo fmt --all
```

Release 构建：

```bash
cargo build --workspace --release
```

生成的主程序路径：

```bash
target/debug/MyLogger
target/release/MyLogger
```

## CLI 用法

MyLogger 无子命令时进入 TUI；带子命令时执行一次性任务。

### 分析日志

分析本地日志：

```bash
cargo run -p mylogger -- analyze app.log
```

按关键字、Tag、PID 或最低级别过滤：

```bash
cargo run -p mylogger -- analyze app.log --keyword Exception
cargo run -p mylogger -- analyze app.log --tag ActivityManager
cargo run -p mylogger -- analyze app.log --pid 12345
cargo run -p mylogger -- analyze app.log --level error
```

输出 JSON 或生成 Markdown 报告：

```bash
cargo run -p mylogger -- analyze app.log --json
cargo run -p mylogger -- analyze app.log --report mylogger-analysis.md
```

`--level` 支持 `trace`/`verbose`/`v`、`debug`/`d`、`info`/`i`、`warn`/`warning`/`w`、`error`/`e`、`fatal`/`f`。

### 抓取 Android 日志

默认抓取到当前目录 `123.txt`，按 `Ctrl+C` 结束：

```bash
cargo run -p mylogger -- capture
```

按当前时间命名输出文件：

```bash
cargo run -p mylogger -- capture -t
```

指定设备、包名或输出文件：

```bash
cargo run -p mylogger -- capture --device emulator-5554
cargo run -p mylogger -- capture --package com.example.app
cargo run -p mylogger -- capture --output app.log
cargo run -p mylogger -- capture --device emulator-5554 --package com.example.app --output app.log
```

抓取流程会先检测 `adb devices`。没有可用设备时会提示连接设备；单设备时直接抓取；多设备场景在 TUI 中会显示设备选择列表。

### 启动本地分析服务

用于 Chrome 扩展把日志路径和断点 JSON 提交到本地后端：

```bash
cargo run -p mylogger -- StartService
```

可指定监听地址、端口和仓库根目录：

```bash
cargo run -p mylogger -- StartService --host 127.0.0.1 --port 7878 --repo-root .
```

命令别名也可用：

```bash
cargo run -p mylogger -- start-service
cargo run -p mylogger -- service
```

## TUI 用法

启动：

```bash
cargo run -p mylogger
```

常用命令：

```text
/                 打开命令菜单
/capture          抓取日志，默认写入 ./123.txt，Ctrl+C 结束
/capture -t       抓取日志，写入 mylogger-YYYYMMDD-HHMMSS.log
/analyze          打开 yazi 选择日志文件并分析
/analyze <file>   直接分析指定日志文件
/analyze --open   分析日志，生成 mylogger-analysis.md，并用 Neovim 打开
/help             查看 TUI 命令
```

命令菜单中可用上下键移动，按 Enter 将选中的命令填入输入框，再按 Enter 执行。日志抓取和外部编辑器会临时切回普通终端环境，完成后自动回到 TUI。

## Chrome 扩展

Chrome 扩展提供本地日志查看器，支持文件选择、拖拽打开、关键词/正则过滤、搜索跳转、复制原始行、导出过滤结果，并可调用本地分析服务。

构建：

```bash
cd chrome
npm install
npm run build
```

加载方式：

1. 打开 `chrome://extensions`。
2. 启用 `Developer mode`。
3. 点击 `Load unpacked`。
4. 选择本仓库的 `chrome/` 目录。
5. 点击 MyLogger 扩展图标并选择 `Open Viewer`。

默认分析接口：

```text
http://127.0.0.1:7878/analyze
```

可以通过 Rust CLI 启动服务：

```bash
cargo run -p mylogger -- StartService
```

也可以直接启动 Python demo 服务：

```bash
python3 backend/analysis_server.py
```

更多说明见 [chrome/README.md](chrome/README.md)。

## Android Studio 插件

`asplugin/` 提供 Android Studio 插件，用于从 IDE 内部读取当前项目断点并导出 JSON。

构建：

```bash
cd asplugin
gradle buildPlugin
```

插件产物：

```text
asplugin/build/distributions/mylogger-as-plugin-0.1.0.zip
```

安装方式：

1. Android Studio 打开 `Settings | Plugins`。
2. 选择 `Install Plugin from Disk...`。
3. 安装上面的 zip 后重启。
4. 打开目标 Android 工程，执行 `Tools > MyLogger > Export Breakpoints`。

更多说明见 [asplugin/README.md](asplugin/README.md)。

## 常用开发命令

```bash
cargo build --workspace
cargo test --workspace
cargo fmt --all
cargo run -p mylogger
cargo run -p mylogger -- --help
```

Chrome 扩展检查：

```bash
cd chrome
npm run check
npm run build
```

Android Studio 插件构建：

```bash
cd asplugin
gradle buildPlugin
```

## 生成文件与注意事项

不要提交以下生成内容：

- `target/`
- `asplugin/build/`
- `chrome/node_modules/`
- 抓取日志、临时 `.txt` 文件和本地分析结果

日志抓取默认会写入当前目录；如需保留结果，建议通过 `--output` 显式指定文件名。
