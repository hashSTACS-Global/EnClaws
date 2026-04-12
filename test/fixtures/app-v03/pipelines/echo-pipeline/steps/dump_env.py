#!/usr/bin/env python3
import json
import os
import sys

def main():
    user_map_raw = os.environ.get("PIVOT_USER_MAP", "")
    sys.stdout.write(json.dumps({"output": {"user_map_raw": user_map_raw}}))

if __name__ == "__main__":
    main()
