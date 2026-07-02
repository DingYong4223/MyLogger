#!/usr/bin/env python3
"""Extract source code lines for Android Studio breakpoint export JSON."""

from pathlib import Path
import argparse
import ast
import json
import re
import sys
import zipfile
from urllib.parse import unquote, urlparse


DEFAULT_CONTEXT_LINES = 3
STRING_LITERAL_RE = re.compile(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'')
LOG_CALL_RE = re.compile(
    r"\b(?P<owner>SLLogger|Log|L|Logger|Timber|Logan|KLog|LogUtils|LogUtil|MLog|MTLog|XLog)"
    r"(?:\s*\.\s*(?P<method>[A-Za-z_][A-Za-z0-9_]*))?\s*\("
)
ANDROID_LOG_LEVELS = {"v", "d", "i", "w", "e", "wtf", "println"}
COMMON_LOG_LEVELS = {
    "v",
    "d",
    "i",
    "w",
    "e",
    "debug",
    "info",
    "warn",
    "warning",
    "error",
    "verbose",
}


def analyze_breakpoints_file(file_path, context_lines=DEFAULT_CONTEXT_LINES, compact=True):
    path = resolve_local_path(file_path)
    if not path.is_file():
        return {
            "path": str(path),
            "error": "file_not_found",
            "message": f"BreakPoints file does not exist: {path}",
            "items": [],
        }

    try:
        data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except json.JSONDecodeError as exc:
        return {
            "path": str(path),
            "error": "invalid_json",
            "message": f"BreakPoints file is not valid JSON: {exc.msg}",
            "items": [],
        }

    return analyze_breakpoints_data(data, path=str(path), context_lines=context_lines, compact=compact)


def analyze_breakpoints_content(content, source_name="<payload>", context_lines=DEFAULT_CONTEXT_LINES, compact=True):
    try:
        data = json.loads(content)
    except json.JSONDecodeError as exc:
        return {
            "path": source_name,
            "error": "invalid_json",
            "message": f"BreakPoints content is not valid JSON: {exc.msg}",
            "items": [],
        }

    return analyze_breakpoints_data(data, path=source_name, context_lines=context_lines, compact=compact)


def analyze_breakpoints_data(data, path, context_lines=DEFAULT_CONTEXT_LINES, compact=True):
    breakpoints = data.get("breakpoints") if isinstance(data, dict) else None
    if not isinstance(breakpoints, list):
        return {
            "path": path,
            "error": "invalid_breakpoints_schema",
            "message": "BreakPoints JSON must contain a breakpoints array.",
            "items": [],
        }

    project = data.get("project") if isinstance(data.get("project"), dict) else {}
    project_base_path = project.get("basePath")
    schema_version = data.get("schemaVersion")
    items = [
        analyze_breakpoint_source(breakpoint, project_base_path, context_lines, schema_version)
        for breakpoint in breakpoints
        if isinstance(breakpoint, dict)
    ]
    if compact:
        return compact_log_strings_result(items)
    return {
        "path": path,
        "schemaVersion": data.get("schemaVersion"),
        "exportedAt": data.get("exportedAt"),
        "project": project,
        "count": len(items),
        "items": items,
    }


def compact_log_strings_result(items):
    log_strings = []
    seen = set()
    for item in items:
        for value in item.get("logStrings", []):
            if value and value not in seen:
                log_strings.append(value)
                seen.add(value)
    return {
        "logStrings": log_strings,
    }


def analyze_breakpoint_source(breakpoint, project_base_path, context_lines=DEFAULT_CONTEXT_LINES, schema_version=None):
    source_ref = resolve_breakpoint_source_ref(breakpoint, project_base_path)
    line = breakpoint.get("line")
    source_index, source_line = normalize_breakpoint_line(line, schema_version)
    result = {
        "typeId": breakpoint.get("typeId"),
        "typeTitle": breakpoint.get("typeTitle"),
        "enabled": breakpoint.get("enabled"),
        "line": line,
        "sourceLine": source_line,
        "filePath": source_ref_display(source_ref) if source_ref else breakpoint.get("filePath"),
        "fileUrl": breakpoint.get("fileUrl"),
        "relativePath": breakpoint.get("relativePath"),
        "presentableFilePath": breakpoint.get("presentableFilePath"),
        "shortFilePath": breakpoint.get("shortFilePath"),
        "condition": breakpoint.get("condition"),
        "logExpression": breakpoint.get("logExpression"),
        "code": None,
        "logStrings": [],
        "context": [],
    }

    if source_ref is None:
        result["error"] = "missing_source_path"
        return result
    if source_index is None:
        result["error"] = "invalid_line"
        result["message"] = f"Invalid breakpoint line: {line}"
        return result

    source_lines, error = read_source_lines(source_ref)
    if error:
        result.update(error)
        return result
    if source_index >= len(source_lines):
        result["error"] = "line_out_of_range"
        result["message"] = f"Breakpoint line {line} is outside source file with {len(source_lines)} lines."
        return result

    start = max(0, source_index - context_lines)
    end = min(len(source_lines), source_index + context_lines + 1)
    result["code"] = source_lines[source_index]
    result["logStrings"] = extract_log_strings(source_lines[source_index])
    result["context"] = [
        {
            "line": index,
            "sourceLine": index + 1,
            "code": source_lines[index],
            "breakpoint": index == source_index,
        }
        for index in range(start, end)
    ]
    return result


