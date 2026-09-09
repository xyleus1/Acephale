[CmdletBinding(DefaultParameterSetName = 'Cohort')]
param(
  [Parameter(Mandatory = $true, ParameterSetName = 'Cohort')]
  [ValidatePattern('^[0-9a-f]{40}$')]
  [string]$ExpectedCommit,
  [Parameter(Mandatory = $true, ParameterSetName = 'GuardSelfTest')]
  [switch]$GuardSelfTest
)

$ErrorActionPreference = 'Stop'
$benchmarkRoot = 'C:\Users\apexs\derya-memory-benchmark-large-20260908'
$benchmarkRepo = 'C:\Users\apexs\derya-crm-memory-main-20260908'
$frozenCommit = '7e23ff685bc88b3427e236d94e5463bae01a6304'

function Initialize-PowerRequestType {
  if ('DeryaBenchmarkSession.PowerLease' -as [type]) { return }
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
namespace DeryaBenchmarkSession {
  public sealed class PowerLease : IDisposable {
    [StructLayout(LayoutKind.Sequential)] private struct DetailedReason {
      public IntPtr Module; public uint ReasonId; public uint Count; public IntPtr Strings;
    }
    [StructLayout(LayoutKind.Explicit)] private struct ReasonUnion {
      [FieldOffset(0)] public IntPtr Simple;
      [FieldOffset(0)] public DetailedReason Detailed;
    }
    [StructLayout(LayoutKind.Sequential)] private struct ReasonContext {
      public uint Version; public uint Flags; public ReasonUnion Reason;
    }
    [StructLayout(LayoutKind.Sequential)] private struct SystemPowerStatus {
      public byte ACLineStatus, BatteryFlag, BatteryLifePercent, SystemStatusFlag;
      public uint BatteryLifeTime, BatteryFullLifeTime;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr PowerCreateRequest(ref ReasonContext context);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PowerSetRequest(IntPtr handle, int requestType);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PowerClearRequest(IntPtr handle, int requestType);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetSystemPowerStatus(out SystemPowerStatus status);
    private IntPtr handle;
    private PowerLease(IntPtr value) { handle = value; }
    public bool IsHeld { get { return handle != IntPtr.Zero; } }
    public static byte ACLineStatus() {
      SystemPowerStatus status;
      if (!GetSystemPowerStatus(out status)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot read AC power state.");
      return status.ACLineStatus;
    }
    public static PowerLease Acquire(string reason) {
      IntPtr text = Marshal.StringToHGlobalUni(reason);
      try {
        var context = new ReasonContext { Version = 0, Flags = 1, Reason = new ReasonUnion { Simple = text } };
        IntPtr request = PowerCreateRequest(ref context);
        if (request == IntPtr.Zero || request == new IntPtr(-1))
          throw new Win32Exception(Marshal.GetLastWin32Error(), "PowerCreateRequest failed.");
        // SystemRequired=1. No DisplayRequired, AwayMode, or power-policy writes.
        if (!PowerSetRequest(request, 1)) {
          int error = Marshal.GetLastWin32Error();
          CloseHandle(request);
          throw new Win32Exception(error, "PowerSetRequest(SystemRequired) failed.");
        }
        return new PowerLease(request);
      } finally { Marshal.FreeHGlobal(text); }
    }
    public void Dispose() {
      if (handle == IntPtr.Zero) return;
      IntPtr request = handle;
      handle = IntPtr.Zero;
      bool cleared = PowerClearRequest(request, 1);
      int clearError = cleared ? 0 : Marshal.GetLastWin32Error();
      bool closed = CloseHandle(request);
      int closeError = closed ? 0 : Marshal.GetLastWin32Error();
      if (!cleared) throw new Win32Exception(clearError, "PowerClearRequest failed; the owned handle was closed.");
      if (!closed) throw new Win32Exception(closeError, "Closing the power-request handle failed.");
    }
  }
}
'@
}

function New-SleepAudit {
  return [ordered]@{
    source = 'Windows System event log'; state = 'pending'; baselineRecordId = $null
    startedAt = $null; lastCheckedAt = $null; checks = 0; events = @(); error = $null
  }
}

function Initialize-SleepAudit([Collections.IDictionary]$Audit) {
  $latest = Get-WinEvent -LogName System -MaxEvents 1 -ErrorAction Stop
  if ($null -eq $latest.RecordId) { throw 'Cannot establish the System event-log baseline.' }
  $Audit.baselineRecordId = [long]$latest.RecordId
  $Audit.startedAt = [DateTime]::UtcNow.ToString('o')
  $Audit.state = 'active'
}

function Assert-NoSleepEvents([Collections.IDictionary]$Audit) {
  try {
    $latest = Get-WinEvent -LogName System -MaxEvents 1 -ErrorAction Stop
    if ([long]$latest.RecordId -lt [long]$Audit.baselineRecordId) {
      throw 'The System event log reset during the cohort; continuity cannot be verified.'
    }
    # These are actual sleep/resume records, not wall-time/CPU-delay guesses.
    # The original cohort baseline remains fixed so delayed event publication
    # is caught by later checks rather than skipped by advancing a cursor.
    $xpath = "*[System[(EventRecordID > $($Audit.baselineRecordId)) and ((Provider[@Name='Microsoft-Windows-Kernel-Power'] and (EventID=42 or EventID=107 or EventID=506 or EventID=507)) or (Provider[@Name='Microsoft-Windows-Power-Troubleshooter'] and EventID=1))]]"
    $events = @()
    try {
      $events = @(Get-WinEvent -LogName System -FilterXPath $xpath -MaxEvents 20 -ErrorAction Stop)
    } catch {
      if ($_.FullyQualifiedErrorId -notlike 'NoMatchingEventsFound*') { throw }
    }
    $Audit.checks += 1
    $Audit.lastCheckedAt = [DateTime]::UtcNow.ToString('o')
    if ($events.Count -gt 0) {
      $Audit.events = @($events | ForEach-Object {
        [ordered]@{ recordId = $_.RecordId; provider = $_.ProviderName; eventId = $_.Id; timeCreated = $_.TimeCreated.ToUniversalTime().ToString('o') }
      })
      $Audit.state = 'interrupted'
      throw 'Windows recorded sleep/resume during the cohort. Timing is interrupted; preserve it, do not splice or retry.'
    }
  } catch {
    if ($Audit.state -ne 'interrupted') { $Audit.state = 'failed' }
    $Audit.error = $_.Exception.Message
    throw
  }
}

function Assert-ACLineStatus([byte]$Value) {
  if ($Value -ne 1) { throw "AC power must remain connected for reliable idle-sleep prevention (ACLineStatus=$Value)." }
}

function Invoke-GuardSelfTest {
  Initialize-PowerRequestType
  $ac = [DeryaBenchmarkSession.PowerLease]::ACLineStatus()
  Assert-ACLineStatus $ac
  foreach ($invalidAC in @(0, 255)) {
    $rejected = $false
    try { Assert-ACLineStatus $invalidAC } catch { $rejected = $true }
    if (-not $rejected) { throw "AC guard accepted invalid state $invalidAC." }
  }
  $audit = New-SleepAudit
  Initialize-SleepAudit $audit
  # Read-only replay of a real prior Modern Standby/sleep record proves the
  # filter rejects an observed interruption; no sleep transition is induced.
  $historical = Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-Kernel-Power'; Id = 42,107,506,507 } -MaxEvents 1 -ErrorAction Stop
  $interruptedAudit = New-SleepAudit
  $interruptedAudit.baselineRecordId = [long]$historical.RecordId - 1
  $interruptedAudit.state = 'active'
  $interruptionRejected = $false
  try { Assert-NoSleepEvents $interruptedAudit } catch { $interruptionRejected = $interruptedAudit.state -eq 'interrupted' }
  if (-not $interruptionRejected) { throw 'Sleep-event helper did not reject a known recorded transition.' }
  $lease = $null
  try {
    $lease = [DeryaBenchmarkSession.PowerLease]::Acquire('Derya benchmark short reversible power-guard self-test')
    if (-not $lease.IsHeld) { throw 'The test did not hold a system-required power request.' }
    Assert-NoSleepEvents $audit
    foreach ($expectedExit in @(0, 7)) {
      $child = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList @('-e', "process.exit($expectedExit)") -WindowStyle Hidden -PassThru
      try {
        $retainedChildHandle = $child.Handle
        if (-not $child.WaitForExit(5000)) { $child.Kill(); throw 'Exit-code helper timed out.' }
        $child.Refresh()
        if ($null -eq $child.ExitCode -or $child.ExitCode -ne $expectedExit) {
          throw "Retained child handle lost expected exit code $expectedExit."
        }
      } finally { $child.Dispose() }
    }
    Assert-NoSleepEvents $audit
  } finally { if ($null -ne $lease) { $lease.Dispose() } }
  if ($lease.IsHeld) { throw 'Self-test power request was not released.' }
  [ordered]@{ ok = $true; mode = 'guard-self-test'; acLineStatus = $ac; heldThenReleased = $true; rejectedACStates = @(0, 255); childExitCodes = @(0, 7); sleepAuditChecks = $audit.checks; historicalSleepEventRejected = $interruptionRejected; databaseUsed = $false; cohortLaunched = $false } | ConvertTo-Json -Depth 5
}

if ($GuardSelfTest) { Invoke-GuardSelfTest; return }
if ($ExpectedCommit -ne $frozenCommit) { throw 'This resumed cohort is bound to its exact frozen source commit.' }
if ($PSScriptRoot -ne $benchmarkRoot) { throw 'Run only the launcher in the new resume root.' }
. (Join-Path $benchmarkRoot 'benchmark-session.ps1')
foreach ($variable in @('BENCHMARK_DATABASE_OWNER_URL', 'BENCHMARK_APP_DATABASE_URL', 'BENCHMARK_APP_DATABASE_URL_UNPOOLED', 'BENCHMARK_WORKFLOW_DATABASE_URL', 'BENCHMARK_BOURNE_DATABASE_URL')) {
  $url = [Uri][Environment]::GetEnvironmentVariable($variable)
  if ($url.Host -ne '127.0.0.1' -or $url.Port -ne 55439 -or $url.AbsolutePath -ne '/derya_main_benchmark_large_retry') {
    throw "$variable must target only the new local resume database."
  }
}
if ($env:BENCHMARK_OUTPUT_DIR -ne (Join-Path $benchmarkRoot 'results')) { throw 'Unexpected resumed-cohort output directory.' }
$benchmarkLogs = Join-Path $benchmarkRoot 'logs'
$benchmarkStatusPath = Join-Path $benchmarkRoot 'cohort-status.json'
if (Test-Path -LiteralPath $benchmarkStatusPath) { throw 'A cohort status already exists; never overwrite or silently retry an interrupted cohort.' }
New-Item -ItemType Directory -Path $benchmarkLogs -Force | Out-Null
$benchmarkStatus = [ordered]@{
  status = 'starting'; expectedCommit = $ExpectedCommit; repository = $benchmarkRepo
  profileOnly = 'graph-large'; expectedRuns = 50; expectedExecutions = 10000
  expectedSystems = @('CURRENT_KEYWORD', 'VECTOR_RAG', 'STRONG_HYBRID_RAG', 'DERYA_COLD', 'DERYA_HOT')
  cohortRelationship = 'independent_profile_retry_no_pass_splicing'
  database = 'derya_main_benchmark_large_retry'; endpoint = '127.0.0.1:55439'; processId = $PID
  startedAt = [DateTime]::UtcNow.ToString('o'); stage = $null; childProcessId = $null
  stages = @(); error = $null; failureKind = $null; completedAt = $null
  powerGuard = [ordered]@{
    kind = 'PowerCreateRequest:SystemRequired'; state = 'pending'; acquired = $false; releaseConfirmed = $false
    acRequired = $true; initialACLineStatus = $null; lastACLineStatus = $null; checks = 0
    acquiredAt = $null; releasedAt = $null; globalPolicyChanged = $false; error = $null
    limitation = 'Idle sleep only. Do not close the lid, choose Sleep, shut down, or disconnect AC.'
  }
  sleepAudit = (New-SleepAudit)
}
$powerLease = $null
# Exclusive claim closes the check/create race between accidental duplicate
# launchers. Subsequent status rewrites belong only to this successful claimant.
$statusClaim = [IO.File]::Open($benchmarkStatusPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
$statusClaim.Dispose()

function Save-BenchmarkStatus {
  [IO.File]::WriteAllText($benchmarkStatusPath, ($benchmarkStatus | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
}

function Assert-FrozenBenchmarkSource {
  $commit = (& git -C $benchmarkRepo rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $commit -ne $ExpectedCommit) { throw 'The checkout no longer matches the frozen benchmark commit.' }
  $changes = & git -C $benchmarkRepo status --porcelain --untracked-files=all
  if ($LASTEXITCODE -ne 0 -or $changes) { throw 'Benchmark source must remain clean and unchanged throughout the cohort.' }
}

function Assert-CohortPowerGuard {
  try {
    if ($null -eq $powerLease -or -not $powerLease.IsHeld) { throw 'The process-held power request is not active.' }
    $ac = [DeryaBenchmarkSession.PowerLease]::ACLineStatus()
    $benchmarkStatus.powerGuard.lastACLineStatus = $ac
    $benchmarkStatus.powerGuard.checks += 1
    Assert-ACLineStatus $ac
  } catch {
    $benchmarkStatus.failureKind = 'infrastructure_interruption'
    $benchmarkStatus.powerGuard.error = $_.Exception.Message
    throw
  }
}

function Assert-CohortSleepAudit {
  try { Assert-NoSleepEvents $benchmarkStatus.sleepAudit } catch {
    $benchmarkStatus.failureKind = 'infrastructure_interruption'
    throw
  }
}

function Invoke-BenchmarkStage([string]$Name, [string]$Executable, [string[]]$Arguments) {
  Assert-FrozenBenchmarkSource
  Assert-CohortPowerGuard
  Assert-CohortSleepAudit
  $benchmarkStatus.status = 'running'
  $benchmarkStatus.stage = $Name
  $startedAt = [DateTime]::UtcNow
  $timer = [Diagnostics.Stopwatch]::StartNew()
  $stdout = Join-Path $benchmarkLogs ($Name + '.stdout.log')
  $stderr = Join-Path $benchmarkLogs ($Name + '.stderr.log')
  if ((Test-Path -LiteralPath $stdout) -or (Test-Path -LiteralPath $stderr)) { throw "Refusing to overwrite stage logs: $Name" }
  Save-BenchmarkStatus
  $child = $null
  $exitCode = $null
  $ownedChildTerminated = $false
  try {
    $child = Start-Process -FilePath $Executable -ArgumentList $Arguments -WorkingDirectory $benchmarkRepo -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $retainedChildHandle = $child.Handle
    $benchmarkStatus.childProcessId = $child.Id
    Save-BenchmarkStatus
    $nextAudit = [DateTime]::UtcNow.AddSeconds(30)
    while (-not $child.WaitForExit(1000)) {
      Assert-CohortPowerGuard
      if ([DateTime]::UtcNow -ge $nextAudit) {
        Assert-CohortSleepAudit
        Save-BenchmarkStatus
        $nextAudit = [DateTime]::UtcNow.AddSeconds(30)
      }
    }
    $child.Refresh()
    $exitCode = $child.ExitCode
    Assert-CohortPowerGuard
    Assert-CohortSleepAudit
    if ($null -eq $exitCode) {
      $benchmarkStatus.failureKind = 'infrastructure_interruption'
      throw "Child exit status unavailable for $Name. Preserve artifacts; no later stage may start."
    }
    if ($exitCode -ne 0) {
      $benchmarkStatus.failureKind = 'stage_exit_nonzero'
      throw "Cohort stage failed: $Name (exit $exitCode)."
    }
    Assert-FrozenBenchmarkSource
  } finally {
    if ($null -ne $child) {
      # Stop only the exact child represented by our retained process handle.
      # This never enumerates or terminates another user's processes.
      if (-not $child.HasExited) {
        $child.Kill()
        $ownedChildTerminated = $true
        [void]$child.WaitForExit(10000)
      }
      $child.Refresh()
      if ($child.HasExited -and $null -eq $exitCode) { $exitCode = $child.ExitCode }
    }
    $timer.Stop()
    $benchmarkStatus.stages += [ordered]@{
      name = $Name; startedAt = $startedAt.ToString('o'); completedAt = [DateTime]::UtcNow.ToString('o')
      durationMs = $timer.ElapsedMilliseconds; exitCode = $exitCode; stdout = $stdout; stderr = $stderr
      infrastructureInterrupted = ($benchmarkStatus.failureKind -eq 'infrastructure_interruption')
      ownedChildTerminated = $ownedChildTerminated
    }
    $benchmarkStatus.childProcessId = $null
    Save-BenchmarkStatus
    if ($null -ne $child) { $child.Dispose() }
  }
}

$cohortExitCode = 0
try {
  Assert-FrozenBenchmarkSource
  Save-BenchmarkStatus
  Initialize-PowerRequestType
  try {
    $ac = [DeryaBenchmarkSession.PowerLease]::ACLineStatus()
    $benchmarkStatus.powerGuard.initialACLineStatus = $ac
    $benchmarkStatus.powerGuard.lastACLineStatus = $ac
    Assert-ACLineStatus $ac
    $powerLease = [DeryaBenchmarkSession.PowerLease]::Acquire('Derya reproducible memory benchmark: keep system awake on AC until the guarded cohort completes')
    $benchmarkStatus.powerGuard.acquired = $true
    $benchmarkStatus.powerGuard.state = 'held'
    $benchmarkStatus.powerGuard.acquiredAt = [DateTime]::UtcNow.ToString('o')
    Initialize-SleepAudit $benchmarkStatus.sleepAudit
    Assert-CohortPowerGuard
    Assert-CohortSleepAudit
  } catch {
    $benchmarkStatus.failureKind = 'infrastructure_interruption'
    $benchmarkStatus.powerGuard.error = $_.Exception.Message
    throw
  }
  Save-BenchmarkStatus
  $nodeExecutable = (Get-Command node.exe).Source
  foreach ($profile in @('graph-large')) {
    Invoke-BenchmarkStage $profile $nodeExecutable @(
      '--conditions=react-server', '--import', 'tsx', 'scripts/benchmark-run.ts',
      "--profile=$profile", '--vector-enabled=true', '--warmup-passes=3',
      '--runs=10', '--seed=42', '--concurrency=4', '--top-k=20',
      '--systems=CURRENT_KEYWORD,VECTOR_RAG,STRONG_HYBRID_RAG,DERYA_COLD,DERYA_HOT'
    )
    $profileOutput = Join-Path $benchmarkRoot ('profiles\' + $profile)
    if (Test-Path -LiteralPath $profileOutput) { throw "Refusing to overwrite profile artifacts: $profile" }
    New-Item -ItemType Directory -Path $profileOutput | Out-Null
    foreach ($artifact in @('summary.json', 'results.csv', 'report.html')) {
      Copy-Item -LiteralPath (Join-Path $env:BENCHMARK_OUTPUT_DIR $artifact) -Destination (Join-Path $profileOutput $artifact)
    }
  }
  Assert-CohortPowerGuard
  Assert-CohortSleepAudit
  $benchmarkStatus.sleepAudit.state = 'completed'
} catch {
  $cohortExitCode = 1
  $benchmarkStatus.status = 'failed'
  $benchmarkStatus.error = $_.Exception.Message
  if ($null -eq $benchmarkStatus.failureKind) { $benchmarkStatus.failureKind = 'launcher_failure' }
  [Console]::Error.WriteLine($benchmarkStatus.error)
} finally {
  try {
    if ($null -ne $powerLease) {
      $powerLease.Dispose()
      $benchmarkStatus.powerGuard.state = 'released'
      $benchmarkStatus.powerGuard.releaseConfirmed = $true
      $benchmarkStatus.powerGuard.releasedAt = [DateTime]::UtcNow.ToString('o')
    } else { $benchmarkStatus.powerGuard.state = 'not_acquired' }
  } catch {
    $cohortExitCode = 1
    $benchmarkStatus.powerGuard.state = 'release_failed'
    $benchmarkStatus.powerGuard.error = $_.Exception.Message
    $benchmarkStatus.failureKind = 'infrastructure_interruption'
    $benchmarkStatus.error = $_.Exception.Message
    [Console]::Error.WriteLine($benchmarkStatus.error)
  }
  $benchmarkStatus.status = if ($cohortExitCode -eq 0) { 'completed' } else { 'failed' }
  $benchmarkStatus.stage = $null
  $benchmarkStatus.completedAt = [DateTime]::UtcNow.ToString('o')
  Save-BenchmarkStatus
}
exit $cohortExitCode

