# MyLogger 交互式 Agent 框架设计建议

## 1. 目标形态

MyLogger 不只是一个 `analyze app.log` 的命令行工具，而是一个交互式日志分析助手：

```bash
MyLogger
```

启动后进入交互式命令行窗口，用户可以用自然语言输入：

```text
帮我抓取当前手机的崩溃日志
分析 app.log 里最近一次登录失败的原因
只看 com.example.app 相关的 Error 和 Exception
生成一份 Markdown 问题报告
```

后端将自然语言交给大模型理解，大模型再选择合适的本地工具执行，例如：

- 检测设备：`adb devices`
- 抓取日志：`adb -s <serial> logcat -v threadtime`
- 解析日志文件
- 过滤 Tag/PID/包名/级别
- 提取 Crash/ANR/Exception
- 生成摘要和报告

## 2. CodeWhale 可参考点

参考项目：`/Users/delanding/devsoft/CodeWhale`

CodeWhale 是一个 Rust workspace，核心思路适合参考，但 MyLogger 不应直接照搬它的完整复杂度。

### 2.1 值得参考的架构

CodeWhale 的关键分层：

```text
crates/cli       顶层 CLI 入口和参数转发
crates/tui       交互式 TUI、事件循环、输入框、渲染
crates/core      Agent 回合执行、会话、工具编排
crates/tools     模型可调用的工具系统
crates/config    配置、模型 provider、环境变量
crates/protocol  UI 与引擎之间的事件/操作协议
crates/state     会话和状态持久化
```

最值得 MyLogger 学习的是这几个设计：

1. UI 和 Agent 引擎解耦。
2. 用户输入转换成 `Op`，引擎处理后返回 `Event`。
3. 工具统一注册，模型只看到受控工具列表。
4. shell/终端命令不是随便执行，而是走工具层和安全策略。
5. 长任务和流式输出不会阻塞 UI。

### 2.2 不建议第一版照搬的能力

CodeWhale 面向通用 coding agent，能力很宽。MyLogger 第一版应避免这些复杂度：

- 子 Agent
- MCP 插件生态
- 多工作线程任务系统
- 大规模会话恢复和快照
- 复杂权限策略
- 多 Provider 全量支持
- 文件编辑、patch、LSP 诊断等 coding agent 专属能力

MyLogger 应该先做一个「日志分析专用 Agent」，工具面窄、行为可控、反馈快。

## 3. 推荐技术栈

建议使用 Rust，因为 CodeWhale 本身是 Rust，且日志工具对性能、流式读取、终端交互都有要求。

推荐依赖：

| 能力 | 推荐库 |
|------|--------|
| CLI 参数 | `clap` |
| 异步运行 | `tokio` |
| TUI | `ratatui` + `crossterm` |
| HTTP 请求 | `reqwest` |
| JSON/YAML/TOML | `serde`、`serde_json`、`serde_yaml`、`toml` |
| 日志解析正则 | `regex` |
| 错误处理 | `anyhow` + `thiserror` |
| 配置目录 | `dirs` |
| 时间处理 | `chrono` |

如果希望更快做原型，也可以先用 Python 实现 CLI Agent，再用 Rust 重写核心解析器。但长期看，Rust 更适合做 MyLogger 的主实现。

## 4. 建议项目结构

第一版不需要像 CodeWhale 那样拆很多 crate，但建议从一开始保持模块边界清晰。

```text
MyLogger/
  Cargo.toml
  crates/
    mylogger-cli/
      src/main.rs
      src/lib.rs
    mylogger-core/
      src/lib.rs
      src/agent.rs
      src/session.rs
      src/op.rs
      src/event.rs
    mylogger-tui/
      src/lib.rs
      src/app.rs
      src/ui.rs
      src/input.rs
    mylogger-tools/
      src/lib.rs
      src/registry.rs
      src/adb.rs
      src/logcat.rs
      src/analyze.rs
      src/report.rs
    mylogger-llm/
      src/lib.rs
      src/provider.rs
      src/openai_compatible.rs
    mylogger-config/
      src/lib.rs
```

更精简的 MVP 结构也可以：

```text
src/
  main.rs
  cli.rs
  tui/
  core/
  tools/
  llm/
  config/
```

如果你明确要参考 CodeWhale 并后续长期扩展，建议直接采用 workspace 多 crate。

## 5. 核心运行流程