def normalize_breakpoint_line(line, schema_version):
    if not isinstance(line, int):
        return None, None
    if is_one_based_line_schema(schema_version):
        if line < 1:
            return None, None
        return line - 1, line
    if line < 0:
        return None, None
    return line, line + 1


def is_one_based_line_schema(schema_version):
    try:
        return int(schema_version) >= 2
    except (TypeError, ValueError):
        return False


def extract_log_strings(code):
    if not code:
        return []

    log_strings = extract_known_logger_strings(code)
    if log_strings:
        return log_strings

    strings = []
    seen = set()
    for match in STRING_LITERAL_RE.finditer(code):
        value = decode_string_literal(match.group(0))
        if not value or value in seen:
            continue
        strings.append(value)
        seen.add(value)
        if is_followed_by_concat_operator(code, match.end()):
            break
    return strings


def extract_known_logger_strings(code):
    strings = []
    seen = set()
    for match in LOG_CALL_RE.finditer(code):
        owner = match.group("owner")
        method = match.group("method") or ""
        args_text = extract_call_args(code, match.end() - 1)
        if args_text is None:
            continue

        args = split_top_level_args(args_text)
        indexes = log_message_arg_indexes(owner, method, args)
        for index in indexes:
            if index >= len(args):
                continue
            for value in extract_strings_from_expression(args[index]):
                if value and value not in seen:
                    strings.append(value)
                    seen.add(value)
        if strings:
            break
    return strings


def log_message_arg_indexes(owner, method, args):
    if owner == "Log":
        if method == "println":
            return [2]
        if method in ANDROID_LOG_LEVELS:
            return [1]
    if owner in {"L", "KLog", "LogUtils", "LogUtil", "MLog", "MTLog", "XLog", "Timber"}:
        if method in COMMON_LOG_LEVELS or method in ANDROID_LOG_LEVELS:
            return [1] if len(args) > 1 else [0]
    if owner == "Logger":
        if method in COMMON_LOG_LEVELS or not method:
            return [0]
    if owner == "SLLogger":
        return sl_logger_message_arg_indexes(args)
    if owner == "Logan":
        return logan_message_arg_indexes(args)
    return []


def sl_logger_message_arg_indexes(args):
    if not args:
        return []
    if len(args) == 1:
        return [0]

    if looks_like_throwable_arg(args[0].strip()):
        return [2] if len(args) > 2 else [1]
    if len(args) > 2 and looks_like_throwable_arg(args[1].strip()):
        return [2]
    return [1]


def logan_message_arg_indexes(args):
    indexes = []
    for index, arg in enumerate(args):
        if index < 2:
            continue
        if extract_strings_from_expression(arg):
            indexes.append(index)
    return indexes


def looks_like_throwable_arg(arg):
    return arg in {"e", "t", "throwable", "exception"} or arg.endswith("Exception") or arg.endswith("Throwable")


def extract_call_args(code, open_paren_index):
    depth = 0
    quote = None
    escaped = False
    for index in range(open_paren_index, len(code)):
        char = code[index]
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in {'"', "'"}:
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return code[open_paren_index + 1:index]
    return None


def split_top_level_args(args_text):
    args = []
    start = 0
    depth = 0
    quote = None
    escaped = False
    for index, char in enumerate(args_text):
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in {'"', "'"}:
            quote = char
        elif char in "([{":
            depth += 1
        elif char in ")]}":
            depth = max(0, depth - 1)
        elif char == "," and depth == 0:
            args.append(args_text[start:index].strip())
            start = index + 1
    tail = args_text[start:].strip()
    if tail:
        args.append(tail)
    return args


def extract_strings_from_expression(expression):
    values = []
    for match in STRING_LITERAL_RE.finditer(expression):
        value = decode_string_literal(match.group(0))
        if value:
            values.append(value)
        if is_followed_by_concat_operator(expression, match.end()):
            break
    return values


def is_followed_by_concat_operator(code, index):
    cursor = index
    while cursor < len(code) and code[cursor].isspace():
        cursor += 1
    return cursor < len(code) and code[cursor] == "+"


def decode_string_literal(token):
    try:
        value = ast.literal_eval(token)
        return value if isinstance(value, str) else str(value)
    except (SyntaxError, ValueError):
        return token[1:-1]


