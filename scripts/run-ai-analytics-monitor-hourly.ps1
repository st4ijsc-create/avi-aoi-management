param(
  [string]$BaseUrl = "http://localhost:3000",
  [int]$DurationMinutes = 60,
  [int]$IntervalSeconds = 30,
  [double]$MinAvailability = 99,
  [int]$MaxP95Ms = 1500,
  [string]$OutputDir = "monitoring",
  [switch]$Loop
)

$ErrorActionPreference = "Stop"

function Invoke-MonitorCycle {
  param(
    [string]$CycleBaseUrl,
    [int]$CycleDurationMinutes,
    [int]$CycleIntervalSeconds,
    [double]$CycleMinAvailability,
    [int]$CycleMaxP95Ms,
    [string]$CycleOutputDir
  )

  $timestamp = (Get-Date).ToString("yyyy-MM-ddTHH-mm-ss-fffZ")
  $outputFile = Join-Path $CycleOutputDir "ai-analytics-rollout-$timestamp.jsonl"

  $env:MONITOR_BASE_URL = $CycleBaseUrl
  $env:MONITOR_DURATION_MINUTES = "$CycleDurationMinutes"
  $env:MONITOR_INTERVAL_SECONDS = "$CycleIntervalSeconds"
  $env:MONITOR_MIN_AVAILABILITY = "$CycleMinAvailability"
  $env:MONITOR_MAX_P95_MS = "$CycleMaxP95Ms"
  $env:MONITOR_OUTPUT = $outputFile

  Write-Host "[hourly-monitor] Starting monitor cycle"
  Write-Host "[hourly-monitor] baseUrl=$CycleBaseUrl output=$outputFile"

  node scripts/monitor-ai-analytics-rollout.mjs
  if ($LASTEXITCODE -ne 0) {
    Write-Error "[hourly-monitor] Monitor script failed with exit code $LASTEXITCODE"
    return 1
  }

  node scripts/analyze-ai-analytics-metrics.mjs $outputFile
  if ($LASTEXITCODE -ne 0) {
    Write-Error "[hourly-monitor] Analyzer failed with exit code $LASTEXITCODE"
    return 2
  }

  Write-Host "[hourly-monitor] Cycle completed successfully"
  return 0
}

if (-not (Test-Path $OutputDir)) {
  New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

if ($Loop) {
  while ($true) {
    $cycleCode = Invoke-MonitorCycle -CycleBaseUrl $BaseUrl -CycleDurationMinutes $DurationMinutes -CycleIntervalSeconds $IntervalSeconds -CycleMinAvailability $MinAvailability -CycleMaxP95Ms $MaxP95Ms -CycleOutputDir $OutputDir
    if ($cycleCode -ne 0) {
      exit $cycleCode
    }

    Write-Host "[hourly-monitor] Sleeping for 3600 seconds"
    Start-Sleep -Seconds 3600
  }
}
else {
  $singleCode = Invoke-MonitorCycle -CycleBaseUrl $BaseUrl -CycleDurationMinutes $DurationMinutes -CycleIntervalSeconds $IntervalSeconds -CycleMinAvailability $MinAvailability -CycleMaxP95Ms $MaxP95Ms -CycleOutputDir $OutputDir
  exit $singleCode
}
