# Task Scheduler Setup for AI Analytics Hourly Monitor

## Purpose
Run AI Analytics monitoring every hour on staging/production host to continuously validate rollout SLO compliance.

## Prerequisites
- Windows Server or Windows with Task Scheduler
- PowerShell 5.0+
- Project repository cloned to `C:\Apps\avi-aoi-management` (or adjust path below)
- Service running on target host accessible via HTTP

## Setup Steps

### 1. Create the Task Scheduler Task

Open `Task Scheduler` on the target Windows host:
- Right-click **Task Scheduler Library** → **Create Task**

**General Tab:**
- Name: `AI Analytics Hourly Monitor - Staging`
- Description: `Runs synthetic monitoring for AI Analytics rollout validation every hour`
- Run whether user is logged on or not: ✓
- Run with highest privileges: ✓

**Triggers Tab:**
- Click **New**
- Begin the task: `On a schedule`
- Recur every: `1 day`
- Repeat task every: `1 hour`
- For a duration of: `Indefinitely`
- Stop if the task is running longer than: `55 minutes` (leave some margin)
- Click **OK**

**Actions Tab:**
- Click **New**
- Program/script: `powershell.exe`
- Add arguments:
  ```
  -ExecutionPolicy Bypass -NoProfile -File "C:\Apps\avi-aoi-management\scripts\run-ai-analytics-monitor-hourly.ps1" -BaseUrl http://localhost:3000 -DurationMinutes 60 -IntervalSeconds 30
  ```
- Start in: `C:\Apps\avi-aoi-management`
- Click **OK**

**Conditions Tab:**
- Wake the computer to run this task: ✓ (optional, for unattended hosts)

**Settings Tab:**
- If the task is already running, then the following rule applies: `Stop the existing instance`
- If the task does not end when requested, force it to stop: ✓
- Click **OK** to save

### 2. Verify Task Creation
1. Open Task Scheduler
2. Navigate to **Task Scheduler Library**
3. Find `AI Analytics Hourly Monitor - Staging`
4. Right-click → **Run** to test one cycle manually
5. Check `monitoring/` folder for generated `ai-analytics-rollout-*.jsonl` file

### 3. Monitor Task Execution
- View task history in Task Scheduler: `History` tab
- Check logs in Event Viewer: `Windows Logs → Application`
- Search for task name or `run-ai-analytics-monitor-hourly.ps1` in recent logs

### 4. Troubleshooting

**Task not running:**
- Verify user account has permission to run scripts
- Check PowerShell execution policy: `Get-ExecutionPolicy -List`
- Ensure file path is correct and repository is cloned to expected location

**Script fails with exit code 1 or 2:**
- Exit code 1: Monitor script failed (service unreachable)
- Exit code 2: Analyzer script failed (SLO violation)
- Check latest JSONL file in `monitoring/` folder:
  ```powershell
  $latest = Get-ChildItem "C:\Apps\avi-aoi-management\monitoring\ai-analytics-rollout-*.jsonl" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  Get-Content $latest | ConvertFrom-Json -ErrorAction SilentlyContinue | Format-Table -AutoSize
  ```

**Analyzer reports SLO violation:**
- Check availability percentage (must be >= 99%)
- Check p95 latency (must be <= 1500ms)
- If violation is legitimate, trigger Go/No-Go decision (see `AI_ANALYTICS_GO_NO_GO_CHECKLIST.md`)

### 5. Configuration for Different Stages

**For Staging (100% rollout, every hour):**
```
-BaseUrl http://staging-host:3000 -DurationMinutes 60 -IntervalSeconds 30
```

**For Canary 10% (watch for 24h, every hour):**
```
-BaseUrl http://production-host:3000 -DurationMinutes 60 -IntervalSeconds 30
```

**For Canary 50% (watch for 24h, every hour):**
```
-BaseUrl http://production-host:3000 -DurationMinutes 60 -IntervalSeconds 30
```

**For Production 100% (long-term, every hour for 7 days):**
```
-BaseUrl http://production-host:3000 -DurationMinutes 60 -IntervalSeconds 30
```

### 6. Disable/Stop Monitoring
- Open Task Scheduler
- Right-click task → **Disable** (pauses without deleting)
- Or **Delete** to remove entirely

### 7. Retention & Archival
Monitor artifacts (JSONL files) accumulate in `monitoring/` folder:
- Keep at least 7 days of history
- Recommend: Archive old files weekly to a backup location
- Clean older than 30 days to save disk space

Example cleanup (PowerShell):
```powershell
$cutoffDate = (Get-Date).AddDays(-30)
Get-ChildItem "C:\Apps\avi-aoi-management\monitoring\ai-analytics-rollout-*.jsonl" |
  Where-Object { $_.LastWriteTime -lt $cutoffDate } |
  Remove-Item -Force
```

## Sign-Off
- [ ] Task created in Task Scheduler
- [ ] Manual test run successful
- [ ] Monitoring artifacts generating hourly
- [ ] Team aware of monitoring location and incident process
