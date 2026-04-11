#!/usr/bin/env python3
"""Echo prepare step: reads stdin JSON, returns a transformed output."""
import json
import sys


def main():
    payload = json.loads(sys.stdin.read())
    message = payload.get("input", {}).get("message", "")
    output = {
        "output": {
            "message": message.upper(),
            "length": len(message),
        }
    }
    sys.stdout.write(json.dumps(output))


if __name__ == "__main__":
    main()
