# Database Index Optimization Guide

## Overview

This guide documents the composite indexes added to optimize query performance based on query monitoring data and common filter/sort patterns.

## Composite Indexes Strategy

### 1. Measurement Results Indexes

**Index: `idx_measurement_results_inspection_result`**
- **Columns:** `inspectionId, result`
- **Use Case:** Most queries filter measurement results by inspection ID and result type (OK/NG/NTF)
- **Query Pattern:** `WHERE inspectionId = ? AND result = ?`
- **Benefit:** Speeds up workstation analytics queries that aggregate results by type

**Index: `idx_measurement_results_point_result`**
- **Columns:** `measurementPointDefId, result`
- **Use Case:** Filter results by measurement point and result type
- **Query Pattern:** `WHERE measurementPointDefId = ? AND result = ?`
- **Benefit:** Optimizes top NG measurement points queries

**Index: `idx_measurement_results_inspection_created`**
- **Columns:** `inspectionId, createdAt`
- **Use Case:** Time-range queries on inspection results
- **Query Pattern:** `WHERE inspectionId = ? AND createdAt BETWEEN ? AND ?`
- **Benefit:** Speeds up historical analysis queries

### 2. Product Inspections Indexes

**Index: `idx_product_inspections_machine_time`**
- **Columns:** `machineId, inspectionTime`
- **Use Case:** Filter inspections by machine and time range
- **Query Pattern:** `WHERE machineId = ? AND inspectionTime BETWEEN ? AND ?`
- **Benefit:** Optimizes dashboard and history queries

**Index: `idx_product_inspections_time_result`**
- **Columns:** `inspectionTime, result`
- **Use Case:** Time-based result filtering
- **Query Pattern:** `WHERE inspectionTime BETWEEN ? AND ? AND result = ?`
- **Benefit:** Speeds up yield rate calculations

**Index: `idx_product_inspections_workshop_time`**
- **Columns:** `workshopId, inspectionTime`
- **Use Case:** Workshop-level analytics with time filtering
- **Query Pattern:** `WHERE workshopId = ? AND inspectionTime BETWEEN ? AND ?`
- **Benefit:** Optimizes workshop dashboard queries

### 3. Measurement Point Definitions Indexes

**Index: `idx_measurement_point_defs_workstation_active`**
- **Columns:** `workstationId, isActive`
- **Use Case:** Get active measurement points for a workstation
- **Query Pattern:** `WHERE workstationId = ? AND isActive = 1`
- **Benefit:** Speeds up workstation analytics queries

**Index: `idx_measurement_point_defs_product_active`**
- **Columns:** `productModelId, isActive`
- **Use Case:** Get active measurement points for a product model
- **Query Pattern:** `WHERE productModelId = ? AND isActive = 1`
- **Benefit:** Optimizes product model configuration queries

### 4. Workstations & Machines Indexes

**Index: `idx_workstations_active_process`**
- **Columns:** `isActive, processType`
- **Use Case:** Filter active workstations by process type
- **Query Pattern:** `WHERE isActive = 1 AND processType = ?`
- **Benefit:** Speeds up workstation listing and filtering

**Index: `idx_machines_active_workshop`**
- **Columns:** `isActive, workshopId`
- **Use Case:** Get active machines in a workshop
- **Query Pattern:** `WHERE isActive = 1 AND workshopId = ?`
- **Benefit:** Optimizes workshop machine queries

**Index: `idx_machines_active_line`**
- **Columns:** `isActive, lineId`
- **Use Case:** Get active machines on a production line
- **Query Pattern:** `WHERE isActive = 1 AND lineId = ?`
- **Benefit:** Speeds up line-level analytics

### 5. Users & Audit Logs Indexes

**Index: `idx_users_active_role`**
- **Columns:** `isActive, role`
- **Use Case:** Filter users by active status and role
- **Query Pattern:** `WHERE isActive = 1 AND role = ?`
- **Benefit:** Optimizes user management queries

**Index: `idx_audit_logs_user_created`**
- **Columns:** `userId, createdAt`
- **Use Case:** Get user activity history within time range
- **Query Pattern:** `WHERE userId = ? AND createdAt BETWEEN ? AND ?`
- **Benefit:** Speeds up user audit trail queries

**Index: `idx_audit_logs_entity_created`**
- **Columns:** `entityType, createdAt`
- **Use Case:** Get changes to specific entity types by time
- **Query Pattern:** `WHERE entityType = ? AND createdAt BETWEEN ? AND ?`
- **Benefit:** Optimizes entity change history queries

### 6. Alerts Indexes

**Index: `idx_alerts_machine_resolved`**
- **Columns:** `machineId, isResolved`
- **Use Case:** Get unresolved alerts for a machine
- **Query Pattern:** `WHERE machineId = ? AND isResolved = 0`
- **Benefit:** Speeds up active alert queries

**Index: `idx_alerts_created_severity`**
- **Columns:** `createdAt, severity`
- **Use Case:** Get recent alerts by severity
- **Query Pattern:** `WHERE createdAt BETWEEN ? AND ? AND severity = ?`
- **Benefit:** Optimizes alert dashboard queries

## Performance Monitoring

Use the Admin Monitoring Dashboard to:
1. Identify slow queries that still need optimization
2. Analyze query patterns to find additional index opportunities
3. Monitor index effectiveness over time
4. Detect new query patterns that might benefit from additional indexes

## Best Practices

### When to Add New Indexes

1. **Slow Query Detection:** Use the query monitoring dashboard to identify queries taking >1000ms
2. **Query Pattern Analysis:** Look for repeated queries with similar WHERE/ORDER BY clauses
3. **High-Frequency Queries:** Index frequently executed queries that filter on specific columns
4. **JOIN Operations:** Consider indexes on join columns to speed up table joins

### When NOT to Add Indexes

1. **Low-Cardinality Columns:** Don't index columns with few unique values (e.g., `isActive`, `result`)
   - Exception: Use as part of composite index with high-cardinality column
2. **Rarely Used Filters:** Don't index columns that are rarely used in WHERE clauses
3. **Write-Heavy Tables:** Be cautious with indexes on tables with frequent INSERT/UPDATE operations
4. **Small Tables:** Indexes may not provide benefit for tables with <1000 rows

### Index Maintenance

1. **Monitor Index Usage:** Regularly check which indexes are actually being used
2. **Remove Unused Indexes:** Drop indexes that don't improve query performance
3. **Rebuild Indexes:** Periodically rebuild indexes to maintain performance (especially after bulk operations)
4. **Update Statistics:** Keep table statistics up-to-date for query optimizer

## Applying Indexes

### Option 1: Using Drizzle Migration

```bash
pnpm db:push
```

### Option 2: Manual SQL Execution

```bash
mysql -h <host> -u <user> -p <database> < drizzle/migrations/add_composite_indexes.sql
```

## Monitoring Index Performance

After applying indexes, monitor:

1. **Query Execution Time:** Should decrease significantly for indexed queries
2. **Slow Query Log:** Monitor for queries that are still slow
3. **Index Size:** Ensure indexes don't consume excessive disk space
4. **Write Performance:** Verify that INSERT/UPDATE operations aren't significantly slower

## Future Optimization Opportunities

1. **Partitioning:** Consider partitioning large tables by date for better performance
2. **Query Caching:** Implement caching for frequently accessed analytical data
3. **Materialized Views:** Create pre-computed views for complex aggregations
4. **Read Replicas:** Consider read replicas for read-heavy workloads
