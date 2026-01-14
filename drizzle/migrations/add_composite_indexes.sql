-- Composite indexes for query optimization
-- Based on query monitoring data and common filter/sort patterns

-- Measurement Results: Most queries filter by inspectionId and result
CREATE INDEX idx_measurement_results_inspection_result 
ON measurement_results(inspectionId, result);

-- Measurement Results: Filter by measurementPointDefId and result
CREATE INDEX idx_measurement_results_point_result 
ON measurement_results(measurementPointDefId, result);

-- Measurement Results: Filter by inspectionId and created date
CREATE INDEX idx_measurement_results_inspection_created 
ON measurement_results(inspectionId, createdAt);

-- Product Inspections: Filter by machineId and inspectionTime
CREATE INDEX idx_product_inspections_machine_time 
ON product_inspections(machineId, inspectionTime);

-- Product Inspections: Filter by inspectionTime and result
CREATE INDEX idx_product_inspections_time_result 
ON product_inspections(inspectionTime, result);

-- Product Inspections: Filter by workshopId and inspectionTime
CREATE INDEX idx_product_inspections_workshop_time 
ON product_inspections(workshopId, inspectionTime);

-- Measurement Point Defs: Filter by workstationId and isActive
CREATE INDEX idx_measurement_point_defs_workstation_active 
ON measurement_point_defs(workstationId, isActive);

-- Measurement Point Defs: Filter by productModelId and isActive
CREATE INDEX idx_measurement_point_defs_product_active 
ON measurement_point_defs(productModelId, isActive);

-- Workstations: Filter by isActive and processType
CREATE INDEX idx_workstations_active_process 
ON workstations(isActive, processType);

-- Machines: Filter by isActive and workshopId
CREATE INDEX idx_machines_active_workshop 
ON machines(isActive, workshopId);

-- Machines: Filter by isActive and lineId
CREATE INDEX idx_machines_active_line 
ON machines(isActive, lineId);

-- Users: Filter by isActive and role
CREATE INDEX idx_users_active_role 
ON users(isActive, role);

-- Audit Logs: Filter by userId and createdAt
CREATE INDEX idx_audit_logs_user_created 
ON audit_logs(userId, createdAt);

-- Audit Logs: Filter by entityType and createdAt
CREATE INDEX idx_audit_logs_entity_created 
ON audit_logs(entityType, createdAt);

-- Alerts: Filter by machineId and isResolved
CREATE INDEX idx_alerts_machine_resolved 
ON alerts(machineId, isResolved);

-- Alerts: Filter by createdAt and severity
CREATE INDEX idx_alerts_created_severity 
ON alerts(createdAt, severity);
