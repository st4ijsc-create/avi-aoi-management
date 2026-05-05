# AI Analytics Rollout Runbook

## Purpose
This runbook executes the next phase after PDCA Cycle 1:
1. Deploy to staging and monitor 24-48h
2. Canary release (10% -> 50% -> 100%)
3. Monitor production for 1 week
4. Decide whether Cycle 2 is required

## Prerequisites
- Service is built and start command works: `pnpm build`, `pnpm start`
- Health endpoints available: `/health`, `/api/network/health`
- AI analytics QA tests pass
- Access to set env vars on the target host

## Rollout Control
AI analytics router now supports deterministic canary rollout by user id bucket.
- Env var: `AI_ANALYTICS_ROLLOUT_PERCENT`
- Range: `0..100`
- Admin users always bypass rollout restriction
- Non-admin users are allowed if `abs(userId) % 100 < AI_ANALYTICS_ROLLOUT_PERCENT`

## Step 1: Staging Deploy (24-48h)
1. Build and test:
   - `pnpm test server/aiInspectionAnalytics.test.ts server/aiInspectionAnalyticsRouter.test.ts server/aiReportGenerator.test.ts server/rateLimitConfig.test.ts server/exportWorkflow.test.ts`
   - `pnpm build`
2. Set staging rollout:
   - `AI_ANALYTICS_ROLLOUT_PERCENT=100`
3. Restart service on staging.
4. Run synthetic monitor for at least 24h (repeat in cron/task scheduler):
   - `set MONITOR_BASE_URL=http://staging-host:3000`
   - `set MONITOR_DURATION_MINUTES=60`
   - `pnpm monitor:ai-analytics`
5. Analyze output:
   - `pnpm monitor:ai-analytics:summary monitoring/ai-analytics-rollout-<timestamp>.jsonl`

Acceptance gate:
- Availability >= 99%
- p95 latency <= 1500ms on monitored endpoints
- No blocker error trend in logs

## Step 2: Canary Release
### Canary 10%
1. Set production env: `AI_ANALYTICS_ROLLOUT_PERCENT=10`
2. Restart service
3. Monitor for 24h using script
4. Validate support tickets and error budget

### Canary 50%
1. If canary 10% is stable, set: `AI_ANALYTICS_ROLLOUT_PERCENT=50`
2. Restart service
3. Monitor for 24h

### Production 100%
1. If canary 50% is stable, set: `AI_ANALYTICS_ROLLOUT_PERCENT=100`
2. Restart service
3. Start 1-week monitoring window

Rollback rule:
- If availability < 99% for 2 consecutive hours or major user impact occurs:
  - Set `AI_ANALYTICS_ROLLOUT_PERCENT=0`
  - Restart service
  - Open incident and attach monitoring artifact

## Step 3: Production Monitoring (1 week)
Track at least:
- Service availability
- API latency (p50, p95, p99)
- Error rate by endpoint
- DB saturation and memory usage
- AI report provider fallback frequency (openai/gguf/offline)

Daily routine:
1. Run monitor script at least every hour
2. Aggregate daily summary
3. Record incidents and mitigations

## Step 4: Cycle 2 Decision Plan
Start Cycle 2 if one or more conditions are true:
- Availability target misses repeatedly
- p95 latency breaches SLO for >= 2 days
- User feedback indicates missing analytics export/report capabilities
- Provider fallback to offline mode increases beyond normal baseline

Cycle 2 backlog (already identified):
1. Caching optimization (Redis-backed, cross-instance)
2. PDF export and scheduled distribution
3. Drift detection and model-health alerting
4. Mobile-focused analytics UX improvements
5. Advanced prediction and what-if simulation

## GitHub Actions Manual Flow
Use workflow: `.github/workflows/ai-analytics-rollout.yml`
- Trigger via `workflow_dispatch`
- Select stage: `staging`, `canary-10`, `canary-50`, `production-100`
- Provide monitoring base URL and duration
- Download monitoring artifact from the run

## Operations Toolkit
- Go/No-Go checklist: `docs/AI_ANALYTICS_GO_NO_GO_CHECKLIST.md`
- Environment template: `docs/AI_ANALYTICS_ROLLOUT_ENV.example`
- Hourly monitor runner (Windows PowerShell): `scripts/run-ai-analytics-monitor-hourly.ps1`
- Task Scheduler setup guide: `docs/AI_ANALYTICS_TASK_SCHEDULER_SETUP.md`
- Rollback incident template: `docs/AI_ANALYTICS_ROLLBACK_INCIDENT_TEMPLATE.md`

### Hourly runner examples
Run one cycle (recommended for Task Scheduler hourly trigger):
- `powershell -ExecutionPolicy Bypass -File scripts/run-ai-analytics-monitor-hourly.ps1 -BaseUrl http://staging-host:3000 -DurationMinutes 60 -IntervalSeconds 30`

Run as continuous loop (single long-running process):
- `powershell -ExecutionPolicy Bypass -File scripts/run-ai-analytics-monitor-hourly.ps1 -BaseUrl http://staging-host:3000 -DurationMinutes 60 -IntervalSeconds 30 -Loop`

## Notes
- This workflow does not directly deploy infrastructure. It validates build/test quality and monitors a provided environment URL.
- Actual deployment/restart is done by the operations host process (systemd/nssm/container platform).
