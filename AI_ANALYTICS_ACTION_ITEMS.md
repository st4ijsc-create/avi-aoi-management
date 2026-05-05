## AI Analytics Module - Action Items & Priorities

**Generated:** 2026-05-05  
**Status:** Ready for Implementation

---

## IMMEDIATE ACTIONS (Next 2 weeks)

### 🚨 CRITICAL - MUST FIX BEFORE PRODUCTION

#### 1. Fix N+1 Query in Correlation Analysis
- **File:** `server/services/aiInspectionAnalytics.ts` (line 312-325)
- **Impact:** 500-1000ms latency per request
- **Effort:** 3-4 hours
- **Steps:**
  1. Split `getCorrelationAnalysis()` into two queries
  2. First query: Aggregate by machine-day
  3. Second query: Compute correlations in JavaScript with limit
  4. Add unit tests for edge cases

#### 2. Fix Forecast Calculation for Short Windows
- **File:** `server/services/aiInspectionAnalytics.ts` (line 269-280)
- **Impact:** Inaccurate yield predictions when < 2 weeks of data
- **Effort:** 2-3 hours
- **Steps:**
  1. Add minimum data requirement checks
  2. Implement fallback logic (EWMA if n < 14)
  3. Document minimum data requirements in UI/API
  4. Add unit tests for 1-day, 7-day, 14-day scenarios

#### 3. Implement Proper Error Handling in Reports
- **File:** `server/services/aiReportGenerator.ts` (line 89-125)
- **Impact:** Silent failures, misleading reports
- **Effort:** 2-3 hours
- **Steps:**
  1. Return metadata: `{report, generatedBy: 'openai'|'gguf'|'offline'}`
  2. Add confidence score to narrative
  3. Log all failures for monitoring
  4. Update frontend to display generation method

#### 4. Add Date Range Validation
- **File:** `server/routers/aiInspectionAnalyticsRouter.ts` (line 15-23)
- **Impact:** API abuse vector; OOM risk
- **Effort:** 1-2 hours
- **Steps:**
  1. Add `.refine()` check: MAX_RANGE = 90 days
  2. Validate startDate < endDate
  3. Add rate limiting (100 req/min per user)
  4. Return clear error message

#### 5. Add Database Null Checks
- **File:** `server/services/aiInspectionAnalytics.ts` (getDb() calls)
- **Impact:** Silent failures instead of meaningful errors
- **Effort:** 1-2 hours
- **Steps:**
  1. Wrap all `getDb()` calls with explicit error handling
  2. Throw `TRPCError` with code 'INTERNAL_SERVER_ERROR'
  3. Add logging
  4. Test failure scenarios

---

### Total Phase 1 Effort: **12-15 hours**  
### Target Completion: **2026-05-10**

---

## PHASE 2: PERFORMANCE OPTIMIZATION (Week 2)

### High-Impact Optimizations

#### 1. Implement Query Caching Layer
- **Files:** All routers + services
- **Effort:** 6 hours
- **Approach:**
  - Use Redis with 5-minute TTL
  - Cache key = `analytics:${period.start}:${period.end}:${machineId}`
  - Invalidate on new inspection data
  - Fallback to in-memory cache if Redis unavailable
- **Expected Improvement:** 70% reduction in DB queries

#### 2. Batch Frontend Queries
- **File:** `client/src/pages/AIInspectionAnalyticsPage.tsx`
- **Effort:** 2-3 hours
- **Approach:**
  - Create `useAnalyticsBatch()` hook
  - Use tRPC batch mode
  - Execute all queries in parallel with `Promise.all()`
  - Memoize results
- **Expected Improvement:** 3-5s → <1s load time

#### 3. Add Pagination to Tables
- **File:** `client/src/pages/AIInspectionAnalyticsPage.tsx` (machine table)
- **Effort:** 2-3 hours
- **Approach:**
  - Add `limit=10` parameter to backend queries
  - Implement pagination UI (10/20/50 items per page)
  - Or use virtual scrolling (TanStack Virtual)
- **Expected Improvement:** 200ms → 50ms render time

#### 4. Async Narrative Generation
- **File:** `server/services/aiReportGenerator.ts`
- **Effort:** 3 hours
- **Approach:**
  - Return report data immediately (200ms)
  - Queue narrative generation in background
  - Stream narrative separately
  - Update frontend with narrative when ready
- **Expected Improvement:** 5-10s → 200ms initial response

#### 5. Consolidate Risk Assessment
- **File:** `server/services/aiInspectionAnalytics.ts` (assessRisks)
- **Effort:** 1-2 hours
- **Approach:**
  - Replace 3 sequential queries with `Promise.all()`
  - Use existing `getMachinePerformance()` results from cache
  - Reuse trending data
