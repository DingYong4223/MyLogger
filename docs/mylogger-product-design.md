# MyLogger 产品设计文档

## 1. 产品定位

MyLogger 是一款面向开发者的日志分析工具，优先解决本地日志、Android logcat、服务端文本日志在排查问题时的高频痛点：

- 快速打开和分析大日志文件
- 高效过滤、搜索、定位异常
- 自动识别 Crash、ANR、Exception、Error 等关键线索
- 将零散日志整理成可阅读、可复盘、可分享的分析结果
- 支持后续加入个人定制规则和自动化分析能力

初期建议定位为「开发者本地日志分析助手」，先做好 CLI 或 TUI 核心能力，再逐步扩展到 Neovim 插件、GUI、AI 辅助分析等形态。

## 2. 目标用户

| 用户 | 主要场景 | 核心诉求 |
|------|----------|----------|
| Android 开发者 | 分析 logcat、Crash、ANR、启动耗时 | 按包名、PID、Tag、日志级别快速定位问题 |
| 后端开发者 | 分析服务日志、请求链路、错误堆栈 | 过滤请求 ID、统计错误、追踪时间线 |
| 测试/QA | 收集并初步判断问题日志 | 一键提取关键异常和复现时间段 |
| 个人开发者 | 管理自己的日志分析规则 | 可配置、可扩展、可脚本化 |

## 3. 核心设计原则

1. 快速：大文件不能卡死，搜索和过滤要尽量流式处理。
2. 清晰：默认视图必须突出时间、级别、来源、关键信息。
3. 可扩展：日志格式、规则、报告模板都应该可配置。
4. 可自动化：CLI 输出应适合管道、脚本和 CI 使用。
5. 少打扰：工具默认给出有价值的信息，不要求用户先写复杂规则。
6. 低记忆成本：固定流程不要求用户记大量命令，优先通过自然语言、命令面板、快捷动作触发。

## 4. 基础功能

### 4.1 日志输入

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 打开本地日志文件 | 支持 `.log`、`.txt`、无扩展名文本日志 | P0 |
| 标准输入读取 | 支持 `cat app.log \| mylogger`、`adb logcat \| mylogger` | P0 |
| 实时 tail | 文件持续写入时实时刷新分析结果 | P0 |
| 多文件输入 | 多个日志文件按时间顺序合并查看 | P1 |
| 压缩文件读取 | 支持 `.gz`、`.zip` 等常见压缩日志 | P2 |

### 4.2 日志解析

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 自动识别日志格式 | 自动判断 Android logcat、JSON Lines、普通文本等 | P0 |
| Android logcat 解析 | 解析时间、PID、TID、级别、Tag、消息体 | P0 |
| 通用文本解析 | 无法识别格式时按行处理，仍支持搜索和过滤 | P0 |
| JSON 日志解析 | 展开字段，支持按字段过滤 | P1 |
| 自定义解析规则 | 用户通过配置文件定义正则和字段映射 | P1 |

### 4.3 查看与导航

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 彩色级别显示 | Error、Warn、Info、Debug 使用不同颜色 | P0 |
| 关键字高亮 | 搜索词、异常、包名、Tag 高亮显示 | P0 |
| 快速跳转异常 | 跳转到下一个 Error、Exception、Crash、ANR | P0 |
| 上下文查看 | 查看命中日志前后 N 行上下文 | P0 |
| 时间范围跳转 | 跳转到指定时间点或时间区间 | P1 |
| 书签 | 标记关键日志行，便于复盘 | P2 |

### 4.4 搜索与过滤

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 关键词搜索 | 普通字符串搜索 | P0 |
| 正则搜索 | 支持复杂模式匹配 | P0 |
| 日志级别过滤 | 只看 Error/Warn，或隐藏 Debug/Verbose | P0 |
| Android 字段过滤 | 按包名、PID、TID、Tag 过滤 | P0 |
| 排除过滤 | 排除噪音 Tag、系统日志、重复日志 | P1 |
| 组合过滤 | 多条件 AND/OR 组合 | P1 |
| 保存过滤器 | 常用过滤规则保存为 profile | P2 |

### 4.5 异常识别

| 功能 | 说明 | 优先级 |
|------|------|--------|
| Java/Kotlin 异常识别 | 自动折叠并提取完整堆栈 | P0 |
| Native Crash 识别 | 识别 signal、tombstone、backtrace 关键段落 | P1 |
| ANR 识别 | 识别 ANR、Input dispatching timed out 等关键词 | P1 |
| 重复异常聚合 | 相同堆栈只展示一次，并统计出现次数 | P1 |
| 根因候选提示 | 根据异常类型给出可疑行、线程、模块 | P2 |

