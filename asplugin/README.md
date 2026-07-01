# MyLogger Android Studio Plugin

这个插件用于从 Android Studio 内部读取当前项目的真实断点信息，并导出为 JSON，供 MyLogger 后续分析。

## 构建

```bash
cd asplugin
gradle buildPlugin
```

插件产物位于：

```bash
asplugin/build/distributions/mylogger-as-plugin-0.1.0.zip
```

## 安装

在 Android Studio 中安装：

1. 打开 `Settings | Plugins`
2. 点击齿轮菜单
3. 选择 `Install Plugin from Disk...`
4. 选择 `asplugin/build/distributions/mylogger-as-plugin-0.1.0.zip`
5. 重启 Android Studio

## 使用

打开目标 Android 工程后，执行：

```text
Tools > MyLogger > Export Breakpoints
```

选择保存路径后，插件会导出 `mylogger-breakpoints.json`。导出字段包括：

- 断点类型
- 文件路径和相对路径
- 行号
- 是否启用
- 条件表达式
- 日志表达式
- suspend 策略
- 是否临时断点
- 时间戳
