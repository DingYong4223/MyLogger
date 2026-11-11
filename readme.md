# MyLogger

MyLogger 是一个面向开发者的 ADB 工作台，集成设备与应用管理、页面联调、日志取证和本地日志分析。当前项目包含 Rust CLI/TUI、Chrome 本地日志查看器、Android Studio 断点导出插件，以及一个用于联调的本地分析服务。

## 能做什么

- 抓取 Android `logcat`，支持指定设备、包名、输出文件和按时间命名。
- 分析本地日志文件，输出行数、级别统计、Top Tag、问题摘要、JSON 或 Markdown 报告。
- 在终端工作台选择设备和应用，查看设备摘要、应用版本和当前 Activity，安装 APK、启动、停止或重启应用。
- 执行 schema 跳转，支持指定应用、长输入滚动、会话历史与显式持久化收藏。
- 保存 PNG 截图、按明确路径 Push/Pull 文件、管理当前设备的 TCP Reverse/Forward 映射。
- 查看后台任务、执行结果和产物；日志采集中仍可操作工作台。
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

抓取前检测 `adb devices`；单设备自动选择，多设备时 CLI 必须提供 `--device SERIAL`，TUI 则先展示选择列表。离线和未授权设备不可选。`capture` 默认先清空日志，增加 `--no-clear` 可保留历史缓冲。普通采集（含 `/log`、`/logcat`）固定写入当前工作目录的 `123.txt`，每次重新采集会清空并覆盖旧内容；显式 `-t` 才使用当前目录中的时间命名文件，显式 `--output` 已存在时拒绝覆盖。

应用日志优先按 UID 筛选；设备不支持时按解析后的 PID 筛选主进程及 `包名:子进程`，每秒刷新。UID 筛选会包含共享 UID 的进程；isolated process 不在覆盖范围，PID 回退在重启瞬间可能缺失日志。暂停显示和界面筛选都不改变落盘内容。

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

## ADB 工具箱 CLI

以下示例使用构建后的程序；多设备时为目标命令增加 `--device SERIAL`。短操作可加 `--json` 获取状态、设备、命令、输出、耗时、退出码和产物路径。

```bash
./target/debug/MyLogger devices
./target/debug/MyLogger device-info --device emulator-5554
./target/debug/MyLogger apps
./target/debug/MyLogger app-info com.example.app
./target/debug/MyLogger install "/path/to/app.apk" --launch com.example.app
./target/debug/MyLogger start com.example.app
./target/debug/MyLogger stop com.example.app
./target/debug/MyLogger restart com.example.app
./target/debug/MyLogger current
./target/debug/MyLogger schema 'demo://detail?id=123&source=dev' --package com.example.app
./target/debug/MyLogger screenshot --output "./captures/screen.png"
./target/debug/MyLogger push "./local file.json" /sdcard/Download/debug.json
./target/debug/MyLogger pull /sdcard/Download/debug.json "./downloaded.json"
./target/debug/MyLogger reverse --device emulator-5554 list
./target/debug/MyLogger reverse --device emulator-5554 add 8081 8081
./target/debug/MyLogger forward --device emulator-5554 add 8700 8701
./target/debug/MyLogger reverse --device emulator-5554 remove 8081
./target/debug/MyLogger favorites save 开发首页 'demo://home' --package com.example.app
./target/debug/MyLogger favorites list
```

Push/Pull 只支持文件，远端必须是绝对文件路径；已存在目标须显式增加 `--overwrite`。先传输到暂存文件再提交，失败时保留 `.partial` 并显示其路径。截图默认保存至 `captures/`，指定目标已存在时拒绝覆盖；按 PNG 签名、块结构及 CRC 校验后才生成正式文件。端口新增使用 `--no-rebind`，冲突不替换，删除只针对指定设备的一条 TCP 映射。

收藏保存到 `$XDG_CONFIG_HOME/mylogger/favorites.json`，未配置时使用 `~/.config/mylogger/favorites.json`。同名收藏显式更新；损坏文件会报错并保留。schema 作为单个安全参数交给设备 shell，保留查询顺序和编码。

## TUI 用法