def resolve_breakpoint_source_ref(breakpoint, project_base_path):
    file_path = breakpoint.get("filePath")
    if file_path:
        jar_ref = parse_jar_ref(file_path)
        if jar_ref:
            return jar_ref
        return {"kind": "file", "path": Path(file_path).expanduser().resolve()}

    relative_path = breakpoint.get("relativePath")
    if relative_path and project_base_path:
        return {"kind": "file", "path": (Path(project_base_path).expanduser() / relative_path).resolve()}

    file_url = breakpoint.get("fileUrl")
    if file_url:
        jar_ref = parse_jar_ref(file_url)
        if jar_ref:
            return jar_ref
        parsed = urlparse(file_url)
        if parsed.scheme == "file":
            return {"kind": "file", "path": Path(unquote(parsed.path)).expanduser().resolve()}
    return None


def parse_jar_ref(value):
    if "!/" not in value:
        return None

    raw = value
    if raw.startswith("jar://"):
        raw = raw[len("jar://"):]
    elif raw.startswith("jar:file://"):
        raw = raw[len("jar:file://"):]

    archive, entry = raw.split("!/", 1)
    archive = unquote(archive)
    entry = unquote(entry)
    return {
        "kind": "jar",
        "path": Path(archive).expanduser().resolve(),
        "entry": entry,
    }


def source_ref_display(source_ref):
    if source_ref["kind"] == "jar":
        return f"{source_ref['path']}!/{source_ref['entry']}"
    return str(source_ref["path"])


def read_source_lines(source_ref):
    if source_ref["kind"] == "file":
        path = source_ref["path"]
        if not path.is_file():
            return None, {
                "error": "source_file_not_found",
                "message": f"Source file does not exist: {path}",
            }
        return path.read_text(encoding="utf-8", errors="replace").splitlines(), None

    if source_ref["kind"] == "jar":
        archive = source_ref["path"]
        entry = source_ref["entry"]
        if not archive.is_file():
            return None, {
                "error": "source_archive_not_found",
                "message": f"Source archive does not exist: {archive}",
            }
        try:
            with zipfile.ZipFile(archive) as jar:
                try:
                    data = jar.read(entry)
                except KeyError:
                    return None, {
                        "error": "source_entry_not_found",
                        "message": f"Source entry does not exist in archive: {entry}",
                    }
        except zipfile.BadZipFile:
            return None, {
                "error": "invalid_source_archive",
                "message": f"Source archive is not a valid zip/jar file: {archive}",
            }
        return data.decode("utf-8", errors="replace").splitlines(), None

    return None, {
        "error": "unsupported_source_ref",
        "message": f"Unsupported source reference: {source_ref}",
    }


def resolve_local_path(file_path):
    path = Path(file_path).expanduser()
    if not path.is_absolute():
        path = Path.cwd() / path
    return path.resolve()


def format_text(result):
    lines = [
        f"BreakPoints: {result.get('path')}",
        f"Project: {(result.get('project') or {}).get('name') or ''}",
        f"Count: {result.get('count', 0)}",
        "",
    ]
    for index, item in enumerate(result.get("items", []), 1):
        title = item.get("typeTitle") or item.get("typeId") or "Breakpoint"
        location = item.get("filePath") or item.get("presentableFilePath") or "<no source>"
        source_line = item.get("sourceLine")
        lines.append(f"[{index}] {title}")
        lines.append(f"enabled: {item.get('enabled')} line: {source_line}")
        lines.append(f"path: {location}")
        if item.get("error"):
            lines.append(f"error: {item.get('error')} {item.get('message') or ''}".rstrip())
        else:
            if item.get("logStrings"):
                lines.append(f"logStrings: {', '.join(item.get('logStrings'))}")
            for context in item.get("context", []):
                marker = ">" if context.get("breakpoint") else " "
                lines.append(f"{marker} {context.get('sourceLine'):>5}: {context.get('code')}")
        lines.append("")
    return "\n".join(lines)


def write_output(content, output_path):
    if output_path:
        Path(output_path).expanduser().write_text(content, encoding="utf-8")
    else:
        sys.stdout.write(content)
        if not content.endswith("\n"):
            sys.stdout.write("\n")


def main():
    parser = argparse.ArgumentParser(
        description="Extract source code for breakpoints exported by the MyLogger Android Studio plugin."
    )
    parser.add_argument("breakpoints_json", help="Path to mylogger-breakpoints.json")
    parser.add_argument("--context", type=int, default=DEFAULT_CONTEXT_LINES, help="Context lines around each breakpoint")
    parser.add_argument("--format", choices=("json", "text"), default="json", help="Output format")
    parser.add_argument("--detail", action="store_true", help="Include breakpoint metadata, source code, and context")
    parser.add_argument("--output", "-o", help="Write output to a file instead of stdout")
    args = parser.parse_args()

    result = analyze_breakpoints_file(
        args.breakpoints_json,
        context_lines=max(0, args.context),
        compact=not args.detail,
    )
    if args.format == "json":
        content = json.dumps(result, ensure_ascii=False, indent=2)
    else:
        content = format_text(result)
    write_output(content, args.output)

    return 1 if result.get("error") else 0


if __name__ == "__main__":
    raise SystemExit(main())