```text
用户启动 MyLogger
  └── CLI 加载配置和模型信息
      └── 启动 TUI
          └── 用户输入自然语言
              └── UI 发送 Op::UserMessage 给 Core Engine
                  └── Core Engine 组装 system prompt + tool schema + 会话上下文
                      └── 调用大模型
                          ├── 模型返回普通回答：展示到 TUI
                          └── 模型返回 tool call：执行本地工具
                              └── 工具结果回传模型
                                  └── 模型生成最终分析结论
```

UI 和引擎之间建议使用 channel：

```text
TUI -> Core: Op
Core -> TUI: Event
```

`Op` 示例：

```rust
enum Op {
    UserMessage { content: String },
    RunSlashCommand { command: String },
    CancelCurrentTurn,
    SelectDevice { serial: String },
}
```

`Event` 示例：

```rust
enum Event {
    AssistantDelta { text: String },
    ToolStarted { name: String, summary: String },
    ToolOutput { name: String, output: String },
    ToolFinished { name: String, success: bool },
    DeviceSelectionRequested { devices: Vec<AdbDevice> },
    TurnFinished,
    Error { message: String },
}
```

## 6. 工具系统设计

MyLogger 的模型可调用工具应保持专用和结构化，不建议一开始暴露通用 shell。

### 6.1 MVP 工具列表

| 工具 | 作用 |
|------|------|
| `list_adb_devices` | 执行 `adb devices`，返回结构化设备列表 |
| `capture_logcat` | 根据设备 serial 抓取 logcat |
| `read_log_file` | 读取本地日志文件，支持大文件分块 |
| `filter_logs` | 按级别、Tag、PID、包名、关键词过滤 |
| `extract_exceptions` | 提取 Java/Kotlin Exception 和 FATAL EXCEPTION |
| `summarize_logs` | 输出错误摘要、Top Tag、时间范围 |
| `generate_report` | 生成 Markdown/JSON 分析报告 |

### 6.2 ADB 抓取工具规则

设备选择逻辑应该放在工具内部，而不是交给模型自由拼命令：

```text
capture_logcat
  ├── 如果传入 --device，则直接使用该设备
  └── 如果未传入设备：
      ├── 调用 list_adb_devices
      ├── 0 个设备：返回 NoDevice 错误
      ├── 1 个设备：自动抓取
      └── 多个设备：返回 NeedDeviceSelection 事件，由 UI 提示用户选择
```

输出文件规则：

```text
capture
  ├── 默认输出到当前目录 ./123.txt
  ├── 传入 -t 时输出到当前目录的时间命名文件
  ├── 传入 --output <file> 时输出到指定文件
  ├── 抓取过程持续运行，直到用户按 Ctrl+C
  └── 结束时输出最终日志文件路径
```

时间命名文件建议使用稳定、可排序、跨平台安全的格式：

```text
mylogger-20260701-153012.log
```

如果默认 `./123.txt` 已存在，第一版可以直接覆盖，但必须在开始抓取前提示；后续可以增加 `--append` 或自动备份策略。

这样做的好处：

- 模型不需要记住多设备处理细节。
- 交互选择由程序保证一致性。
- 后续 GUI/TUI/脚本模式都能复用同一套逻辑。

### 6.3 先不开放通用 shell

第一版建议不要给模型直接执行任意终端命令的能力。只开放白名单工具：

- ADB 相关命令由 `adb.rs` 封装。
- 文件读取由 `read_log_file` 封装。
- 报告写入由 `generate_report` 封装。

等工具体系稳定后，再考虑增加受限 shell，例如只允许：

- `adb devices`
- `adb -s <serial> logcat ...`
- `rg`/`grep` 针对日志文件的只读搜索

## 7. 大模型对接方式

第一版建议支持 OpenAI-compatible Chat Completions 协议，便于接入多种模型服务：

```toml
provider = "openai-compatible"
model = "your-model"
base_url = "https://api.example.com/v1"
api_key_env = "MYLOGGER_API_KEY"
```

后续再扩展：

- OpenAI
- DeepSeek
- OpenRouter
- Ollama 本地模型
- 公司内部模型网关

Provider 层接口建议：

```rust
#[async_trait]
trait LlmProvider {
    async fn chat(&self, request: ChatRequest) -> anyhow::Result<ChatResponse>;
}
```

## 8. System Prompt 建议

