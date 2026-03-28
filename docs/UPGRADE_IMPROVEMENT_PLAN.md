# AVI-AOI Management System — Upgrade & Improvement Plan

> **Report Date:** 2025-07-17  
> **Based On:** System Audit Report (SYSTEM_AUDIT_REPORT.md)  
> **Current Version:** 1.0.0  
> **Target Version:** 2.0.0

---

## Table of Contents

1. [Current State Assessment](#1-current-state-assessment)
2. [Phase 1: Critical Security Fixes (Immediate)](#2-phase-1-critical-security-fixes)
3. [Phase 2: Bug Fixes & Data Integrity (1-2 Weeks)](#3-phase-2-bug-fixes--data-integrity)
4. [Phase 3: Security Hardening (2-4 Weeks)](#4-phase-3-security-hardening)
5. [Phase 4: Architecture Improvements (1-2 Months)](#5-phase-4-architecture-improvements)
6. [Phase 5: Feature Completion & Polish (2-3 Months)](#6-phase-5-feature-completion--polish)
7. [Migration Checklist](#7-migration-checklist)
8. [Dependency Audit](#8-dependency-audit)

---

## 1. Current State Assessment

### Technology Stack
| Component | Technology | Version | Status |
|-----------|-----------|---------|--------|
| Runtime | Node.js | LTS | ✅ Current |
| Backend Framework | Express.js | 4.21.2 | ✅ Stable |
| API Layer | tRPC | 11.6.0 | ✅ Current |
| ORM | Drizzle ORM | 0.44.6 | ✅ Current |
| Database | PostgreSQL | - | ✅ Production-ready |
| DB Driver | postgres-js | 3.4.8 | ✅ Current |
| Frontend | React | 19.2.1 | ✅ Latest |
| State/Fetch | TanStack React Query | 5.90.2 | ✅ Current |
| Validation | Zod | 4.1.12 | ✅ Latest |  
| Auth | jose (JWT) | 6.1.0 | ✅ Current |
| Password Hash | bcryptjs | 3.0.3 | ✅ Current |
| Caching | ioredis | 5.9.2 | ✅ Current | 
| MQTT | aedes (broker) + mqtt (client) | 0.51.3 / 5.14.1 | ✅ Current |
| Build | Vite + esbuild | - | ✅ Modern |
| TypeScript | strict: true | - | ✅ Good |

### Strengths
- Modern tech stack with up-to-date dependencies
- TypeScript strict mode enabled
- tRPC provides type-safe API layer
- Zod validation on most router inputs
- Redis with automatic fallback to in-memory cache
- 42 existing test files with Vitest
- Well-structured module architecture (15 DB modules, 50+ routers, 24 services)
- MQTT integration for real-time machine communication
- i18n support with i18next
- Assignment-based access control system

### Weaknesses Identified in Audit
- SQL injection vulnerabilities in raw SQL patterns
- Broken audit log system
- Incomplete PostgreSQL migration (MySQL patterns remain)
- Binary authorization model despite 7-role enum
- No CI/CD pipeline
- No structured logging
- No API documentation generation (OpenAPI)
- Missing database constraints and foreign keys
- No rate limiting or CSRF protection

---

## 2. Phase 1: Critical Security Fixes

**Priority:** 🔴 IMMEDIATE — Deploy before any production traffic  
**Estimated Impact:** Eliminates all Critical-severity vulnerabilities

### 2.1 Fix SQL Injection in Statistics Module

**Files:** `server/db/statistics.ts`

Replace all `sql.raw()` with string interpolation with parameterized Drizzle queries.

**getDailyStats() fix:**
```typescript
// BEFORE (vulnerable):
const result = await db.execute(sql.raw(`
  SELECT ... WHERE "inspectionTime" >= '${startDateStr}' ...
`));

// AFTER (safe):
const result = await db.execute(sql`
  SELECT 
    TO_CHAR(${productInspections.inspectionTime}, 'YYYY-MM-DD') as date,
    COUNT(*) as "totalProducts",
    SUM(CASE WHEN ${productInspections.overallResult} = 'OK' THEN 1 ELSE 0 END) as "okCount",
    SUM(CASE WHEN ${productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END) as "ngCount",
    SUM(CASE WHEN ${productInspections.overallResult} = 'NTF' THEN 1 ELSE 0 END) as "ntfCount"
  FROM ${productInspections}
  WHERE ${productInspections.inspectionTime} >= ${startDate}
  GROUP BY TO_CHAR(${productInspections.inspectionTime}, 'YYYY-MM-DD')
  ORDER BY date DESC
`);
```

**getHourlyStats() fix:** Same pattern — eliminate `machineCondition` string concatenation, use conditional `sql` fragments:
```typescript
const conditions = [sql`${productInspections.inspectionTime} >= ${startDate}`];
if (filters?.machineId) {
  conditions.push(sql`${productInspections.machineId} = ${filters.machineId}`);
}
const whereClause = sql.join(conditions, sql` AND `);
```

**Corporate/Factory stats fix:** Replace `corporateCodes.map(c => \`'${c}'\`).join(',')` with `inArray()`:
```typescript
import { inArray } from "drizzle-orm";
conditions.push(inArray(productInspections.corporateCode, corporateCodes));
```

### 2.2 Fix SQL Injection in Machine Module

**File:** `server/db/machine.ts`

Replace `machineIds.join(',')` pattern:
```typescript
// BEFORE:
conditions.push(sql`${productInspections.machineId} IN (${machineIds.join(',')})`);

// AFTER:
conditions.push(inArray(productInspections.machineId, machineIds));
```

### 2.3 Fix Broken Audit Log Query

**File:** `server/db/system.ts`

Complete rewrite of `getAuditLogs()` using Drizzle query builder:
```typescript
export async function getAuditLogs(params: { ... }): Promise<...> {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  const conditions: SQL[] = [];
  if (params.userId) conditions.push(eq(auditLogs.userId, params.userId));
  if (params.action) conditions.push(eq(auditLogs.action, params.action));
  if (params.entityType) conditions.push(eq(auditLogs.entityType, params.entityType));
  if (params.entityId) conditions.push(eq(auditLogs.entityId, params.entityId));
  if (params.status) conditions.push(eq(auditLogs.status, params.status));
  if (params.startDate) conditions.push(gte(auditLogs.createdAt, params.startDate));
  if (params.endDate) conditions.push(lte(auditLogs.createdAt, params.endDate));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = params.limit || 50;
  const offset = params.offset || 0;

  const [countResult, logs] = await Promise.all([
    db.select({ count: sql<number>`COUNT(*)` }).from(auditLogs).where(whereClause),
    db.select().from(auditLogs).where(whereClause)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit).offset(offset),
  ]);

  return { logs, total: Number(countResult[0]?.count) || 0 };
}
```

### 2.4 Fix Path Traversal in Storage

**File:** `server/storage.ts`

```typescript
// Add after resolving filePath:
const resolved = path.resolve(filePath);
if (!resolved.startsWith(path.resolve(uploadsRoot) + path.sep)) {
  throw new Error("Invalid storage key");
}
```

---

## 3. Phase 2: Bug Fixes & Data Integrity

**Priority:** 🟠 HIGH — Complete within 1-2 weeks  
**Estimated Impact:** Fixes broken features and data integrity issues

### 3.1 Add UNIQUE Constraint to `daily_statistics`

Create a new Drizzle migration:
```sql
-- Migration: add_unique_constraint_daily_statistics.sql
ALTER TABLE daily_statistics 
ADD CONSTRAINT uq_daily_stats_machine_date UNIQUE ("machineId", "date");
```

Or update `drizzle/schema/production.ts`:
```typescript
import { uniqueIndex } from "drizzle-orm/pg-core";
// Replace:
index("idx_stats_machine_date").on(table.machineId, table.date),
// With:
uniqueIndex("uq_stats_machine_date").on(table.machineId, table.date),
```

Then run: `pnpm db:push`

### 3.2 Fix Role System Mismatch

**File:** `server/db/auth.ts`

```typescript
// BEFORE:
export async function updateUserRole(userId: number, role: 'user' | 'admin') {

// AFTER — accept all enum roles:
type UserRole = 'admin' | 'supervisor' | 'quality_inspector' | 'operator' | 'maintenance' | 'viewer' | 'user';
export async function updateUserRole(userId: number, role: UserRole) {
```

### 3.3 Add File Type Validation to Storage

**File:** `server/storage.ts`

```typescript
const ALLOWED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',  // Images
  '.pdf', '.csv', '.xlsx', '.xls',                     // Documents
  '.zip', '.json', '.xml',                              // Data files
]);

export async function storagePut(relKey: string, data: Buffer | Uint8Array | string, contentType = "application/octet-stream") {
  const key = normalizeKey(relKey);
  const ext = path.extname(key).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`File type '${ext}' not allowed`);
  }
  // ... rest of function
}
```

### 3.4 Sanitize HTML in Report Preview

**File:** `client/src/pages/ScheduledReports.tsx`

```bash
pnpm add dompurify @types/dompurify
```

```typescript
import DOMPurify from 'dompurify';

// BEFORE:
dangerouslySetInnerHTML={{ __html: previewHtml }}

// AFTER:
dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(previewHtml) }}
```

### 3.5 Remove Unused `mysql2` Dependency

```bash
pnpm remove mysql2
```

Audit remaining MySQL-style patterns and convert to PostgreSQL syntax.

---

## 4. Phase 3: Security Hardening

**Priority:** 🟡 MEDIUM — Complete within 2-4 weeks  
**Estimated Impact:** Production-grade security posture

### 4.1 Add Rate Limiting

```bash
pnpm add express-rate-limit
```

**File:** `server/_core/index.ts`
```typescript
import rateLimit from 'express-rate-limit';

// Auth endpoints: strict limits
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                    // 10 attempts per window
  message: { error: 'Too many login attempts, try again later' },
});
app.use('/api/auth/login', authLimiter);

// General API: generous limits
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 200,                   // 200 requests per minute
});
app.use('/api', apiLimiter);
```

### 4.2 Add CSRF Protection

```bash
pnpm add csrf-csrf
```

Apply CSRF tokens to all state-changing Express REST routes (non-tRPC).

### 4.3 Add Global Error Handlers

**File:** `server/_core/index.ts`
```typescript
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection:', reason);
  // Log to monitoring/alerting system
});

process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error);
  process.exit(1); // Let process manager restart
});
```

### 4.4 Sanitize Error Messages to Client

Create a centralized error formatter for tRPC:
```typescript
// server/_core/trpc.ts
const errorFormatter = ({ shape, error }) => ({
  ...shape,
  message: error.code === 'INTERNAL_SERVER_ERROR' 
    ? 'An unexpected error occurred' 
    : shape.message,
  data: {
    ...shape.data,
    stack: process.env.NODE_ENV === 'production' ? undefined : shape.data?.stack,
  },
});
```

### 4.5 Add Input Length Limits

**File:** `server/routers/systemRouters.ts`

Add `.max()` to all unbounded string inputs:
```typescript
key: z.string().max(255),
value: z.string().max(10000),
footerText: z.string().max(5000),
socialLinks: z.string().max(2000),
```

### 4.6 Validate ZIP Extraction Paths

**File:** `server/routers/aoiPackageRouter.ts`

When extracting ZIP files, validate each entry path:
```typescript
for (const [entryPath, entry] of Object.entries(zip.files)) {
  const resolved = path.resolve(targetDir, entryPath);
  if (!resolved.startsWith(path.resolve(targetDir) + path.sep)) {
    throw new Error(`Zip Slip detected: ${entryPath}`);
  }
}
```

---

## 5. Phase 4: Architecture Improvements

**Priority:** 🔵 PLANNED — Complete within 1-2 months  
**Estimated Impact:** Maintainability, scalability, observability

### 5.1 Implement Granular Role-Based Access Control (RBAC)

The system defines 7 roles but only enforces 2 (admin/user). Implement full RBAC:

```typescript
// server/_core/trpc.ts — New role-based procedures
function createRoleProcedure(...allowedRoles: UserRole[]) {
  return protectedProcedure.use(async ({ ctx, next }) => {
    if (!allowedRoles.includes(ctx.user.role as UserRole)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
    }
    return next({ ctx });
  });
}

// Usage examples:
export const supervisorProcedure = createRoleProcedure('admin', 'supervisor');
export const inspectorProcedure = createRoleProcedure('admin', 'supervisor', 'quality_inspector');
export const operatorProcedure = createRoleProcedure('admin', 'supervisor', 'operator');
export const viewerProcedure = createRoleProcedure('admin', 'supervisor', 'quality_inspector', 'operator', 'maintenance', 'viewer');
```

**Permission matrix to implement:**

| Module | admin | supervisor | quality_inspector | operator | maintenance | viewer |
|--------|-------|------------|-------------------|----------|-------------|--------|
| User Management | CRUD | Read | — | — | — | — |
| Factory Hierarchy | CRUD | CRUD | Read | Read | Read | Read |
| Production Orders | CRUD | CRUD | Read | Read | — | Read |
| Inspections | CRUD | CRUD | CRUD | Create/Read | — | Read |
| Statistics/Reports | Full | Full | Full | Limited | — | Read |
| Machine Config | CRUD | CRUD | Read | Read | CRUD | Read |
| Alert Settings | CRUD | CRUD | Read | — | Read | — |
| System Settings | CRUD | — | — | — | — | — |

### 5.2 Add Structured Logging

Replace `console.log` with structured logging:

```bash
pnpm add pino pino-pretty
```

```typescript
// server/_core/logger.ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development' 
    ? { target: 'pino-pretty' } 
    : undefined,
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
  redact: ['req.headers.authorization', 'req.headers.cookie'],
});
```

Replace all `console.log/error/warn` calls with `logger.info/error/warn`.

### 5.3 Add CI/CD Pipeline

Create `.github/workflows/ci.yml`:

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: avi_aoi_test
          POSTGRES_PASSWORD: test
        ports: ['5432:5432']
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm check        # TypeScript check
      - run: pnpm test          # Vitest
        env:
          DATABASE_URL: postgresql://postgres:test@localhost:5432/avi_aoi_test
```

### 5.4 Add Database Foreign Key Constraints

Add missing foreign keys via migration:

```sql
ALTER TABLE daily_statistics 
  ADD CONSTRAINT fk_daily_stats_machine 
  FOREIGN KEY ("machineId") REFERENCES machines(id) ON DELETE CASCADE;

ALTER TABLE daily_statistics 
  ADD CONSTRAINT fk_daily_stats_factory 
  FOREIGN KEY ("factoryId") REFERENCES factories(id);

ALTER TABLE daily_statistics 
  ADD CONSTRAINT fk_daily_stats_workshop 
  FOREIGN KEY ("workshopId") REFERENCES workshops(id);
```

Apply similar constraints to other tables missing FK references.

### 5.5 Add API Documentation Generation

Since the API uses tRPC, consider `trpc-openapi` for auto-generating OpenAPI specs:

```bash
pnpm add trpc-openapi
```

Or generate from the existing tRPC router types to create Swagger documentation automatically.

### 5.6 Configure Database Connection Pool

**File:** `server/db/connection.ts`

```typescript
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, {
  max: 20,                    // Maximum pool connections
  idle_timeout: 30,           // Seconds before closing idle connections
  connect_timeout: 10,        // Connection timeout in seconds
  max_lifetime: 60 * 30,     // 30 minutes max connection lifetime
});
```

---

## 6. Phase 5: Feature Completion & Polish

**Priority:** 🟣 ENHANCEMENT — Complete within 2-3 months  
**Estimated Impact:** User experience and operational readiness

### 6.1 Increase Test Coverage

Current state: 42 test files exist, primarily for server modules.

**Areas needing tests:**
- SQL injection regression tests (validate all fixed queries)
- Access control / RBAC tests per role
- Storage module (path traversal prevention)
- Audit log functionality (after fix)
- Integration tests for tRPC routers
- End-to-end tests for critical workflows

### 6.2 Add Health Check Endpoint

```typescript
app.get('/health', async (req, res) => {
  const checks = {
    database: false,
    redis: false,
    mqtt: false,
  };
  try {
    const db = await getDb();
    await db.execute(sql`SELECT 1`);
    checks.database = true;
  } catch {}
  try {
    const stats = await redisService.getStats();
    checks.redis = stats.isRedisConnected;
  } catch {}
  // MQTT check...
  
  const healthy = Object.values(checks).every(Boolean);
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'degraded', checks });
});
```

### 6.3 Add Database Migration CI Check

Ensure `drizzle-kit generate` produces no diff in CI, preventing schema drift.

### 6.4 Client-Side Error Boundary Improvements

Add structured error boundaries for different app sections instead of a single top-level catch.

### 6.5 Standardize Error Response Format

Create a central error response helper:
```typescript
interface ApiError {
  success: false;
  error: { code: string; message: string };
}
```

Apply uniformly across all Express REST endpoints.

---

## 7. Migration Checklist

### Pre-Deployment Checklist

- [ ] **Phase 1 complete** — All Critical security fixes applied
- [ ] **Phase 2 complete** — All High-priority bugs fixed
- [ ] Run full test suite: `pnpm test`
- [ ] Run TypeScript check: `pnpm check`
- [ ] Run database migration: `pnpm db:push`
- [ ] Verify `daily_statistics` UNIQUE constraint is active
- [ ] Verify audit log query returns correct results
- [ ] Test storage upload with `../` in key (should be rejected)
- [ ] Verify all `sql.raw()` patterns have been replaced
- [ ] Remove `mysql2` from dependencies
- [ ] Review environment variables for production
- [ ] Ensure `NODE_ENV=production` is set
- [ ] Configure database connection pool parameters
- [ ] Set up monitoring/alerting for unhandled rejections

### Post-Deployment Verification

- [ ] Verify audit logs are recording correctly
- [ ] Verify daily statistics upsert works (no duplicate rows)
- [ ] Verify file uploads are restricted to allowed types
- [ ] Run a load test to verify connection pool settings
- [ ] Monitor error rates for 24 hours post-deploy

---

## 8. Dependency Audit

### Dependencies to Remove
| Package | Reason |
|---------|--------|
| `mysql2` | PostgreSQL migration complete; no MySQL usage found |

### Dependencies to Add
| Package | Purpose | Phase |
|---------|---------|-------|
| `dompurify` + `@types/dompurify` | XSS sanitization for HTML previews | Phase 2 |
| `express-rate-limit` | Rate limiting for auth endpoints | Phase 3 |
| `pino` + `pino-pretty` | Structured logging | Phase 4 |
| `helmet` | Security headers middleware | Phase 3 |

### Dependencies to Monitor
| Package | Current | Notes |
|---------|---------|-------|
| `express` | 4.21.2 | Express 5.x is available — evaluate when stable |
| `speakeasy` | 2.0.0 | Unmaintained — consider `otpauth` as replacement |
| `html2pdf` | 0.0.11 | Very old, consider `puppeteer`-based approach (already in deps) |

---

## Version Roadmap

| Version | Phases | Focus |
|---------|--------|-------|
| **1.1.0** | Phase 1 + 2 | Security fixes + Bug fixes |
| **1.2.0** | Phase 3 | Security hardening |
| **1.5.0** | Phase 4 | Architecture improvements |
| **2.0.0** | Phase 5 | Full RBAC + CI/CD + Structured logging |

---

*Report generated by SystemQA & Seeder Agent*
