# ADB工具箱首批实现与验证

状态：首批方案已获批准并实现；本地自动化检查与 Debug/Release 构建通过。未连接或操作实际 Android 设备，未进行真机验收。

## 实现范围

| 已批准能力 | 实际实现 |
| --- | --- |
| 工作台 | ratatui 深灰工作区、青灰焦点、设备/应用上下文、全宽任务与结果、命令输入；中文/英文/分类搜索；按用户要求移除终端和视觉稿的整个左侧导航，Tab 切换输入与结果 |
| 设备 | 每个新动作刷新设备，单设备自动选择，多设备先确认；展示离线/未授权状态，禁止选择；型号、系统版本、API、ABI、分辨率、密度 |
| 应用 | 包名列表与搜索、版本/UID/debuggable、APK 覆盖升级、Launcher 解析后启动、停止、重启、当前 Activity；无法解析时显示未知并保留原始输出 |
| schema | `/schema` 与 `/打开schema`；长 URI 安全转义、Unicode 光标滚动、会话历史/草稿；Ctrl+G 显式指定当前应用；Ctrl+S 收藏；收藏回填后需再次执行 |
| 日志 | 按 UID 筛选，能力不足时按主/子进程 PID 筛选并定时刷新；后台采集、最低级别和关键词显示筛选、暂停显示、停止刷新；保留原有清空/不清空命令 |
| 截图 | exec-out 原始字节保存；签名、PNG 块及 CRC 校验；唯一默认路径；已有指定目标不覆盖 |
| 文件 | 明确路径的单文件 Push/Pull；长任务状态和耗时、取消/超时及结果；暂存后提交，覆盖必须显式确认；失败保留部分产物路径 |
| 网络 | 当前设备的 TCP Reverse/Forward 查看、新增、删除；来源端口冲突不替换，不使用 remove-all |
| 会话 | 运行/保存中/完成/失败/取消状态；目标设备与应用快照、命令、错误、退出码、耗时、产物；切换设备不会重定向运行任务 |
| CLI | devices/device-info/apps/app-info/install/start/stop/restart/current/schema/screenshot/push/pull/reverse/forward/favorites；保留 analyze/capture/StartService；新操作支持 JSON 结果 |

历史只在当前会话保存。用户显式保存的收藏写入配置目录，同名更新、原子替换；损坏 JSON 不覆盖。根据用户要求，普通日志采集恢复覆盖写入当前工作目录的 `123.txt`；只有显式 `-t` 才按时间命名，显式输出路径继续拒绝覆盖。截图与报告保留不覆盖策略。每台设备最多一个日志任务，同一工作台禁止并发写入同一日志文件。

未扩展录屏、无线配对、多用户、卸载/清数据、权限管理、文件浏览器、任意 Intent extras、私有数据库、性能采集或工作流引擎。

## 源码位置

- `crates/mylogger-core/src/actions.rs`：内置动作描述、搜索和结果模型；`router.rs` 保留旧命令并增加 schema 英文别名。
- `crates/mylogger-tools/src/process.rs`：设备 serial、shell 参数边界、并发消费输出、取消及超时。
- `crates/mylogger-tools/src/operations.rs`：设备/应用/页面/文件/截图/端口操作、元数据解析和文件提交。
- `crates/mylogger-tools/src/capture.rs`：UID/PID 应用日志筛选、实时文件写入、进程收尾。
- `crates/mylogger-tools/src/favorites.rs`：显式收藏持久化。
- `crates/mylogger-tui/src/workbench.rs`：工作台渲染、后台任务、选择器、表单、焦点与键盘交互；`lib.rs` 继续提供文本编辑器、历史、终端恢复及 yazi/Neovim 集成。
- `crates/mylogger-cli/src/toolbox.rs`：结构化子命令，与 TUI 共用 tools 执行层。

本次保留 Rust workspace 与原可执行名；没有迁移技术栈，没有创建 Web 后端，也没有修改 Android Studio 插件或 Chrome 扩展。

## 自动化验证

验证日期：2026-11-10；macOS 本地环境。

