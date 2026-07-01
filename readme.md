# MyLogger

MyLogger 是一个面向开发者的日志分析工具。当前版本是 Rust MVP，已支持基础日志分析、Android logcat 抓取和轻量交互式入口。

## 环境要求

- Rust 1.95+
- Cargo
- Android 抓取能力需要本机已安装 `adb`，并且 `adb` 在 `PATH` 中
- 交互式文件选择需要本机已安装 `yazi`，并且 `yazi` 在 `PATH` 中

检查环境：

```bash
rustc --version
cargo --version
adb version
yazi --version
```

## 编译

```bash
cargo build --workspace
```

编译 release 版本：

```bash
cargo build --workspace --release
```

生成的二进制：

```bash
target/debug/MyLogger
target/release/MyLogger
```

## 测试

```bash
cargo test --workspace
```

格式化代码：

```bash
cargo fmt --all
```

## Android Studio 插件

`asplugin/` 下提供了 MyLogger Android Studio 插件，用于从 IDE 内部读取当前项目真实断点并导出 JSON。

构建插件：

```bash
cd asplugin
gradle buildPlugin
```

插件产物：

```bash
asplugin/build/distributions/mylogger-as-plugin-0.1.0.zip
```

安装方式：Android Studio 打开 `Settings | Plugins`，选择 `Install Plugin from Disk...`，安装上面的 zip 后重启。

使用方式：打开目标 Android 工程后，执行 `Tools > MyLogger > Export Breakpoints`，选择保存位置即可导出 `mylogger-breakpoints.json`。

## 运行

无参数启动交互式入口：

```bash
cargo run -p mylogger
```

进入交互式入口后，输入 `/` 会立即打开命令菜单，可以用上下键移动，按 Enter 将选中的命令填入输入框，再按 Enter 执行。命令结果会显示在上方消息区，输入框始终固定在底部。

在交互式入口中执行 `/analyze` 时，程序会临时退出 TUI 并打开 `yazi` 文件选择器。用户在 `yazi` 中选择日志文件后，会自动回到 TUI 并继续执行分析。也可以执行 `/analyze <file>` 直接分析指定文件。执行 `/analyze --open` 或 `/analyze <file> --open` 会在分析后生成 `mylogger-analysis.md`，并用 Neovim 打开结果。

在交互式入口中执行 `/capture` 或 `/capture -t` 时，会先执行 `adb devices` 检测设备。如果只有一个可用设备，会直接临时退出 TUI，切换到普通终端环境执行日志抓取；如果存在多个可用设备，会先在 TUI 中弹出设备列表，使用上下键切换设备并按 Enter 确认后，再切换到终端环境抓取。按 `Ctrl+C` 结束抓取后，会自动回到 TUI，并在消息区显示日志文件路径或错误信息。

查看帮助：

```bash
cargo run -p mylogger -- --help
```

## 分析日志文件

分析本地日志：

```bash
cargo run -p mylogger -- analyze app.log
```

按关键字过滤：

```bash
cargo run -p mylogger -- analyze app.log --keyword Exception
```

输出 JSON：

```bash
cargo run -p mylogger -- analyze app.log --json
```

## 抓取 Android 日志

默认抓取到当前目录 `123.txt`，按 `Ctrl+C` 结束：

```bash
cargo run -p mylogger -- capture
```

抓取到以当前时间命名的文件：

```bash
cargo run -p mylogger -- capture -t
```

指定设备：

```bash
cargo run -p mylogger -- capture --device emulator-5554
```

指定输出文件：

```bash
cargo run -p mylogger -- capture --output app.log
```

指定设备并输出到文件：

```bash
cargo run -p mylogger -- capture --device emulator-5554 --output app.log
```

`capture` 执行逻辑：

- 先执行 `adb devices`
- 如果没有可用设备，提示连接设备或启动模拟器
- 如果只有一个可用设备，直接抓取
- 如果有多个可用设备，提示选择设备
- 抓取通过 `Ctrl+C` 终止
- 结束时输出最终日志文件路径

## 直接运行编译后的二进制

Debug 版本：

```bash
target/debug/MyLogger --help
target/debug/MyLogger analyze app.log
target/debug/MyLogger capture
```

Release 版本：

```bash
target/release/MyLogger --help
target/release/MyLogger analyze app.log
target/release/MyLogger capture -t
```