### 4.6 统计分析

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 日志级别统计 | Error/Warn/Info 数量统计 | P0 |
| Top Tag 统计 | 输出最频繁的 Tag 或模块 | P0 |
| 时间分布统计 | 查看某段时间日志量是否异常激增 | P1 |
| 错误摘要 | 自动列出错误类型、出现次数、首次/末次时间 | P1 |
| 请求/Trace ID 聚合 | 后端日志按 requestId、traceId 汇总链路 | P2 |

### 4.7 报告导出

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 文本摘要 | 输出关键异常、统计数据、命中日志片段 | P0 |
| Markdown 报告 | 生成便于提交 issue 或复盘的 Markdown | P1 |
| JSON 输出 | 给脚本、CI 或其他工具消费 | P1 |
| 脱敏导出 | 自动隐藏手机号、邮箱、token、用户 ID 等敏感信息 | P1 |
| 分享包 | 导出日志片段、配置、分析报告为一个目录 | P2 |

### 4.8 日志抓取

日志抓取能力用于从设备或运行环境中直接采集日志，减少用户手动执行 `adb logcat`、重定向文件、再导入分析工具的步骤。

| 功能 | 说明 | 优先级 |
|------|------|--------|
| ADB 设备检测 | 执行抓取前先运行 `adb devices` 获取当前连接设备 | P0 |
| 单设备自动抓取 | 只有一个可用设备时，直接使用该设备执行 `adb logcat` | P0 |
| 多设备选择 | 存在多个可用设备时，列出设备序列号和状态，提示用户选择目标设备 | P0 |
| 无设备提示 | 没有可用设备时，提示用户连接设备或启动模拟器 | P0 |
| 指定设备抓取 | 支持通过 `--device <serial>` 跳过交互选择 | P0 |
| 默认输出文件 | 执行 `capture` 时默认将日志写入当前目录 `./123.txt` | P0 |
| 时间命名文件 | 执行 `capture -t` 时将日志写入以当前时间命名的文件 | P0 |
| Ctrl+C 终止 | 抓取过程通过 `Ctrl+C` 终止，终止后正常收尾 | P0 |
| 结束输出路径 | 抓取结束时在终端输出最终日志文件路径 | P0 |
| 自定义输出文件 | 支持通过 `--output <file>` 指定保存路径 | P1 |
| 抓取时长控制 | 支持 `--duration 60s`、`--until-crash` 等结束条件 | P2 |

设备选择流程：

```text
用户执行 mylogger capture
  └── 运行 adb devices
      ├── 0 个可用设备：提示连接设备后退出
      ├── 1 个可用设备：直接 adb -s <serial> logcat -v threadtime
      └── 多个可用设备：展示设备列表，等待用户选择后抓取
          └── 日志写入目标文件，直到用户按 Ctrl+C 终止
              └── 输出最终日志文件路径
```

多设备提示示例：

```text
检测到多个 Android 设备，请选择要抓取日志的设备：

  1. emulator-5554    device
  2. R5CT123ABC       device

输入序号或设备 serial：
```

## 5. Android 专项能力

Android 是 MyLogger 可以重点差异化的方向，建议从以下能力开始：

| 功能 | 说明 |
|------|------|
| 日志抓取 | 执行 `adb devices` 检测设备，单设备自动抓取，多设备提示选择 |
| 包名过滤 | 输入包名后自动识别相关 PID，并过滤目标 App 日志 |
| 多进程识别 | 展示主进程、push 进程、webview/sandbox 进程等 |
| Crash 专项视图 | 聚合 FATAL EXCEPTION、AndroidRuntime、tombstone |
| ANR 专项视图 | 识别 ANR 时间点、主线程卡顿、关键等待信息 |
| 生命周期事件 | 高亮 Activity/Fragment/App 启动、切前后台等事件 |
| 性能线索 | 提取 GC、Skipped frames、Choreographer、Slow operation |
| 设备信息摘要 | 从日志中提取系统版本、机型、ABI、App 版本等信息 |

## 6. 可加入的个人新功能方向

### 6.1 个人规则库

允许用户维护自己的规则，例如：