| 检查 | 结果与覆盖 |
| --- | --- |
| `cargo fmt --all -- --check` | 通过 |
| `cargo clippy --workspace --all-targets -- -D warnings` | 通过，无警告 |
| `cargo test --workspace` | 32 项测试通过：core 8、tools 10、TUI 9、CLI 集成 5 |
| `cargo build --workspace` | 通过；输出 `target/debug/MyLogger` |
| `cargo build --workspace --release` | 通过；输出 `target/release/MyLogger` |
| `git diff --check` | 通过 |
| `python3 crates/mylogger-cli/tests/verify_workbench.py` | PTY 交互回归通过，仅使用替身 adb |

CLI 测试使用 `tests/fixtures/adb.py`，通过每个子进程独立 PATH 和配置目录隔离，不修改全局环境。覆盖无设备/多设备/离线/未授权/发现失败，安全 URI 与目标 serial，安装语义失败和非零退出码，启动/重启/当前页面，二进制截图与截断/CRC 错误，含空格和引号的路径，文件覆盖保护，双方向端口冲突/设备隔离/指定删除，以及收藏保存。

日志集成测试覆盖默认路径为当前目录 `123.txt`、重复采集覆盖旧内容、显式 `-t` 时间命名、UID 探测与 PID 回退、日志正文不含包名、主/子进程、PID 切换、无关进程正文包含包名仍被排除、停止后文件完成写入及进程退出、异常结束标记失败。解析、超时、取消和双管道容量检查由 tools 单元测试覆盖。

PTY 回归覆盖无侧栏全宽布局、命令搜索、设备先于 schema 输入、长中文 URI、Home/End 和历史恢复、应用搜索、指定 schema 应用、收藏保存后恢复原草稿、收藏回填不自动执行、选择取消、后台日志、暂停时文件继续增长、Ctrl+C 停止采集后保留工作台、其它任务选中时停止后台采集、/quit 退出清理、任务设备隔离和截图、无设备/错误恢复、130×38 / 60×20 / 20×10 / 8×5 终端尺寸及退出后恢复终端模式。TestBackend 单元测试另检查窄屏光标边界、Unicode 编辑、历史草稿、暂停缓冲，以及采集完成后会话任务条目中的完整绝对路径、中文长路径换行和多任务选择定位。

交互证据在项目 `tmp/workbench-pty-*/` 的 `terminal.log`、`calls.jsonl`、`result.md` 中；测试失败时 CLI 夹具也保留在项目 `tmp/`。这些为临时验收产物，不应提交。

补充布局验证：`python3 tmp/verify_adb_workbench_no_sidebar.py` 使用无头 Chromium 完成 13 个页面、11 组交互与 4 种视口的浏览器 DOM 检查，确认左侧导航节点移除、主区域占满工作区、所有页面仍可由底部搜索进入，无页面错误或水平溢出。未截图。

## 验收边界与限制

1. 替身 adb 验证的是命令、状态和交互；未进行真实 APK 安装、schema 跳转、设备截图、文件传输或端口联调验收，也未验证不同 Android/厂商版本的全部输出差异。
2. UID 筛选包含共享 UID 的进程；isolated process 不在覆盖范围。PID 回退每秒刷新，重启瞬间可能缺日志；设备能力不足时失败并说明，不退回正文包名匹配。
3. UI 日志最多保留 2000 行，队列拥塞时丢弃显示更新；完整选中日志持续写文件。暂停仅冻结显示，恢复后继续跟随。
4. Push 依赖设备 shell 的 `mv -n` / `mv -f`；不支持时失败并保留暂存文件。首批只处理明确路径的单文件和 TCP 映射。
5. 安装取消只终止本机等待，不承诺设备安装状态回滚；应重新查询应用状态。外部分析服务按原行为独立运行，不随工作台退出自动停止。
6. yazi/Neovim 的终端挂起/恢复集成保留；本批未操作真实编辑器、启动后台分析服务，未构建插件或 Chrome 扩展。终端验证未使用截图，不属于像素级视觉验收。

## 使用入口

```bash
./target/debug/MyLogger
./target/release/MyLogger
./target/debug/MyLogger --help
```

完整命令与快捷键见 [README](../readme.md)。设计结构继续以 [统一视觉稿](../design/index.html) 为准；终端使用字符布局、选择器、表单和快捷键承载已批准的首批交互，完整视觉稿的后续功能仅作规划参考。
