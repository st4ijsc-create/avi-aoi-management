# AVI-AOI Management System — System Audit Report

> **Report Date:** 2025-07-17  
> **Scope:** Full system audit covering security, bugs, code quality, and architecture  
> **System Version:** 1.0.0  
> **Stack:** Node.js + Express + tRPC v11 + Drizzle ORM 0.44.6 + PostgreSQL + React 19

---

## Executive Summary

A comprehensive audit of the AVI-AOI Management system uncovered **5 Critical**, **6 High**, **8 Medium**, and **5 Low** severity issues across security, data integrity, and code quality domains. The most urgent findings are **SQL injection vulnerabilities** in the statistics and machine modules, a **broken audit log query**, and a **missing database constraint** causing upsert failures.

| Severity | Count | Key Areas |
|----------|-------|-----------|
| 🔴 Critical | 5 | SQL Injection (4 locations), Broken Audit Logs |
| 🟠 High | 6 | Missing UNIQUE constraint, Path traversal, Role mismatch, XSS |
| 🟡 Medium | 8 | Input validation gaps, Error leakage, No rate limiting |
| 🟢 Low | 5 | Code style, Missing process handlers, Log verbosity |

---

## 🔴 Critical Findings

### C-01: SQL Injection in `getDailyStats()` — `server/db/statistics.ts`

**Location:** `server/db/statistics.ts` (~line 410)  
**Type:** SQL Injection via `sql.raw()` with string interpolation

```typescript
// VULNERABLE — startDateStr is derived from user-controlled `days` parameter
const startDateStr = startDate.toISOString().slice(0, 19).replace('T', ' ');
const result = await db.execute(sql.raw(`
  SELECT ... FROM product_inspections
  WHERE "inspectionTime" >= '${startDateStr}'  -- String interpolation into raw SQL
  GROUP BY date ORDER BY date DESC
`));
```

**Risk:** While `startDateStr` is derived from `Date()` arithmetic (reducing direct injection risk), the pattern of using `sql.raw()` with string interpolation is inherently dangerous and sets a precedent for future copy-paste bugs.

**Recommended Fix:** Use parameterized queries via Drizzle's template literals:
```typescript
const result = await db.execute(sql`
  SELECT ... FROM product_inspections
  WHERE ${productInspections.inspectionTime} >= ${startDate}
  GROUP BY ...
`);
```

---

### C-02: SQL Injection in `getHourlyStats()` — `server/db/statistics.ts`

**Location:** `server/db/statistics.ts` (~line 450)  
**Type:** Direct number interpolation into raw SQL

```typescript
// VULNERABLE — filters.machineId directly interpolated
let machineCondition = '';
if (filters?.machineId) {
  machineCondition = ` AND "machineId" = ${filters.machineId}`;
}
const result = await db.execute(sql.raw(`
  ... WHERE "inspectionTime" >= '${startDateStr}'${machineCondition}
  ...
`));
```

**Risk:** If `machineId` can be manipulated to a string value (e.g., via tRPC type coercion bypass or upstream code), this enables full SQL injection. Even though tRPC Zod validation may protect externally, internal callers are unprotected.

**Recommended Fix:** Use parameterized queries with Drizzle's expression builder.

---

### C-03: SQL Injection in Corporate/Factory Statistics — `server/db/statistics.ts`

**Location:** `server/db/statistics.ts` (~lines 1482-1483, 1539-1544)  
**Type:** String values directly interpolated into IN clause

```typescript
// VULNERABLE — corporateCodes/factoryCodes from database, but pattern is dangerous
const corporateCodes = corporateAssignments.map(a => a.corporateCode);
conditions.push(
  sql`${productInspections.corporateCode} IN (${corporateCodes.map(c => `'${c}'`).join(',')})`
);
```

**Risk:** If a corporate code stored in the database contains a single quote (`'`), this produces a SQL injection. Stored XSS via corporate code → SQL injection chain.

**Recommended Fix:** Use Drizzle's `inArray()` operator:
```typescript
conditions.push(inArray(productInspections.corporateCode, corporateCodes));
```

---

### C-04: SQL Injection in `getWorkstationErrors()` / `getWorkstationErrorSummary()` — `server/db/machine.ts`

**Location:** `server/db/machine.ts` (~lines 553, 604)  
**Type:** Integer array joined into SQL template literal

```typescript
// VULNERABLE — machineIds.join(',') in SQL template
const machineIds = stationMachines.map(m => m.id);
conditions.push(sql`${productInspections.machineId} IN (${machineIds.join(',')})`);
```

