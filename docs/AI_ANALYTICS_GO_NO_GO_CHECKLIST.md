# AI Analytics Go-No-Go Checklist

## Scope
Use this checklist at each rollout gate: staging, canary-10, canary-50, production-100.

## Release Metadata
- Date/Time (UTC):
- Stage: staging | canary-10 | canary-50 | production-100
- Operator:
- Build/Commit:
- Target Base URL:

## Pre-Deploy Gate (must be YES)
- [ ] Required tests passed:
  - `pnpm test server/aiInspectionAnalytics.test.ts server/aiInspectionAnalyticsRouter.test.ts server/aiReportGenerator.test.ts server/rateLimitConfig.test.ts server/exportWorkflow.test.ts`
- [ ] Build passed:
  - `pnpm build`
- [ ] Rollout env value prepared for this stage:
  - staging/prod-100: `AI_ANALYTICS_ROLLOUT_PERCENT=100`
  - canary-10: `AI_ANALYTICS_ROLLOUT_PERCENT=10`
  - canary-50: `AI_ANALYTICS_ROLLOUT_PERCENT=50`
- [ ] Rollback value confirmed:
  - `AI_ANALYTICS_ROLLOUT_PERCENT=0`
- [ ] Health endpoints reachable after restart:
  - `/health`
  - `/api/network/health`

## Monitoring Gate (must be YES)
- [ ] Monitor script executed for this stage
- [ ] Analyzer executed on latest artifact
- [ ] Availability >= 99%
- [ ] p95 <= 1500ms for monitored endpoints
- [ ] No sustained blocker error trend in logs

## Canary-Specific Gate
- [ ] User support ticket rate is normal baseline
- [ ] No major regression reported by QA/business users
- [ ] `rolloutStatus` verified for sampled users (admin + non-admin)

## Decision
- [ ] GO to next stage
- [ ] NO-GO and rollback to 0%

## If NO-GO, capture
- Incident ID:
- Trigger condition:
- Last known good stage:
- Action taken:
- Follow-up owner:

## Recommended Hold Times
- staging: 24-48h
- canary-10: 24h
- canary-50: 24h
- production-100: monitor closely for 7 days
