package com.dingyong.mylogger.asplugin

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.fileChooser.FileChooserFactory
import com.intellij.openapi.fileChooser.FileSaverDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.xdebugger.XDebuggerManager
import com.intellij.xdebugger.XExpression
import com.intellij.xdebugger.breakpoints.XBreakpoint
import com.intellij.xdebugger.breakpoints.XLineBreakpoint
import java.nio.charset.StandardCharsets
import java.time.Instant

class ExportBreakpointsAction : AnAction() {
    override fun actionPerformed(event: AnActionEvent) {
        val project = event.project
        if (project == null) {
            Messages.showErrorDialog("No active project.", "MyLogger")
            return
        }

        val target = chooseTargetFile(project) ?: return
        val breakpoints = XDebuggerManager
            .getInstance(project)
            .breakpointManager
            .allBreakpoints
            .sortedWith(compareBy({ breakpointPath(it) }, { breakpointLine(it) ?: -1 }))

        val json = BreakpointJsonExporter.export(project, breakpoints)
        target.file.writeBytes(json.toByteArray(StandardCharsets.UTF_8))

        Messages.showInfoMessage(
            project,
            "Exported ${breakpoints.size} breakpoint(s) to:\n${target.file.path}",
            "MyLogger"
        )
    }

    override fun update(event: AnActionEvent) {
        event.presentation.isEnabledAndVisible = event.project != null
    }

    private fun chooseTargetFile(project: Project) =
        FileChooserFactory
            .getInstance()
            .createSaveFileDialog(
                FileSaverDescriptor("Export MyLogger Breakpoints", "Save breakpoint metadata as JSON", "json"),
                project
            )
            .save(project.baseDir, "mylogger-breakpoints.json")
}

private object BreakpointJsonExporter {
    fun export(project: Project, breakpoints: List<XBreakpoint<*>>): String {
        return buildString {
            appendLine("{")
            appendLine("  \"schemaVersion\": 2,")
            appendLine("  \"exportedAt\": ${Instant.now().toString().json()},")
            appendLine("  \"project\": {")
            appendLine("    \"name\": ${project.name.json()},")
            appendLine("    \"basePath\": ${project.basePath.json()}")
            appendLine("  },")
            appendLine("  \"breakpoints\": [")
            breakpoints.forEachIndexed { index, breakpoint ->
                appendBreakpoint(project, breakpoint, "    ")
                if (index != breakpoints.lastIndex) {
                    appendLine(",")
                } else {
                    appendLine()
                }
            }
            appendLine("  ]")
            appendLine("}")
        }
    }

    private fun StringBuilder.appendBreakpoint(project: Project, breakpoint: XBreakpoint<*>, indent: String) {
        val lineBreakpoint = breakpoint as? XLineBreakpoint<*>
        val sourcePosition = breakpoint.sourcePosition
        val fileUrl = lineBreakpoint?.fileUrl ?: sourcePosition?.file?.url
        val absolutePath = fileUrl?.let(::urlToPath)

        appendLine("${indent}{")
        appendLine("$indent  \"typeId\": ${breakpoint.type.id.json()},")
        appendLine("$indent  \"typeTitle\": ${breakpoint.type.title.json()},")
        appendLine("$indent  \"enabled\": ${breakpoint.isEnabled},")
        appendLine("$indent  \"line\": ${sourceLine(lineBreakpoint, sourcePosition)},")
        appendLine("$indent  \"fileUrl\": ${fileUrl.json()},")
        appendLine("$indent  \"filePath\": ${absolutePath.json()},")
        appendLine("$indent  \"relativePath\": ${relativePath(project, absolutePath).json()},")
        appendLine("$indent  \"presentableFilePath\": ${lineBreakpoint?.presentableFilePath.json()},")
        appendLine("$indent  \"shortFilePath\": ${lineBreakpoint?.shortFilePath.json()},")
        appendLine("$indent  \"temporary\": ${lineBreakpoint?.isTemporary ?: false},")
        appendLine("$indent  \"suspendPolicy\": ${breakpoint.suspendPolicy.name.json()},")
        appendLine("$indent  \"logMessage\": ${breakpoint.isLogMessage},")
        appendLine("$indent  \"logStack\": ${breakpoint.isLogStack},")
        appendLine("$indent  \"logExpression\": ${breakpoint.logExpressionObject.expressionText().json()},")
        appendLine("$indent  \"condition\": ${breakpoint.conditionExpression.expressionText().json()},")
        appendLine("$indent  \"timestamp\": ${breakpoint.timeStamp}")
        append("$indent}")
    }

    private fun urlToPath(url: String): String {
        return VfsUtilCore.urlToPath(url)
    }

    private fun sourceLine(lineBreakpoint: XLineBreakpoint<*>?, sourcePosition: com.intellij.xdebugger.XSourcePosition?): Int? {
        return (lineBreakpoint?.line ?: sourcePosition?.line)?.plus(1)
    }

    private fun relativePath(project: Project, absolutePath: String?): String? {
        val basePath = project.basePath ?: return null
        if (absolutePath == null) return null
        return absolutePath
            .removePrefix("$basePath/")
            .takeIf { it != absolutePath }
    }
}

private fun breakpointPath(breakpoint: XBreakpoint<*>): String {
    return ((breakpoint as? XLineBreakpoint<*>)?.fileUrl ?: breakpoint.sourcePosition?.file?.url).orEmpty()
}

private fun breakpointLine(breakpoint: XBreakpoint<*>): Int? {
    return (breakpoint as? XLineBreakpoint<*>)?.line ?: breakpoint.sourcePosition?.line
}

private fun XExpression?.expressionText(): String? = this?.expression?.takeIf { it.isNotBlank() }

private fun String?.json(): String {
    if (this == null) return "null"
    return buildString {
        append('"')
        for (char in this@json) {
            when (char) {
                '\\' -> append("\\\\")
                '"' -> append("\\\"")
                '\b' -> append("\\b")
                '\u000C' -> append("\\f")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> {
                    if (char.code < 0x20) {
                        append("\\u")
                        append(char.code.toString(16).padStart(4, '0'))
                    } else {
                        append(char)
                    }
                }
            }
        }
        append('"')
    }
}