MyLogger 的 Agent 需要非常明确的领域边界：

```text
你是 MyLogger，一个日志分析助手。
你只能通过提供的工具读取、抓取、过滤和分析日志。
当用户要求抓取 Android 日志时，必须使用 capture_logcat 工具。
如果工具返回需要选择设备，你必须等待用户选择，不要猜测设备。
不要编造日志内容。结论必须引用工具返回的证据。
输出结论时优先包含：问题摘要、关键时间点、异常堆栈、可疑原因、下一步建议。
```

## 9. 交互式界面建议

MVP 界面不需要复杂，建议包含三块：

```text
┌────────────────────────────────────────────┐
│ MyLogger  model: xxx  device: emulator...  │
├────────────────────────────────────────────┤
│ 对话/分析结果区                              │
│ - 用户输入                                  │
│ - 模型回答                                  │
│ - 工具执行卡片                              │
├────────────────────────────────────────────┤
│ > 输入自然语言或 /command                   │
└────────────────────────────────────────────┘
```

需要支持的基础交互：

- Enter 提交
- Ctrl+C 取消当前抓取或分析
- `/help` 查看命令
- `/device` 查看和切换设备
- `/capture` 手动抓取日志
- `/analyze <file>` 分析文件
- `/report` 导出报告
- `/quit` 退出

自然语言和 slash command 可以同时存在：

- 自然语言走大模型理解。
- slash command 直接调用本地功能，稳定、快速、可调试。

## 10. 固定流程的低记忆成本交互

固定流程不应该等同于让用户记大量命令。MyLogger 内部可以有很多确定性 workflow，但用户入口要保持简单。

### 10.1 入口设计

推荐同时支持三种入口：

| 入口 | 面向用户 | 说明 |
|------|----------|------|
| 自然语言 | 所有用户 | 用户直接输入“抓取日志”“分析崩溃”“只看 Error”，系统先匹配固定 workflow，匹配不上再交给大模型 |
| 命令面板 | 交互式用户 | 输入 `/` 或快捷键打开可搜索动作列表，类似 VS Code Command Palette |
| 少量 Slash Command | 高级用户/脚本用户 | 只保留少量稳定一级命令，不暴露过多细碎命令 |

用户不需要记完整命令。命令是高级入口，不是主入口。

### 10.2 Intent Router

交互式输入先进入意图路由器：

```text
用户输入
  └── Intent Router
      ├── 命中固定 workflow：直接执行
      ├── 命中固定 workflow 但缺参数：交互式追问
      └── 未命中或需要综合判断：交给 LLM Agent
```

示例：

```text
用户：抓取日志
=> capture_logcat workflow

用户：只看 Error
=> filter_logs(level=error)

用户：分析闪退
=> crash_analysis workflow

用户：为什么登录失败？
=> 先执行 login/network/error 相关固定提取，再交给大模型总结
```

### 10.3 Slash Command 控制数量

Slash Command 只保留 5 到 8 个一级命令：

```text
/help
/capture
/analyze
/filter
/report
/device
/config
/quit
```

复杂参数通过交互式追问解决，不要求用户记长参数。

例如：

```text
用户：/capture
系统：检测到多个设备：
  1. emulator-5554
  2. R5CT123ABC
请选择设备：
```

### 10.4 Command Palette

命令面板用于发现固定 workflow：

```text
Capture Android log
Analyze current log
Extract crash
Analyze ANR
Filter by Error
Generate Markdown report
Switch device
Open config
```

用户输入关键词即可搜索：

```text
crash
```

系统展示相关动作，而不是要求用户记住 `/analyze --workflow crash`。

### 10.5 首页快捷动作

首次进入交互界面时可以展示常用动作：

```text
MyLogger

常用操作：
[1] 抓取 Android 日志
[2] 分析本地日志文件
[3] 提取崩溃
[4] 分析 ANR
[5] 生成报告
[6] 切换设备

请输入编号、命令或自然语言：
```

这对新用户尤其重要，能让用户不看文档也能开始使用。

### 10.6 Workflow 模板和别名

固定流程内部用 workflow 模板描述，用户看到的是“场景”。

