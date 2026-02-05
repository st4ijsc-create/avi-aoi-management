# MySQL to PostgreSQL Migration Fixes

## Tổng quan
Tài liệu này liệt kê tất cả các thay đổi đã thực hiện để chuyển đổi từ MySQL sang PostgreSQL.

## Danh sách thay đổi

### 1. Column Name Case Sensitivity
**Vấn đề**: PostgreSQL chuyển unquoted identifiers sang lowercase, nhưng schema dùng camelCase.

**Giải pháp**: Quote tất cả camelCase column names trong raw SQL queries.

**Files changed**:
- `server/db.ts`: Quoted columns như `workstationId`, `pointDefId`, `inspectionId`, `isActive`, `inspectionTime`, `processType`, `productModelId`, `machineId`, `createdAt`, `deliveredAt`, `deliveryStatus`
- `server/services/alertEvaluationService.ts`: Quoted `createdAt`, `deliveredAt`, `deliveryStatus`

**Examples**:
```sql
-- Before (MySQL)
WHERE mpd.workstationId = 1

-- After (PostgreSQL)
WHERE mpd."workstationId" = 1
```

### 2. Boolean Data Type Comparison
**Vấn đề**: MySQL dùng TINYINT(1) cho boolean, PostgreSQL dùng native BOOLEAN type.

**Giải pháp**: Đổi từ `= 1` sang `= true` hoặc chỉ `WHERE column_name`.

**Files changed**:
- `server/db.ts`: `w."isActive" = 1` → `w."isActive" = true`

**Examples**:
```sql
-- Before (MySQL)
WHERE isActive = 1

-- After (PostgreSQL)
WHERE "isActive" = true
```

### 3. Date/Time Functions

#### 3.1 TIMESTAMPDIFF
**Vấn đề**: MySQL-specific function không tồn tại trong PostgreSQL.

**Giải pháp**: Dùng `EXTRACT(EPOCH FROM (end - start))` để tính timestamp difference.

**Files changed**:
- `server/services/alertEvaluationService.ts`

**Examples**:
```sql
-- Before (MySQL)
TIMESTAMPDIFF(MICROSECOND, createdAt, deliveredAt) / 1000.0

-- After (PostgreSQL)
EXTRACT(EPOCH FROM ("deliveredAt" - "createdAt")) * 1000.0
```

#### 3.2 DATE_FORMAT
**Vấn đề**: MySQL DATE_FORMAT() không tồn tại trong PostgreSQL.

**Giải pháp**: Dùng TO_CHAR() với format strings khác.

**Files changed**:
- `server/db.ts`: Lines 1336-1350, 1381-1395, 7473-7490
- `server/routers/annotationComparisonRouter.ts`: Lines 570-585

**Format conversion table**:
| MySQL | PostgreSQL | Description |
|-------|-----------|-------------|
| `%Y-%m-%d` | `YYYY-MM-DD` | Date |
| `%Y-%m-%d %H:00` | `YYYY-MM-DD HH24:00` | Hour |
| `%Y-%u` | `IYYY-IW` | Year-Week (ISO) |
| `%Y-%m` | `YYYY-MM` | Year-Month |

**Examples**:
```sql
-- Before (MySQL)
DATE_FORMAT(inspectionTime, '%Y-%m-%d')

-- After (PostgreSQL)
TO_CHAR("inspectionTime", 'YYYY-MM-DD')
```

#### 3.3 DATE_SUB / DATE_ADD
**Vấn đề**: MySQL DATE_SUB() và INTERVAL syntax không tương thích.

**Giải pháp**: Dùng PostgreSQL interval arithmetic: `NOW() - INTERVAL '1 hour'`.

**Files changed**:
- `server/routers/mqttClientManagementRouter.ts`: Lines 792, 803, 1101, 1391

**Examples**:
```sql
-- Before (MySQL)
DATE_SUB(NOW(), INTERVAL 1 HOUR)
DATE_SUB(NOW(), INTERVAL 24 HOUR)
DATE_SUB(NOW(), INTERVAL ${days} DAY)

-- After (PostgreSQL)
NOW() - INTERVAL '1 hour'
NOW() - INTERVAL '24 hours'
NOW() - INTERVAL '${days} days'
```

#### 3.4 HOUR() Function
**Vấn đề**: MySQL HOUR() function không tồn tại trong PostgreSQL.

**Giải pháp**: Dùng `EXTRACT(HOUR FROM timestamp)`.

**Files changed**:
- `server/db.ts`: Lines 1225-1226

**Examples**:
```sql
-- Before (MySQL)
HOUR(inspectionTime) >= 6

-- After (PostgreSQL)
EXTRACT(HOUR FROM "inspectionTime") >= 6
```

