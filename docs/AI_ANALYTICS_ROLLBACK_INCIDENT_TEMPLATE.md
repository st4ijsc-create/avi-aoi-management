# AI Analytics Rollback Incident Note Template

**Use this template when Go/No-Go decision is NO-GO and rollback to `AI_ANALYTICS_ROLLOUT_PERCENT=0` is triggered.**

---

## Incident Header

**Date/Time (UTC):** YYYY-MM-DD HH:MM:SS  
**Incident ID:** INC-YYYY-MM-DD-001 *(auto-generate or use ticket system)*  
**Severity:** HIGH  
**Owner:** [Name]  
**Stakeholders:** [QA, Ops, Product, Backend Lead]  

---

## Rollback Timeline

| Phase | Time (UTC) | Action | Note |
|-------|-----------|--------|------|
| **Detection** | HH:MM | Go/No-Go check triggered | Last known good artifact: `monitoring/ai-analytics-rollout-*.jsonl` |
| **Decision** | HH:MM | NO-GO decision made | Reason: [see Trigger Condition below] |
| **Execution** | HH:MM | `AI_ANALYTICS_ROLLOUT_PERCENT=0` set | Service restarted |
| **Validation** | HH:MM | Rollback verified | Confirmed via `rolloutStatus` endpoint |
| **Communication** | HH:MM | Team + users notified | Slack/email sent |

---

## Trigger Condition (Check One)

- [ ] **Availability SLO Miss**
  - Duration: __ hours below 99%
  - Affected endpoints: ____________________
  - Root cause hypothesis: ____________________

- [ ] **Latency SLO Breach**
  - p95 exceeded 1500ms for __ consecutive hours
  - Affected endpoints: ____________________
  - Root cause hypothesis: ____________________

- [ ] **User-Reported Blocker**
  - Issue description: ____________________
  - Affected users/roles: ____________________
  - Impact scope: __ internal | __ external | __ both

- [ ] **Critical Error Rate Spike**
  - Error trend: __ steady spike | __ sudden jump
  - Error rate: __%
  - Error messages: ____________________

- [ ] **Database/Infrastructure Issue**
  - Component: ____________________
  - Error logs: ____________________
  - Expected recovery time: ____________________

- [ ] **Other**
  - Reason: ____________________

---

## Monitoring Data

**Last monitoring cycle before rollback:**
```
File: monitoring/ai-analytics-rollout-YYYY-MM-DDTHH-MM-SS-FFFZ.jsonl
Availability:      ___%
p50 latency:       __ms
p95 latency:       __ms
p99 latency:       __ms
Failed checks:     __ of __
```

**Copy relevant lines from analyzer output:**
```
[endpoint] /health
  checks=__ failures=__ availability=__% slo availability=FAIL|OK p95=FAIL|OK

[endpoint] /api/network/health
  checks=__ failures=__ availability=__% slo availability=FAIL|OK p95=FAIL|OK

[endpoint] /ai-inspection-analytics
  checks=__ failures=__ availability=__% slo availability=FAIL|OK p95=FAIL|OK
```

---

## Immediate Actions Taken

- [x] Set `AI_ANALYTICS_ROLLOUT_PERCENT=0`
- [x] Restarted service
- [x] Verified rolloutStatus endpoint returns `enabled=false` for non-admin users
- [ ] Alerted on-call backend team
- [ ] Posted incident update to #incidents Slack channel
- [ ] Notified product/business team
- [ ] Paused future rollout stage promotions

---

## Root Cause Analysis (RCA)

**Hypothesis:**
```
[Describe what likely caused the issue based on symptoms]
```

**Evidence:**
- Log excerpt 1: ____________________
- Log excerpt 2: ____________________
- Performance metric: ____________________

**Contributing Factors:**
1. [List factor]
2. [List factor]

---

## Follow-Up Action Items

| # | Task | Owner | Due Date | Priority |
|---|------|-------|----------|----------|
| 1 | [e.g., Review database slow query logs] | [Name] | YYYY-MM-DD | P0 |
| 2 | [e.g., Increase connection pool size] | [Name] | YYYY-MM-DD | P0 |
| 3 | [e.g., Add monitoring alert for latency] | [Name] | YYYY-MM-DD | P1 |
| 4 | [e.g., Re-test rollout in staging] | [Name] | YYYY-MM-DD | P1 |

---

## Lessons Learned

**What worked well:**
- [e.g., Quick Go/No-Go detection via monitor alerts]
- [e.g., Rapid rollback via environment variable]

**What could be improved:**
- [e.g., Earlier SLO violation warning threshold]
- [e.g., Automated rollback trigger when threshold breached for 2 consecutive hours]

---

## Resume Plan

**Condition to resume rollout:**
- [ ] RCA completed and root cause resolved
- [ ] Fix deployed to staging
- [ ] Staging validation passed for [__ hours]
- [ ] New build tested successfully
- [ ] Go/No-Go checklist passed

**Planned resume stage:**
- [ ] Restart at same stage (10% → 10%)
- [ ] Restart at earlier stage (50% → 10%)
- [ ] Full re-baseline (100% → staging, then canary)

**Scheduled resume date:** YYYY-MM-DD HH:MM UTC

---

## Sign-Off

| Role | Name | Sign-Off Time | Notes |
|------|------|---------------|-------|
| Incident Owner | | | |
| Backend Lead | | | |
| Operations Lead | | | |
| Product Manager | | | |

---

## Attachments
- [ ] Monitoring JSONL artifact attached
- [ ] Analyzer output attached
- [ ] Service logs (ERROR/WARN) attached
- [ ] Screenshots/evidence attached