**Risk:** While `machineIds` are integer IDs from a database SELECT, if the intermediate query is compromised or the IDs are manipulated, this enables injection. The `sql` template literal does NOT automatically parameterize the result of `.join(',')` — it's treated as a literal string.

**Recommended Fix:** Use Drizzle's `inArray()`:
```typescript
conditions.push(inArray(productInspections.machineId, machineIds));
```

---

### C-05: Broken Audit Log Query — `server/db/system.ts`

**Location:** `server/db/system.ts` (~lines 100-160)  
**Type:** Query construction bug — parameters never bound

```typescript
// BUG — MySQL-style '?' placeholders used with sql.raw(), values array NEVER used
const conditions: string[] = [];
const values: any[] = [];

if (params.userId) {
  conditions.push("userId = ?");   // MySQL placeholder
  values.push(params.userId);       // Value added but never used
}
// ... more conditions with '?' ...

const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
let countQuery = `SELECT COUNT(*) as total FROM audit_logs ${whereClause}`;

// sql.raw() passes the literal string including '?' characters — no binding
const countResult = await db.execute(sql`${sql.raw(countQuery)}`);
// ^ values array is NEVER passed!
```

**Impact:** 
1. **All audit log filtering is completely broken** — `?` characters are sent literally to PostgreSQL  
2. PostgreSQL will likely error on the query or return no results  
3. The `values` array is built but never used anywhere  
4. No audit trail functionality = compliance risk

**Recommended Fix:** Rewrite using Drizzle's query builder:
```typescript
import { auditLogs } from "../../drizzle/schema";

const conditions: SQL[] = [];
if (params.userId) conditions.push(eq(auditLogs.userId, params.userId));
if (params.action) conditions.push(eq(auditLogs.action, params.action));
// ... etc
const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
const results = await db.select().from(auditLogs).where(whereClause)...;
```

---

## 🟠 High Findings

### H-01: Missing UNIQUE Constraint on `daily_statistics` — Schema Bug

**Location:** `drizzle/schema/production.ts` (~line 25)  
**Type:** Missing database constraint causing upsert failure

The `dailyStatistics` table defines a regular INDEX on `(machineId, date)`:
```typescript
index("idx_stats_machine_date").on(table.machineId, table.date),
```

But `upsertDailyStatistics()` in `server/db/statistics.ts` uses `onConflictDoUpdate`:
```typescript
await db.insert(dailyStatistics).values(data).onConflictDoUpdate({
  target: [dailyStatistics.machineId, dailyStatistics.date],
  // ^ REQUIRES a UNIQUE constraint or PRIMARY KEY
});
```

**Impact:** PostgreSQL error `42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification`. All daily statistics upserts fail silently or throw errors.

**Fix:** Add a migration to create a UNIQUE constraint:
```sql
ALTER TABLE daily_statistics 
ADD CONSTRAINT uq_daily_stats_machine_date UNIQUE ("machineId", "date");
```

Or in the Drizzle schema:
```typescript
import { uniqueIndex } from "drizzle-orm/pg-core";
// Replace index with uniqueIndex:
uniqueIndex("uq_stats_machine_date").on(table.machineId, table.date),
```

---

### H-02: Path Traversal in File Storage — `server/storage.ts`

**Location:** `server/storage.ts` (~lines 85-95)  
**Type:** Path traversal via unsanitized file key

```typescript
// VULNERABLE — 'key' is only normalized to remove leading slashes
const key = normalizeKey(relKey); // Only removes leading '/'
const filePath = path.join(uploadsRoot, key);
// If key = "../../etc/passwd" → filePath escapes uploadsRoot
await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
await fs.promises.writeFile(filePath, Buffer.from(data));
```

**Impact:** In `local` storage mode, an attacker could write files outside the uploads directory, potentially overwriting server code or configuration.

**Fix:** Validate that the resolved path remains within `uploadsRoot`:
```typescript
const filePath = path.join(uploadsRoot, key);
const resolved = path.resolve(filePath);
if (!resolved.startsWith(path.resolve(uploadsRoot))) {
  throw new Error("Invalid storage key: path traversal detected");
}
```

---

### H-03: Role System Mismatch — `server/db/auth.ts`

**Location:** `server/db/auth.ts` (line 90) vs `drizzle/schema/enums.ts` (lines 5-13)

The role enum defines **7 roles**:
```typescript
export const roleEnum = pgEnum("roleenum", [
  "admin", "supervisor", "quality_inspector", "operator", 
  "maintenance", "viewer", "user"
]);
```

