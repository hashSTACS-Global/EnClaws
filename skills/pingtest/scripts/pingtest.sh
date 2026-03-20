#!/usr/bin/env bash
# PingTest Skill - Simple echo with timestamp
# Usage: pingtest "message" or echo "message" | pingtest

# Read input from argument or stdin
if [ $# -ge 1 ]; then
    INPUT="$*"
else
    INPUT=$(cat)
fi

# Get current timestamp in readable format
TIMESTAMP=$(date "+%Y-%m-%d %H:%M:%S %Z")

# Output with timestamp
echo "[$TIMESTAMP] Echo: $INPUT"
