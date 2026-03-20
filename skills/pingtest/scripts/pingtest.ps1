# PingTest Skill - PowerShell version
# Simple echo with timestamp for connectivity testing

param(
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$MessageParts
)

# Read input from argument or pipeline
if ($MessageParts -and $MessageParts.Count -gt 0) {
    $INPUT = $MessageParts -join ' '
} else {
    $INPUT = [Console]::In.ReadToEnd().Trim()
}

# Get current timestamp in readable format
$TIMESTAMP = Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"

# Output with timestamp
Write-Output "[$TIMESTAMP] Echo: $INPUT"
