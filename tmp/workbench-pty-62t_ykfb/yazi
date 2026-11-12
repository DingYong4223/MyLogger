#!/usr/bin/env python3
"""File chooser substitute for the workbench PTY regression."""
import json, os, sys
from pathlib import Path

root = Path(os.environ['MYLOGGER_FAKE_ROOT'])
assert sys.argv[1] == '--chooser-file', sys.argv
with (root/'yazi-calls.jsonl').open('a') as out:
    out.write(json.dumps(sys.argv[1:])+'\n')
selection = (root/'yazi-selection').read_text()
if selection == 'FAIL':
    sys.exit(2)
if selection:
    Path(sys.argv[2]).write_text(selection)