- 某些 Tag 代表业务模块
- 某些错误码对应明确原因
- 某些日志组合代表一次完整业务流程
- 某些堆栈属于已知问题，可直接标记为低优先级

建议配置示例：

```yaml
rules:
  - name: login_timeout
    pattern: "Login.*timeout|code=1008"
    level: error
    label: "登录超时"
    suggestion: "检查网络、网关超时和登录接口耗时"
```

### 6.2 场景化分析模板

针对常见问题提供模板：

| 模板 | 自动分析内容 |
|------|--------------|
| Crash 分析 | 崩溃类型、堆栈、线程、首次出现时间 |
| ANR 分析 | 卡顿时间、主线程状态、锁等待线索 |
| 启动分析 | 启动时间线、关键生命周期、耗时日志 |
| 网络失败 | URL、状态码、错误码、重试次数 |
| 业务流程 | 按自定义关键事件还原流程 |

### 6.3 AI 辅助分析

后期可以加入 AI，但建议只在结构化摘要之后再接入，避免直接把整份日志发送给模型。

基础流程：

1. 本地解析日志。
2. 提取异常堆栈、时间线、统计摘要。
3. 脱敏处理。
4. 将压缩后的上下文发送给 AI。
5. 返回根因候选、排查步骤、修复建议。

### 6.4 Neovim 集成

Neovim 可以作为 MyLogger 的高级日志查看和编辑前端。它不应该成为 MyLogger 的核心依赖，核心能力仍然放在 CLI/TUI 和分析引擎中；Neovim 更适合作为面向重度终端用户的插件形态。

可用场景：

| 场景 | 说明 |
|------|------|
| 日志查看器 | 用 Neovim 打开大日志文件，高亮 Error/Warn/Info/Debug、Exception、ANR、FATAL EXCEPTION、包名、Tag、PID |
| 分析结果查看 | MyLogger 生成 Markdown 报告后，用 Neovim 打开或分屏查看日志原文和分析摘要 |
| 交互式插件 | 在当前 buffer 内执行 `:MyLoggerAnalyze`、`:MyLoggerCapture`、`:MyLoggerNextError`、`:MyLoggerReport` |
| 自然语言入口 | 在 Neovim 中输入自然语言问题，将当前文件路径和问题发送给 MyLogger，再展示模型分析结果 |
| 规则配置编辑 | 用 Neovim 编辑 `.mylogger.yaml`，维护 Tag 分类、异常匹配、脱敏规则和报告模板 |

插件能力建议：

- 在当前 buffer 中高亮日志级别和关键异常。
- 支持跳转到下一个 Error、Exception、Crash、ANR。
- 支持 Telescope/FZF 集成，快速筛选 Tag、PID、异常和书签。
- 支持分屏展示日志原文、分析摘要、Markdown 报告。
- 支持将选中的日志片段发送给 MyLogger 分析。
- 支持通过浮窗展示简短结论，通过 split 展示完整报告。

命令设计示例：

```vim
:MyLoggerAnalyze
:MyLoggerCapture
:MyLoggerNextError
:MyLoggerReport
:MyLoggerAsk 分析当前日志里最近一次崩溃原因
```

推荐定位：核心先做 CLI/TUI，Neovim 插件作为后续增强。这样用户不安装 Neovim 也能使用 MyLogger，重度终端用户则可以获得更强的编辑、跳转和复盘体验。

## 7. 建议命令设计

```bash
# 分析本地文件
mylogger analyze app.log

# 实时分析 adb logcat
adb logcat -v threadtime | mylogger watch --format android --package com.example.app

# 从 Android 设备抓取日志；单设备自动抓取，多设备提示选择
mylogger capture --format android --package com.example.app

# 默认抓取到当前目录 123.txt，按 Ctrl+C 终止，结束时输出文件路径
mylogger capture

# 抓取到以当前时间命名的文件，按 Ctrl+C 终止，结束时输出文件路径
mylogger capture -t

# 指定设备抓取日志，适合多设备或脚本环境
mylogger capture --device R5CT123ABC --package com.example.app --output app.log

# 只看错误和异常
mylogger analyze app.log --level error --keyword Exception

# 生成 Markdown 报告
mylogger analyze app.log --report markdown --output report.md

# 使用个人规则
mylogger analyze app.log --rules ~/.mylogger/rules.yaml

# 导出结构化 JSON
mylogger analyze app.log --json > result.json
```

## 8. 配置文件设计

