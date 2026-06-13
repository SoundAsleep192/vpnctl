#!/usr/bin/env python3
"""Claude Code PostToolUse hook: fail-closed safety reminder for killswitch core files.

Non-blocking. When an edit touches a fail-closed core file, inject a reminder
(via additionalContext) to re-verify block-by-default behavior. See AGENTS.md Safety.
"""

import json
import os
import sys

DANGER_FILES = {
    "src/core/pf-anchor.ts",
    "src/core/pf-conf-patch.ts",
    "src/core/sinkhole.ts",
    "src/core/dns-refresh.ts",
}

try:
    payload = json.load(sys.stdin)
except Exception:
    sys.exit(0)

file_path = payload.get("tool_input", {}).get("file_path", "")
if not file_path:
    sys.exit(0)

project_dir = os.environ.get("CLAUDE_PROJECT_DIR", "")
if project_dir and os.path.isabs(file_path):
    relative_path = os.path.relpath(file_path, project_dir)
else:
    relative_path = file_path
relative_path = relative_path.lstrip("./")

if relative_path in DANGER_FILES:
    message = (
        f"Fail-closed safety check: you edited {relative_path}, a killswitch core file. "
        "Confirm block-by-default still holds when the tunnel is down or a DNS lookup fails "
        "(AGENTS.md Safety). Call out explicitly if this change could weaken fail-closed behavior."
    )
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PostToolUse",
                    "additionalContext": message,
                }
            }
        )
    )

sys.exit(0)