- **Expected Improvement:** 600ms → 200ms

---

### Total Phase 2 Effort: **14-17 hours**  
### Target Completion: **2026-05-17**

---

## PHASE 3: UX & ACCURACY (Week 3)

### UX Improvements

#### 1. Comprehensive Error Handling
- **Files:** All page files
- **Effort:** 3-4 hours
- **Approach:**
  - Add error boundaries to each dashboard
  - Show inline error messages with retry buttons
  - Implement fallback UI states
  - Test all error scenarios

#### 2. Model Performance Tracking
- **Files:** `AIPerformanceDashboard.tsx`, need DB schema changes
- **Effort:** 8 hours (includes migration)
- **Approach:**
  - Create `aiModelInferences` table
  - Log actual predictions vs ground truth
  - Calculate real confusion matrix from inference data
  - Implement accuracy trending
- **Database Migration:**
  ```sql
  CREATE TABLE aiModelInferences (
    id SERIAL PRIMARY KEY,
    modelId INT NOT NULL,
    predictedClass VARCHAR(100),
    predictedConfidence FLOAT,
    actualClass VARCHAR(100),
    timestamp TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (modelId) REFERENCES aiModels(id)
  );
  CREATE INDEX idx_modelId_timestamp ON aiModelInferences(modelId, timestamp);
  ```

#### 3. Export Functionality
- **Files:** `AIInspectionAnalyticsPage.tsx`, add export service
- **Effort:** 5 hours
- **Approach:**
  - CSV export for tables (defect pareto, machine performance)
  - PNG export for charts (use `html2canvas` or Recharts export)
  - PDF export for full reports (use `html2pdf`)
  - Add download buttons to each chart/table

#### 4. Fix SPC Cpk Calculation
- **File:** `server/services/aiInspectionAnalytics.ts` (getControlChart)
- **Effort:** 2-3 hours
- **Approach:**
  - Document actual spec limits (USL=100%, LSL=0% for yield)
  - Fix Cpk formula: `cpk = min((USL-mean)/(3*sigma), (mean-LSL)/(3*sigma))`
  - Validate against Six Sigma reference tables
  - Add unit tests

#### 5. Loading States & Skeletons
- **Files:** All dashboard pages
- **Effort:** 2 hours
- **Approach:**
  - Add `Skeleton` loaders for each card
  - Show loading badge during queries
  - Animate skeleton pulse

---

### Total Phase 3 Effort: **20-23 hours**  
### Target Completion: **2026-05-24**

---

## PHASE 4: FEATURES & MONITORING (Week 4-5)

### Advanced Features

#### 1. Model Drift Detection
- **Effort:** 6-8 hours
- **Approach:**
  - Implement PSI (Population Stability Index) calculation
  - Implement KL Divergence test
  - Compare prediction distributions across time windows
  - Alert if drift detected
  - Trigger automated retraining workflow

#### 2. Period-over-Period Comparison
- **Effort:** 3-4 hours
- **Approach:**
  - Add "Compare with..." date range selector
  - Calculate deltas: yield change, defect rate change
  - Show trend arrows (↑ improvement, ↓ degradation, → stable)
  - Add comparison chart overlay

#### 3. Customizable Risk Thresholds
- **Effort:** 3-4 hours
- **Approach:**
  - Create `aiAlertThresholds` table
  - Add settings UI for factory/product-level thresholds
  - Load thresholds in risk assessment service
  - Allow per-machine overrides

#### 4. OpenTelemetry Instrumentation
- **Effort:** 3-4 hours
- **Approach:**
  - Add spans to all analytics queries
  - Track query duration, row count
  - Track cache hit/miss ratio
  - Export to Jaeger or DataDog
  - Create monitoring dashboard

#### 5. Performance Logging
- **Effort:** 2-3 hours
- **Approach:**
  - Log slow queries (> 500ms)
  - Log failed requests with error details
  - Track daily active analytics users
  - Create performance SLA dashboard

---

### Total Phase 4 Effort: **17-23 hours**  
### Target Completion: **2026-05-31**

---

## MIGRATION CHECKLIST

### Database Migrations Required

- [ ] Create `aiModelInferences` table
  ```sql
  CREATE TABLE aiModelInferences (
    id SERIAL PRIMARY KEY,
    modelId INT NOT NULL REFERENCES aiModels(id),
    predictedClass VARCHAR(100),
    predictedConfidence FLOAT,
    actualClass VARCHAR(100),
    timestamp TIMESTAMP DEFAULT NOW(),
    INDEX idx_modelId_timestamp (modelId, timestamp)
  );
  ```

