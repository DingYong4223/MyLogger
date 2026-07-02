#!/usr/bin/env python3
"""Extract source code lines for Android Studio breakpoint export JSON."""

from pathlib import Path
import argparse
import json
import sys
import zipfile
from urllib.parse import unquote, urlparse


DEFAULT_CONTEXT_LINES = 3


def analyze_breakpoints_file(file_path, context_lines=DEFAULT_CONTEXT_LINES):
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

    return analyze_breakpoints_data(data, path=str(path), context_lines=context_lines)


def analyze_breakpoints_content(content, source_name="<payload>", context_lines=DEFAULT_CONTEXT_LINES):
    try:
        data = json.loads(content)
    except json.JSONDecodeError as exc:
        return {
            "path": source_name,
            "error": "invalid_json",
            "message": f"BreakPoints content is not valid JSON: {exc.msg}",
            "items": [],
        }

    return analyze_breakpoints_data(data, path=source_name, context_lines=context_lines)


def analyze_breakpoints_data(data, path, context_lines=DEFAULT_CONTEXT_LINES):
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
    items = [
        analyze_breakpoint_source(breakpoint, project_base_path, context_lines)
        for breakpoint in breakpoints
        if isinstance(breakpoint, dict)
    ]
    return {
        "path": path,
        "schemaVersion": data.get("schemaVersion"),
        "exportedAt": data.get("exportedAt"),
        "project": project,
        "count": len(items),
        "items": items,
    }


def analyze_breakpoint_source(breakpoint, project_base_path, context_lines=DEFAULT_CONTEXT_LINES):
    source_ref = resolve_breakpoint_source_ref(breakpoint, project_base_path)
    line = breakpoint.get("line")
    result = {
        "typeId": breakpoint.get("typeId"),
        "typeTitle": breakpoint.get("typeTitle"),
        "enabled": breakpoint.get("enabled"),
        "line": line,
        "sourceLine": line + 1 if isinstance(line, int) and line >= 0 else None,
        "filePath": source_ref_display(source_ref) if source_ref else breakpoint.get("filePath"),
        "fileUrl": breakpoint.get("fileUrl"),
        "relativePath": breakpoint.get("relativePath"),
        "presentableFilePath": breakpoint.get("presentableFilePath"),
        "shortFilePath": breakpoint.get("shortFilePath"),
        "condition": breakpoint.get("condition"),
        "logExpression": breakpoint.get("logExpression"),
        "code": None,
        "context": [],
    }

    if source_ref is None:
        result["error"] = "missing_source_path"
        return result
    if not isinstance(line, int) or line < 0:
        result["error"] = "invalid_line"
        result["message"] = f"Invalid breakpoint line: {line}"
        return result

    source_lines, error = read_source_lines(source_ref)
    if error:
        result.update(error)
        return result
    if line >= len(source_lines):
        result["error"] = "line_out_of_range"
        result["message"] = f"Breakpoint line {line} is outside source file with {len(source_lines)} lines."
        return result

    start = max(0, line - context_lines)
    end = min(len(source_lines), line + context_lines + 1)
    result["code"] = source_lines[line]
    result["context"] = [
        {
            "line": index,
            "sourceLine": index + 1,
            "code": source_lines[index],
            "breakpoint": index == line,
        }
        for index in range(start, end)
    ]
    return result


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
    parser.add_argument("--output", "-o", help="Write output to a file instead of stdout")
    args = parser.parse_args()

    result = analyze_breakpoints_file(args.breakpoints_json, context_lines=max(0, args.context))
    if args.format == "json":
        content = json.dumps(result, ensure_ascii=False, indent=2)
    else:
        content = format_text(result)
    write_output(content, args.output)

    return 1 if result.get("error") else 0


if __name__ == "__main__":
    raise SystemExit(main())
