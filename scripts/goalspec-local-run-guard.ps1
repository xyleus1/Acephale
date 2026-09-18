param(
  [Parameter(Mandatory=$true)][string]$OutputDirectory,
  [Parameter(Mandatory=$true)][string[]]$Command,
  [string]$PythonExecutable = 'python',
  [double]$HeartbeatSeconds = 1,
  [double]$GapSeconds = 5
)
$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent
$guard = Join-Path $workspace 'research/goalspec/scripts/local_run_guard.py'
# Windows PowerShell strips embedded quotes when forwarding native argv. Base64
# transports the JSON array without shell evaluation or command/environment logs.
$guardCommandJson = ConvertTo-Json -InputObject @($Command) -Compress
$guardCommandBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($guardCommandJson))
& $PythonExecutable -B $guard --output-dir $OutputDirectory --heartbeat-seconds $HeartbeatSeconds --gap-seconds $GapSeconds --command-base64 $guardCommandBase64
exit $LASTEXITCODE
