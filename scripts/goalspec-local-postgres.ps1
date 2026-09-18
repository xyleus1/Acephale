param(
  [ValidateSet('start','stop','status','initialize')][string]$Action = 'status',
  [string]$PostgresRoot = 'C:/Program Files/PostgreSQL/17',
  [string]$BuildToolsRoot = 'C:/Program Files (x86)/Microsoft Visual Studio/2019/BuildTools'
)
$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent
$runRoot = Join-Path $workspace 'research/goalspec/runs'
$portableRoot = Join-Path $runRoot 'pg17-local-v1'
$clusterRoot = Join-Path $runRoot 'pg-research-local-v1'
$vectorRoot = Join-Path $runRoot 'pgvector-v0.8.6'
$pgctl = Join-Path $portableRoot 'bin/pg_ctl.exe'
function Assert-NativeSuccess([string]$Description) { if ($LASTEXITCODE -ne 0) { throw "$Description failed with exit code $LASTEXITCODE" } }
if ($Action -eq 'initialize') {
  if (Test-Path (Join-Path $clusterRoot 'PG_VERSION')) { throw 'Local research cluster already exists. Use start or status.' }
  if (!(Test-Path (Join-Path $PostgresRoot 'include/server/postgres.h'))) { throw 'PostgreSQL17 development headers are required.' }
  if (!(Test-Path $vectorRoot)) { & git clone --depth 1 --branch v0.8.6 https://github.com/pgvector/pgvector.git $vectorRoot; Assert-NativeSuccess 'pgvector checkout' }
  $revision = (& git -C $vectorRoot rev-parse HEAD).Trim()
  if ($revision -ne '8ee86c96f0fd72390f890aa8a336fda6d3ab4c6c') { throw 'Pinned pgvector source revision mismatch.' }
  $sdkRoot = Join-Path $runRoot 'windows-sdk-26100'
  foreach ($package in @('microsoft.windows.sdk.cpp','microsoft.windows.sdk.cpp.x64')) {
    $packageRoot = Join-Path $sdkRoot $package
    if (!(Test-Path $packageRoot)) {
      New-Item -ItemType Directory -Path $sdkRoot -Force | Out-Null
      $archive = Join-Path $sdkRoot "$package.zip"
      Invoke-WebRequest -UseBasicParsing -Uri "https://api.nuget.org/v3-flatcontainer/$package/10.0.26100.1/$package.10.0.26100.1.nupkg" -OutFile $archive
      Expand-Archive -LiteralPath $archive -DestinationPath $packageRoot
    }
  }
  $oldInclude = $env:INCLUDE; $oldLib = $env:LIB
  try {
    $env:INCLUDE = "$sdkRoot\microsoft.windows.sdk.cpp\c\Include\10.0.26100.0\ucrt;$sdkRoot\microsoft.windows.sdk.cpp\c\Include\10.0.26100.0\um;$sdkRoot\microsoft.windows.sdk.cpp\c\Include\10.0.26100.0\shared"
    $env:LIB = "$sdkRoot\microsoft.windows.sdk.cpp.x64\c\ucrt\x64;$sdkRoot\microsoft.windows.sdk.cpp.x64\c\um\x64"
    # This command only compiles source. File operations remain native PowerShell.
    if ($BuildToolsRoot -match '["&|<>^%\r\n]' -or $PostgresRoot -match '["&|<>^%\r\n]') { throw 'Unsupported shell characters in compiler path.' }
    Push-Location $vectorRoot
    try {
      $buildCommand = '"' + $BuildToolsRoot + '\VC\Auxiliary\Build\vcvars64.bat" && set "PGROOT=' + $PostgresRoot + '" && nmake /A /F Makefile.win "PG_CFLAGS=/MD /O2 /fp:fast"'
      & cmd /d /s /c $buildCommand
      Assert-NativeSuccess 'pgvector build'
    } finally { Pop-Location }
  } finally { $env:INCLUDE = $oldInclude; $env:LIB = $oldLib }
  New-Item -ItemType Directory -Path $portableRoot -Force | Out-Null
  foreach ($part in @('bin','lib','share')) {
    if (!(Test-Path (Join-Path $portableRoot $part))) { Copy-Item -LiteralPath (Join-Path $PostgresRoot $part) -Destination $portableRoot -Recurse }
  }
  Copy-Item -LiteralPath (Join-Path $vectorRoot 'vector.dll') -Destination (Join-Path $portableRoot 'lib/vector.dll')
  Copy-Item -LiteralPath (Join-Path $vectorRoot 'vector.control') -Destination (Join-Path $portableRoot 'share/extension/vector.control')
  Get-ChildItem -LiteralPath (Join-Path $vectorRoot 'sql') -Filter 'vector--*.sql' | Copy-Item -Destination (Join-Path $portableRoot 'share/extension')
  & (Join-Path $portableRoot 'bin/initdb.exe') -D $clusterRoot -U goalspec_owner -A trust --encoding=UTF8 --locale=C
  Assert-NativeSuccess 'Local research cluster initialization'
  & $pgctl -D $clusterRoot -l "$clusterRoot.log" -o '-p 55440 -h 127.0.0.1' -w start
  Assert-NativeSuccess 'Local research startup'
  foreach ($database in @('goalspec_research','goalspec_repository_test')) {
    & (Join-Path $portableRoot 'bin/createdb.exe') -h 127.0.0.1 -p 55440 -U goalspec_owner $database
    Assert-NativeSuccess 'Research database creation'
    & (Join-Path $portableRoot 'bin/psql.exe') -h 127.0.0.1 -p 55440 -U goalspec_owner -d $database -v ON_ERROR_STOP=1 -f (Join-Path $workspace 'services/goalspec-runtime/schema.sql')
    Assert-NativeSuccess 'Research schema initialization'
  }
} elseif ($Action -eq 'start') {
  & $pgctl -D $clusterRoot -l "$clusterRoot.log" -o '-p 55440 -h 127.0.0.1' -w start
  Assert-NativeSuccess 'Local research startup'
} elseif ($Action -eq 'stop') {
  & $pgctl -D $clusterRoot -m fast -w stop
  Assert-NativeSuccess 'Local research shutdown'
} else { & $pgctl -D $clusterRoot status }
