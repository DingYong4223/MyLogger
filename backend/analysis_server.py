#!/usr/bin/env python3
"""Demo backend analysis service for the MyLogger Chrome extension."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import argparse
import json

from extract_breakpoint_sources import (
    analyze_breakpoints_content,
)


class AnalysisHandler(BaseHTTPRequestHandler):
    server_version = "MyLoggerAnalysisDemo/0.1"

    def do_OPTIONS(self):
        self._send_empty(204)

    def do_POST(self):
        if self.path != "/analyze":
            self._send_json(404, {"error": "not_found", "message": "Use POST /analyze"})
            return

        try:
            payload = self._read_json()
            breakpoints_content = str(payload.get("breakpointsContent") or "")
            if not breakpoints_content:
                self._send_json(400, {
                    "error": "missing_breakpoints_content",
                    "message": "breakpointsContent is required",
                })
                return

            breakpoints_source_name = payload.get("breakpointsFileName") or "<payload>"
            breakpoint_analysis = analyze_breakpoints_content(
                breakpoints_content,
                source_name=breakpoints_source_name,
            )
            result = {
                "breakpointsFileNameFromPlugin": payload.get("breakpointsFileName") or "",
                "breakpointsContentFromPlugin": bool(breakpoints_content),
                "breakpoints": breakpoint_analysis,
            }
            self._send_json(200, result)
        except json.JSONDecodeError:
            self._send_json(400, {"error": "invalid_json", "message": "Request body must be JSON"})
        except Exception as exc:
            self._send_json(500, {"error": "internal_error", "message": str(exc)})

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} - {fmt % args}")

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        data = self.rfile.read(length)
        return json.loads(data.decode("utf-8"))

    def _send_empty(self, status):
        self.send_response(status)
        self._send_common_headers()
        self.end_headers()

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self._send_common_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_common_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")


def main():
    parser = argparse.ArgumentParser(description="Start the MyLogger demo analysis backend.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7878)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), AnalysisHandler)
    print(f"MyLogger analysis demo listening on http://{args.host}:{args.port}/analyze")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping MyLogger analysis demo.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