建议默认读取 `~/.mylogger/config.yaml`，项目级配置读取 `.mylogger.yaml`。

```yaml
default_format: auto
timezone: local

android:
  package: ""
  hide_system_logs: true
  highlight_tags:
    - AndroidRuntime
    - ActivityManager
    - Choreographer

filters:
  exclude_tags:
    - Chatty
    - OpenGLRenderer
  min_level: info

privacy:
  mask_email: true
  mask_phone: true
  mask_token: true
```

## 9. 技术架构建议

```text
Input Layer
  ├── File Reader
  ├── Stdin Reader
  ├── Tail Reader
  ├── Android Device Reader
  └── Compressed Reader

Device Layer
  ├── ADB Device Detector
  ├── Device Selector
  └── Logcat Capture Runner

Parse Layer
  ├── Format Detector
  ├── Android Parser
  ├── JSON Parser
  ├── Plain Text Parser
  └── Custom Regex Parser

Analysis Layer
  ├── Search Engine
  ├── Filter Engine
  ├── Exception Detector
  ├── Statistics Engine
  ├── Rule Engine
  └── Privacy Masker

Presentation Layer
  ├── CLI Output
  ├── TUI View
  ├── Markdown Report
  ├── JSON Output
  └── Neovim Plugin
```

## 10. 数据结构草案

```text
LogEntry
  timestamp: optional datetime
  level: trace | debug | info | warn | error | fatal | unknown
  source: file name or stream name
  pid: optional number
  tid: optional number
  tag: optional string
  message: string
  raw: original line
  fields: map<string, value>

Issue
  type: crash | anr | exception | performance | custom
  severity: low | medium | high | critical
  title: string
  first_seen: optional datetime
  last_seen: optional datetime
  count: number
  evidence: related log entries
  suggestion: optional string
```

## 11. MVP 范围

第一版建议只做以下能力，避免一开始范围过大：

1. 读取本地文件和标准输入。
2. 自动识别 Android logcat 和普通文本。
3. 支持级别、Tag、PID、关键词、正则过滤。
4. 彩色输出 Error/Warn/Info。
5. 自动提取 Java/Kotlin 异常堆栈。
6. 输出错误摘要和 Top Tag 统计。
7. 支持 Markdown 报告导出。
8. 提供简单 YAML 规则配置。
9. 支持 Android 日志抓取：单设备自动抓取，多设备提示选择。

## 12. 版本路线图

| 版本 | 目标 | 主要功能 |
|------|------|----------|
| v0.1 | 可用 CLI | 文件/stdin 输入、基础解析、搜索过滤、彩色输出 |
| v0.2 | Android 好用 | ADB 日志抓取、设备选择、包名/PID/Tag 过滤、Crash 提取、错误摘要 |
| v0.3 | 报告化 | Markdown/JSON 导出、脱敏、统计摘要 |
| v0.4 | 规则化 | 自定义规则、场景模板、重复异常聚合 |
| v0.5 | 交互化 | TUI 浏览、跳转、书签、时间线 |
| v0.6 | 编辑器集成 | Neovim 插件、日志高亮、跳转、分屏报告、自然语言分析入口 |
| v1.0 | 稳定版 | 配置体系、插件接口、文档、测试覆盖 |

## 13. 风险与取舍

| 风险 | 说明 | 建议 |
|------|------|------|
| 功能范围过大 | 日志工具容易扩展成平台级系统 | 先做本地 CLI，不急着做服务端 |
| 大文件性能 | 全量读入内存会很快遇到瓶颈 | 从第一版就采用流式读取 |
| 格式碎片化 | 不同团队日志格式差异很大 | 内置常见格式，自定义规则兜底 |
| Android 场景复杂 | Crash、ANR、性能日志类型很多 | 先覆盖最常见的 Java Crash 和 Tag 过滤 |
| AI 成本与隐私 | 原始日志可能包含敏感数据 | 必须先做本地摘要和脱敏 |

## 14. 推荐下一步

1. 确定技术栈：Rust、Go、Python、Node.js 中选择一种。
2. 先实现 CLI MVP，不急于做 GUI。
3. 定义 `LogEntry` 和 `Issue` 两个核心数据模型。
4. 实现 Android `threadtime` 格式解析。
5. 做一份真实 logcat 样例作为测试数据。
6. 为每个解析器和异常识别规则补单元测试。
7. 在 CLI/TUI 稳定后，再设计 Neovim 插件协议和命令。