- [ ] Create `aiAlertThresholds` table
  ```sql
  CREATE TABLE aiAlertThresholds (
    id SERIAL PRIMARY KEY,
    factoryId INT REFERENCES factories(id),
    productModelId INT,
    metricName VARCHAR(100),
    criticalThreshold FLOAT,
    highThreshold FLOAT,
    mediumThreshold FLOAT,
    updatedAt TIMESTAMP DEFAULT NOW()
  );
  ```

- [ ] Add indexes to `productInspections`
  ```sql
  CREATE INDEX idx_inspectionTime ON productInspections(inspectionTime);
  CREATE INDEX idx_machineId_inspectionTime ON productInspections(machineId, inspectionTime);
  CREATE INDEX idx_factoryCode_inspectionTime ON productInspections(factoryCode, inspectionTime);
  ```

---

## TESTING CHECKLIST

### Unit Tests to Add

- [ ] `aiInspectionAnalytics.test.ts`
  - [ ] getDefectTrend with 0 data
  - [ ] forecastYield with 5 days (< min requirement)
  - [ ] assessRisks with declining machine
  - [ ] correlationAnalysis with < 5 samples

- [ ] `aiTimeSeriesEngine.test.ts`
  - [ ] holtWinters with n < seasonLength*2
  - [ ] EWMA anomaly detection
  - [ ] Isolation Forest scoring

- [ ] `aiReportGenerator.test.ts`
  - [ ] Report generation with no OpenAI key
  - [ ] Narrative fallback chain
  - [ ] Error metadata returns

### Integration Tests

- [ ] Load analytics page → all queries < 2s
- [ ] Export chart to CSV → file valid
- [ ] Rate limit exceeded → 429 error
- [ ] Invalid date range → validation error

### Performance Tests

- [ ] Correlation analysis 90d×50m → < 500ms
- [ ] Risk assessment parallel → < 300ms
- [ ] Report generation → < 1s data

---

## DEPLOYMENT CHECKLIST

### Before Going to Production

- [ ] Phase 1 critical fixes applied
- [ ] All database migrations run
- [ ] Cache infrastructure (Redis) deployed
- [ ] Rate limiting configured
- [ ] Error logging configured
- [ ] Monitoring dashboard created
- [ ] Team trained on new error handling
- [ ] Documentation updated
- [ ] User guide updated with new features
- [ ] Performance baseline established

### Rollback Plan

- [ ] Keep previous version deployed on staging
- [ ] Database migration is reversible (add column → remove column)
- [ ] Feature flags for new analytics endpoints
- [ ] Gradual rollout: 10% → 50% → 100%

---

## MONITORING & METRICS

### Key Metrics to Track

```
aiAnalytics.query.duration_ms
├── defectTrend
├── defectPareto
├── machinePerformance
├── yieldForecast
├── correlations
└── riskAssessment

aiAnalytics.cache.hits
aiAnalytics.cache.misses

aiAnalytics.report.generation_time_ms
├── openai_provider
├── gguf_provider
└── offline_fallback

aiAnalytics.errors
├── query_timeout
├── invalid_input
├── db_connection_error
└── narrative_generation_error

aiAnalytics.rps (requests per second)
```

### Alerting Rules

```
- CRITICAL: cache.hits < 0.5 (cache missing)
- CRITICAL: query.duration > 5000ms (slow query)
- HIGH: errors.count > 10/min
- HIGH: rps > 1000
- MEDIUM: narrative_generation_failures > 20%
```

---

## ESTIMATED TIMELINE

| Phase | Duration | Effort | Target Date |
|-------|----------|--------|-------------|
| Phase 1: Critical Fixes | 1-2 weeks | 12-15h | 2026-05-10 |
| Phase 2: Performance | 1 week | 14-17h | 2026-05-17 |
| Phase 3: UX & Accuracy | 1 week | 20-23h | 2026-05-24 |
| Phase 4: Features & Monitor | 2 weeks | 17-23h | 2026-05-31 |
| **Total** | **5 weeks** | **70 hours** | **2026-05-31** |

---

## RESPONSIBLE PARTIES

- **Phase 1 & 2:** Backend Engineer + Frontend Engineer
- **Phase 3:** Full-stack Engineer + UI/UX Designer
- **Phase 4:** DevOps + Monitoring Engineer

---

## SIGN-OFF

**Audit Completed:** 2026-05-05  
**Module Status:** Ready for production (with Phase 1 fixes)  
**Next Review:** After Phase 1 implementation (2026-05-10)

---

## CONTACTS & ESCALATION

- **Critical Issues:** Report to Tech Lead immediately
- **Performance Issues:** Escalate to Infrastructure team
- **Feature Requests:** Add to Product backlog with priority

---

*End of AI Analytics Module Action Items*