```yaml
workflows:
  crash:
    title: "崩溃分析"
    aliases: ["crash", "崩溃", "闪退", "fatal", "FATAL EXCEPTION"]
    steps:
      - extract_exceptions
      - summarize_crash
      - generate_evidence

  anr:
    title: "ANR 分析"
    aliases: ["anr", "卡死", "无响应", "卡顿"]
    steps:
      - extract_anr
      - summarize_thread_state
      - generate_evidence
```

别名设计要覆盖中文、英文、口语表达和常见日志关键词。

### 10.7 最近使用和推荐动作

系统可以记录最近使用的 workflow：

```text
最近使用：
1. 抓取 com.example.app 日志
2. 分析 Crash
3. 导出 Markdown 报告
```

也可以根据当前上下文推荐动作：

```text
已读取 app.log，可继续：
[1] 提取崩溃
[2] 只看 Error
[3] 生成报告
```

## 11. 状态管理

建议维护一个轻量 Session：

```rust
struct SessionState {
    workspace: PathBuf,
    selected_device: Option<String>,
    current_log_file: Option<PathBuf>,
    last_capture_file: Option<PathBuf>,
    last_issues: Vec<Issue>,
    messages: Vec<Message>,
}
```

这能支持用户连续对话：

```text
先抓取日志
只看 Error
帮我分析刚才那个异常
导出报告
```

## 12. MVP 开发顺序

建议按这个顺序做：

1. 搭 Rust workspace 和 `MyLogger` CLI 入口。
2. 实现普通命令模式：`MyLogger analyze app.log`。
3. 实现 ADB 设备检测和 `capture_logcat`。
4. 实现最小 TUI：输入框、输出区、退出。
5. 增加 Core Engine：TUI 发送 `Op`，Engine 返回 `Event`。
6. 接入 OpenAI-compatible LLM。
7. 定义工具 schema，让模型调用 `list_adb_devices`、`capture_logcat`、`filter_logs`。
8. 加入多设备选择事件。
9. 加入 Markdown 报告导出。
10. 补单元测试和真实 logcat 样例测试。
11. 加入 Intent Router、少量 Slash Command、首页快捷动作。

## 13. 建议第一版验收标准

第一版交互式 MyLogger 完成后，应该能跑通这些场景：

```text
场景 1：单设备抓取
用户：帮我抓取当前设备日志
系统：自动检测唯一设备，开始抓取 logcat，默认写入 ./123.txt，用户按 Ctrl+C 后输出文件路径

场景 2：多设备选择
用户：抓取崩溃日志
系统：发现多个设备，展示列表
用户：选择 2
系统：对第 2 个设备抓取日志，用户按 Ctrl+C 后输出文件路径

场景 2.1：时间命名抓取
用户：capture -t
系统：抓取日志到 mylogger-YYYYMMDD-HHMMSS.log，用户按 Ctrl+C 后输出文件路径

场景 3：日志分析
用户：分析 app.log 里有没有崩溃
系统：读取文件，提取异常，输出摘要和证据

场景 4：连续追问
用户：只看 com.example.app
系统：基于上一次日志结果继续过滤

场景 5：报告导出
用户：生成 Markdown 报告
系统：输出报告文件路径

场景 6：不记命令也能使用
用户：输入“分析闪退”
系统：匹配 Crash workflow，执行固定异常提取和摘要

场景 7：命令面板发现能力
用户：输入 `/` 后搜索 “anr”
系统：展示 “Analyze ANR” 动作
```

## 14. 关键取舍建议

1. 先做专用工具，不做通用 shell agent。
2. 先做 TUI，不急着做 GUI。
3. 先支持 OpenAI-compatible，一个 provider 跑通后再扩展。
4. 先让工具返回结构化结果，再让模型总结。
5. 设备选择、文件写入、长时间抓取这类流程必须由程序控制，不能完全交给模型自由发挥。
6. 日志原文可能有敏感信息，接入大模型前必须先做摘要和脱敏。
7. 固定 workflow 不要暴露成大量命令；优先通过自然语言、命令面板、快捷动作触发。

## 15. 与现有产品设计的关系

`mylogger-product-design.md` 定义的是 MyLogger 的产品功能面。

本文档定义的是交互式 Agent 的技术框架：

- 产品设计回答「MyLogger 要做什么」
- 本文档回答「交互式 MyLogger 怎么搭起来」

建议下一步先创建 Rust workspace，然后实现：

- `mylogger-cli`
- `mylogger-core`
- `mylogger-tools`
- `mylogger-llm`
- `mylogger-tui`