```bash
cargo run -p mylogger
```

界面包含顶部设备/应用上下文、中间全宽任务与结果、底部命令栏，终端和视觉稿均移除左侧功能导航。输入 `/` 搜索中文名称、英文命令或分类；Tab 在输入与结果之间切换，方向键和 Enter 操作列表。

| 命令 | 功能 |
| --- | --- |
| `/device`、`/device-info` | 选择设备、设备摘要 |
| `/apps`、`/app-info` | 搜索选择应用、应用信息 |
| `/install` | 输入 APK 路径覆盖升级，保留应用数据 |
| `/start`、`/stop`、`/restart`、`/current` | 应用生命周期、当前 Activity |
| `/schema`、`/打开schema` | 先选设备，再输入 URI；Enter 直接执行 |
| `/favorites` | 选择收藏、确认设备、填入输入框，再回车执行 |
| `/log` | 当前应用日志，默认不清空设备日志，覆盖写入当前目录 `123.txt` |
| `/clear & logcat`、`/clear & logcat -t` | 清空并抓取全部设备日志，默认文件或时间命名 |
| `/logcat` | 全部设备日志，不清空 |
| `/screenshot` | 保存 PNG 至 `captures/` |
| `/push`、`/pull` | 明确路径的文件传输；覆盖时输入 `YES` |
| `/reverse`、`/forward` | 查看 TCP 映射；表单填写 list / add / remove 和端口 |
| `/tasks`、`/history` | 查看本次会话任务、结果与产物 |
| `/analyze`、`/StartService` | 保留本地日志分析、yazi / Neovim 与服务入口 |
| `/help`、`/quit` | 帮助、退出 |

| 按键 | 行为 |
| --- | --- |
| Tab / Shift+Tab | 切换焦点；表单中切换字段 |
| ↑ / ↓ | 输入区恢复会话历史和草稿；列表区切换选项或任务 |
| Enter / Esc | 执行或下一项 / 取消未提交输入与选择 |
| Home / End / ← / → | 编辑长 URI 和文件路径，视口跟随光标 |
| 鼠标滚轮 | 任务区滚动选择历史任务并显示详情；详情区按屏幕行滚动结果或实时日志 |
| PageUp / PageDown | 按页滚动详情；上翻日志固定画面，回到底部继续跟随 |
| Home / End（结果区焦点） | 跳到详情顶部 / 底部；Tab 切换结果区焦点 |
| Ctrl+G | schema 表单中显式指定或取消当前已选应用 |
| Ctrl+S | 收藏正在编辑或最近执行的 schema，保存后保留原输入 |
| Ctrl+P / Ctrl+F / Ctrl+L | 暂停日志显示 / 关键词 / 循环最低级别 |
| Ctrl+X | 停止当前选中的其它后台任务 |
| Ctrl+C | 有日志任务时停止采集并留在工作台；没有日志任务时退出 |

每台设备最多一个日志任务；同一工作台中，正在写入 `123.txt` 时须先停止该任务再开始普通采集，避免不同设备同时写同一文件。切换设备会清除应用上下文，运行中任务继续固定使用原设备。日志 UI 保留最近 2000 条记录，长日志自动换行并按屏幕行滚动；上翻时冻结当前显示快照，新日志继续采集，滚动到底部后恢复跟随。拥塞时可丢弃显示更新，完整选中日志持续落盘。日志抓取结束后，“会话任务”中的日志条目保留完整绝对路径，长路径自动换行。停止日志使用 Ctrl+C；切到其它操作后仍可停止后台采集。退出工作台也可使用 `/quit`，并清理本工具管理的采集进程。yazi 和 Neovim 会临时切换终端，结束后返回工作台。

历史仅保存在当前会话，恢复 schema 后可编辑、回车并使用当前设备执行。schema 新动作始终先刷新设备，多设备仍需确认后才出现输入框。收藏回填不会自动跳转。

实现与验证记录见 [ADB工具箱首批实现与验证](docs/ADB工具箱首批实现与验证.md)。完整规划中的录屏、无线配对、清数据、性能分析等仍在后续批次，实际终端只展示已实现入口。

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
