# CRUD Coverage Summary

## Bảng có CRUD đầy đủ

### Core Entities
- ✅ **users** → userRouter (list, getById, create, update, delete, updateRole, toggleActive)
- ✅ **factories** → factoryRouter (list, getById, create, update, delete)
- ✅ **workshops** → workshopRouter (list, getById, getByFactory, create, update, delete)
- ✅ **productionLines** → lineRouter (list, getById, getByWorkshop, create, update, delete)
- ✅ **stations** → stationRouter (list, getById, getByLine, create, update, delete)
- ✅ **machines** → machineRouter (list, getById, getByStation, create, update, delete, regenerateApiKey)

### Product & Inspection
- ✅ **productModels** → productModelRouter (list, getById, create, update, delete)
- ✅ **productInspections** → inspectionRouter (list, search, getById, confirmNTF, topNGPoints, aiAnalysis)
- ✅ **measurementPointDefs** → measurementPointRouter (list, getById, getByMachine, create, update, delete, uploadImage)
- ✅ **measurementResults** → measurementResultRouter (list, getByInspection, create, bulkCreate)

### Production Management
- ✅ **productMachineMappings** → productMachineMappingRouter (list, getByMachine, create, delete)
- ✅ **shiftConfigs** → shiftConfigRouter (list, getById, create, update, delete)
- ✅ **productionOrders** → productionOrderRouter (list, getById, create, update, updateQuantities)
- ✅ **lineStages** → lineStageRouter (list, getByLine, create, update, delete, reorder)
- ✅ **lineProductAssignments** → lineProductAssignmentRouter (list, getByLine, create, delete)

### Monitoring & Alerts
- ✅ **alertSettings** → alertRouter (list, getById, create, update, delete)
- ✅ **yieldAlertThresholds** → yieldThresholdRouter (list, getByMachine, create, update, delete, getHistory)
- ✅ **machineStatusLogs** → machineStatusRouter (list, getByMachine, getLatest, create)

### Layout & Positioning
- ✅ **factoryLayouts** → layoutRouter (list, getByFactory, create, update, delete)
- ✅ **machinePositions** → layoutRouter (getMachinePositions, updateMachinePosition)
- ✅ **workshopPositions** → layoutRouter (getWorkshopPositions, updateWorkshopPosition)
- ✅ **factoryPositions** → layoutRouter (getFactoryPositions, updateFactoryPosition)

### MQTT & IoT
- ✅ **mqttClients** → mqttClientRouter (list, getById, approve, reject, updateStation, delete, dashboardStats)
- ✅ **mqttAlertRules** → mqttAlertRouter (list, getById, create, update, toggle, delete)

### System & Configuration
- ✅ **workstations** → workstationRouter (list, getById, create, update, delete)
- ✅ **scheduledReports** → scheduledReportRouter (list, getById, create, update, delete, execute)
- ✅ **smtpConfig** → smtpRouter (get, update, test)
- ✅ **systemConfig** → systemConfigRouter (list, getByKey, update, create)
- ✅ **auditLogs** → auditRouter (list, getByUser, getByAction)

## Bảng không cần CRUD riêng (managed internally)

### Auto-generated / System Tables
- **dailyStatistics** - Tự động tạo từ inspections
- **machineHeartbeats** - Tự động cập nhật từ machine API
- **alertHistory** - Tự động tạo khi alert trigger
- **mqttAlertHistory** - Tự động tạo khi MQTT alert trigger
- **mqttMessageLogs** - Tự động log MQTT messages
- **mqttErrorSummary** - Tự động tổng hợp errors
- **scheduledReportLogs** - Tự động log khi report chạy
- **yieldThresholdHistory** - Tự động log khi threshold thay đổi

### Authentication / Security Tables
- **backupCodes** - Managed qua 2FA flow
- **userSessions** - Managed qua auth system
- **manualMachineConnections** - Managed qua manualMappingRouter

### Template / Subscription Tables
- **measurementPointTemplates** - Managed qua templateRouter
- **mqttSubscriptions** - Tự động tạo khi client subscribe

### Position Tables (managed via parent routers)
- **workshopPositions** - Managed qua layoutRouter
- **factoryPositions** - Managed qua layoutRouter
- **machinePositions** - Managed qua layoutRouter

## API Enhancements Completed

### Product Inspections
- ✅ Thêm `corporateCode` và `factoryCode` columns
- ✅ Thêm indexes cho corporate/factory filtering
- ✅ Cập nhật `submitInspection` API nhận `companyCode` và `factoryCode`
- ✅ Cập nhật `getProductInspections` filter theo corporate/factory
- ⏳ Dashboard statistics group theo corporate/factory (pending)

## Recommendations

### Missing CRUD (if needed)
1. **systemSettings** - Có thể cần CRUD nếu muốn quản lý settings qua UI
2. **dailyStatistics** - Có thể thêm manual adjustment endpoint nếu cần

### API Improvements
1. Thêm bulk operations cho các entities thường xuyên import/export
2. Thêm export to Excel/CSV cho các list endpoints
3. Thêm advanced filtering cho complex queries

### Performance Optimizations
1. Add caching cho frequently accessed data (factories, workshops, product models)
2. Add database indexes cho common query patterns
3. Implement pagination cho tất cả list endpoints (đã có limit/offset)