### 4. Date Parameters in SQL Queries
**Vấn đề**: Drizzle sql`` template literal nhận Date objects, nhưng postgres-js driver cần string.

**Giải pháp**: Convert Date objects thành ISO strings với `.toISOString()` trước khi pass vào SQL query.

**Files changed**:
- `server/db.ts`: 
  - `getDefectsByWorkstation()`
  - `getTopNGMeasurementPointsByWorkstation()`
  - `getWorkstationSummary()`
  - `getMeasurementPointsByWorkstation()`
  - `getNGTrendByDay()`
  - `getNGComparison()`
- `server/services/alertEvaluationService.ts`:
  - `getAverageLatency()`
  - `getMessageFailureRate()`
  - `getThroughput()`

**Examples**:
```typescript
// Before
const query = sql`WHERE pi."inspectionTime" >= ${filters.startDate}`;

// After
const startDateStr = filters.startDate.toISOString();
const query = sql`WHERE pi."inspectionTime" >= ${startDateStr}`;
```

### 5. HAVING Clause with Aliases
**Vấn đề**: PostgreSQL không nhận diện column aliases trong HAVING clause do case sensitivity.

**Giải pháp**: Dùng full expression thay vì alias trong HAVING clause.

**Files changed**:
- `server/db.ts`: Line 3461

**Examples**:
```sql
-- Before (MySQL)
SELECT SUM(...) as ngCount
HAVING ngCount > 0

-- After (PostgreSQL)
SELECT SUM(...) as ngCount
HAVING SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END) > 0
```

### 6. Raw SQL Queries
**Vấn đề**: Raw SQL queries trong audit logs và trend queries thiếu quotes cho camelCase columns.

**Giải pháp**: Quote tất cả column names trong raw SQL.

**Files changed**:
- `server/db.ts`: Lines 1336-1350, 1381-1395, 2988

**Examples**:
```sql
-- Before (MySQL)
ORDER BY createdAt DESC

-- After (PostgreSQL)  
ORDER BY "createdAt" DESC
```

## Testing Checklist

✅ Server starts without database errors
✅ Socket connections work properly
✅ Dashboard queries execute successfully
✅ Date range filters work correctly
✅ Shift analysis calculations work
✅ Trend data aggregations work
✅ MQTT alert evaluation works
✅ Audit logs pagination works
✅ No "column does not exist" errors
✅ No "function does not exist" errors
✅ No "operator does not exist" errors
✅ No "Date object" type errors

## Migration Summary

**Total changes**: 50+ instances across 3 files
- **server/db.ts**: ~35 fixes
- **server/services/alertEvaluationService.ts**: ~6 fixes
- **server/routers/mqttClientManagementRouter.ts**: ~4 fixes
- **server/routers/annotationComparisonRouter.ts**: ~3 fixes

**Function replacements**:
- TIMESTAMPDIFF → EXTRACT(EPOCH FROM)
- DATE_FORMAT → TO_CHAR
- DATE_SUB/DATE_ADD → Interval arithmetic
- HOUR() → EXTRACT(HOUR FROM)
- IFNULL → COALESCE (already using COALESCE)

**Data type handling**:
- Boolean: `= 1` → `= true`
- Date parameters: `Date` → `Date.toISOString()`
- Column names: `columnName` → `"columnName"`

## Notes

1. **Quote all camelCase identifiers** trong PostgreSQL raw SQL
2. **Convert Date objects** sang ISO strings trước khi dùng trong sql`` template
3. **Use EXTRACT() functions** thay vì MySQL date/time functions
4. **PostgreSQL format strings** khác hoàn toàn với MySQL
5. **Interval syntax** dùng quotes: `INTERVAL '1 hour'` không phải `INTERVAL 1 HOUR`
6. **Boolean comparisons** dùng `true`/`false` thay vì `1`/`0`

## Performance Considerations

Các thay đổi này không ảnh hưởng performance vì:
- Indexes vẫn được sử dụng đúng cách
- Query plans tương tự MySQL
- PostgreSQL query optimizer tốt với date operations
- Column quoting không ảnh hưởng execution plan

## Rollback Strategy

Nếu cần rollback về MySQL:
1. Revert tất cả quotes trong column names
2. Đổi TO_CHAR → DATE_FORMAT với MySQL format strings
3. Đổi EXTRACT(EPOCH FROM) → TIMESTAMPDIFF
4. Đổi interval arithmetic → DATE_SUB/DATE_ADD
5. Đổi `= true` → `= 1`
6. Remove `.toISOString()` conversions