But `updateUserRole()` only accepts **2**:
```typescript
export async function updateUserRole(userId: number, role: 'user' | 'admin') {
  // ^ Only 'user' | 'admin' — cannot assign supervisor, operator, etc.
}
```

Additionally, `adminProcedure` only checks `role === 'admin'`, making the 5 intermediate roles (`supervisor`, `quality_inspector`, `operator`, `maintenance`, `viewer`) functionally identical to `user` for authorization purposes.

**Impact:** No granular role-based access control despite having roles defined in the schema. All non-admin users have the same access level.

---

### H-04: XSS via `dangerouslySetInnerHTML` in ScheduledReports

**Location:** `client/src/pages/ScheduledReports.tsx` (line 508)

```tsx
<div 
  className="border rounded-lg p-4 bg-white"
  dangerouslySetInnerHTML={{ __html: previewHtml }}
/>
```

The `previewHtml` comes from an API response (`result.data.html`). If the report template or data includes user-controlled content that isn't sanitized server-side, this is a stored XSS vector.

**Fix:** Sanitize HTML with DOMPurify before rendering:
```typescript
import DOMPurify from 'dompurify';
dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(previewHtml) }}
```

---

### H-05: No File Type Validation on Upload

**Location:** `server/storage.ts` — `storagePut()` function  
**Type:** Missing input validation

The `storagePut()` function accepts any content type and writes files without validation:
- No file extension whitelist
- No MIME type checking  
- No file size limits at the storage layer
- No content scanning (e.g., for executable content)

**Impact:** Attackers could upload executable scripts, HTML files with XSS payloads, or oversized files for DoS.

---

### H-06: ZIP Extraction Without Path Validation — AOI Package Router

**Location:** `server/routers/aoiPackageRouter.ts`  
**Type:** Potential Zip Slip

When extracting AOI packages (ZIP files), if the extracted file paths aren't validated against directory traversal patterns (`../`), a malicious ZIP could write files outside the intended directory (Zip Slip vulnerability).

---

## 🟡 Medium Findings

### M-01: Unbounded String Inputs in System Settings

**Location:** `server/routers/systemRouters.ts`

Several tRPC input schemas use `z.string()` without length limits:
```typescript
key: z.string(),
value: z.string(),    // Could be megabytes of data
footerText: z.string(),
socialLinks: z.string(),
```

**Impact:** Memory exhaustion or storage abuse via extremely large string values.

**Fix:** Add `.max()` constraints: `z.string().max(10000)` or similar appropriate limits.

---

### M-02: Error Messages Leaking to Client

**Location:** Multiple tRPC routers  
**Type:** Information disclosure

Error messages are passed directly to the frontend:
```typescript
// Client-side
toast.error(t("common.errorWithMessage", { message: error.message }));
```

tRPC by default exposes error messages from thrown `TRPCError` instances to the client, which may reveal:
- Database column names and constraints
- Internal file paths
- Stack traces in development mode

**Fix:** Use generic error messages for client-facing errors and log detailed errors server-side.

---

### M-03: No Rate Limiting on Authentication

**Location:** `server/routers/` — login/authentication endpoints  
**Type:** Missing security control

No rate limiting middleware was found on authentication endpoints. This exposes the system to:
- Brute force password attacks  
- Credential stuffing  
- Account enumeration timing attacks

**Fix:** Add express-rate-limit middleware specifically for auth routes.

---

### M-04: No Global `unhandledRejection` Handler

**Location:** `server/_core/index.ts`  
**Type:** Missing error handler

The server has `SIGTERM` and `SIGINT` handlers but no `unhandledRejection` or `uncaughtException` handlers. Unhandled promise rejections in Node.js 15+ cause the process to crash.

**Fix:**
```typescript
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Log to monitoring system
});
```

---

### M-05: Console Logging of Sensitive Data

**Location:** Multiple locations  
**Type:** Information disclosure

- `client/src/main.tsx`: Logs full API error objects to browser console
- Android MQTT app: Logs push notification registration tokens
- Various `catch` blocks log full error objects including potential PII

---

### M-06: `mysql2` Dependency Not Used or Partially Used

**Location:** `package.json` — `"mysql2": "^3.15.0"`

The system uses PostgreSQL with the `postgres` package (postgres-js). The `mysql2` dependency appears to be leftover from a migration or dual-database support attempt. The `getAuditLogs` function in `system.ts` still uses MySQL-style `?` placeholders — evidence of incomplete migration.

**Impact:** Unnecessary attack surface from extra dependency; indicates incomplete PostgreSQL migration.

---

### M-07: `adminProcedure` Binary Authorization Model

**Location:** `server/_core/trpc.ts`

Authorization is effectively binary: admin or not-admin. The `protectedProcedure` only checks if `ctx.user` exists, not the user's role. This means:
- A `viewer` can perform the same operations as a `supervisor`
- An `operator` can access quality inspection admin functions
- Only `admin` has any differentiation

**Fix:** Implement role-based procedure creators:
```typescript
function createRoleProcedure(...roles: string[]) {
  return protectedProcedure.use(async ({ ctx, next }) => {
    if (!roles.includes(ctx.user.role)) throw new TRPCError({ code: 'FORBIDDEN' });
    return next({ ctx });
  });
}
```

---

### M-08: No CSRF Protection on Express Routes

**Location:** `server/_core/index.ts`  
**Type:** Missing security control

The Express server exposes REST endpoints (machine API, file uploads, OAuth callbacks) without CSRF token validation. While tRPC endpoints are somewhat protected by content-type checking, the Express REST routes are vulnerable.

---

## 🟢 Low Findings

### L-01: `innerHTML` for Static Fallback Content

**Location:** `client/src/pages/AOIPackages.tsx` (lines 722, 895)

Image `onError` handlers use `innerHTML` to set fallback placeholder SVGs. While the content is hardcoded (not user-controlled), using `innerHTML` is a poor practice that could become a vulnerability if the pattern is copied elsewhere.

### L-02: Missing Database Foreign Keys

Several tables lack foreign key constraints (e.g., `dailyStatistics.machineId` → `machines.id`), relying on application-level integrity. This allows orphaned records.

### L-03: Inconsistent Error Response Format

Some Express REST endpoints return `{ error: "message" }`, while others return `{ success: false, message: "..." }`, and tRPC has its own error format. This inconsistency complicates client-side error handling.

### L-04: No Database Connection Pool Size Configuration

The `postgres` (postgres-js) driver uses default pool settings. For production under load, explicit pool size configuration (`max`, `idle_timeout`) should be set.

### L-05: Verbose Catch Blocks

Many `catch` blocks use `catch (error: any)` followed by `error.message`, which loses type safety and may expose implementation details.

---

## Summary Table

| ID | Severity | Category | Location | Status |
|----|----------|----------|----------|--------|
| C-01 | Critical | SQL Injection | `server/db/statistics.ts` getDailyStats | Open |
| C-02 | Critical | SQL Injection | `server/db/statistics.ts` getHourlyStats | Open |
| C-03 | Critical | SQL Injection | `server/db/statistics.ts` corporate stats | Open |
| C-04 | Critical | SQL Injection | `server/db/machine.ts` workstation errors | Open |
| C-05 | Critical | Broken Query | `server/db/system.ts` getAuditLogs | Open |
| H-01 | High | Schema Bug | `drizzle/schema/production.ts` missing UNIQUE | Open |
| H-02 | High | Path Traversal | `server/storage.ts` storagePut local mode | Open |
| H-03 | High | Auth Design | `server/db/auth.ts` role mismatch | Open |
| H-04 | High | XSS | ScheduledReports dangerouslySetInnerHTML | Open |
| H-05 | High | Input Validation | `server/storage.ts` no file type check | Open |
| H-06 | High | Zip Slip | `server/routers/aoiPackageRouter.ts` | Open |
| M-01 | Medium | Input Validation | systemRouters unbounded strings | Open |
| M-02 | Medium | Info Disclosure | Error messages to client | Open |
| M-03 | Medium | Auth | No rate limiting | Open |
| M-04 | Medium | Resilience | No unhandledRejection handler | Open |
| M-05 | Medium | Info Disclosure | Console logging sensitive data | Open |
| M-06 | Medium | Tech Debt | Unused mysql2 dependency | Open |
| M-07 | Medium | Auth Design | Binary admin/non-admin model | Open |
| M-08 | Medium | Security | No CSRF protection | Open |
| L-01 | Low | Code Quality | innerHTML for static content | Open |
| L-02 | Low | Data Integrity | Missing foreign keys | Open |
| L-03 | Low | Code Quality | Inconsistent error formats | Open |
| L-04 | Low | Performance | No DB pool configuration | Open |
| L-05 | Low | Code Quality | Verbose catch blocks | Open |

---

*Report generated by SystemQA & Seeder Agent*
