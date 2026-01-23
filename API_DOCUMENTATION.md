# AVI/AOI Factory Management System - API Documentation

**Version:** 1.0.0  
**Last Updated:** 2026-01-23  
**Base URL:** `/api/trpc`

---

## Table of Contents

1. [Authentication & Authorization](#authentication--authorization)
2. [Corporate/Factory Code Integration](#corporatefactory-code-integration)
3. [User Assignment APIs](#user-assignment-apis)
4. [Inspection APIs](#inspection-apis)
5. [Statistics APIs](#statistics-apis)
6. [Import/Export APIs](#importexport-apis)
7. [MQTT APIs](#mqtt-apis)
8. [Alert APIs](#alert-apis)
9. [Error Codes](#error-codes)

---

## Authentication & Authorization

### Overview

The system uses **Manus OAuth** for authentication and **role-based access control** (RBAC) for authorization.

### Roles

- **admin**: Full access to all resources and admin-only operations
- **user**: Limited access based on corporate/factory assignments

### Authentication Flow

1. User clicks login → redirects to Manus OAuth portal
2. After successful login → redirects to `/api/oauth/callback`
3. Session cookie is set (httpOnly, secure)
4. Frontend calls `trpc.auth.me.useQuery()` to get current user

### Example: Get Current User

```typescript
const { data: user } = trpc.auth.me.useQuery();
// Returns: { id, openId, email, name, role, createdAt }
```

### Example: Logout

```typescript
const logoutMutation = trpc.auth.logout.useMutation();
await logoutMutation.mutateAsync();
```

---

## Corporate/Factory Code Integration

### Overview

The system supports **multi-corporate, multi-factory** operations. Each inspection can be tagged with:

- **corporateCode**: Company identifier (e.g., "CORP001")
- **factoryCode**: Factory identifier (e.g., "FAC001")

### Schema

```typescript
product_inspections {
  id: number;
  corporateCode: string | null;
  factoryCode: string | null;
  machineId: number;
  serialNumber: string;
  overallResult: 'OK' | 'NG' | 'NTF';
  inspectionTime: Date;
  // ... other fields
}
```

### Example: Submit Inspection with Corporate/Factory Codes

```typescript
// Machine API (from inspection device)
POST /api/trpc/machineApi.submitInspection
{
  "apiKey": "machine-api-key",
  "companyCode": "CORP001",  // Maps to corporateCode
  "factoryCode": "FAC001",
  "serialNumber": "SN123456",
  "productModel": "MODEL-A",
  "overallResult": "OK",
  "measurementResults": [...]
}
```

### Backward Compatibility

If `companyCode` and `factoryCode` are not provided, the system still accepts the inspection (both fields are nullable).

---

## User Assignment APIs

### Overview

Admin can assign users to specific corporates/factories. Non-admin users can only view data from their assigned corporates/factories.

### Get My Assignments

```typescript
const { data } = trpc.userAssignment.getMyAssignments.useQuery();
// Returns: {
//   corporateAssignments: [{ id, userId, corporateCode, assignedAt }],
//   factoryAssignments: [{ id, userId, factoryCode, assignedAt }]
// }
```

### Get All User Assignments (Admin Only)

```typescript
const { data } = trpc.userAssignment.getAllUserAssignments.useQuery({
  userId: 123
});
```

### Assign Corporate (Admin Only)

```typescript
const assignMutation = trpc.userAssignment.assignCorporate.useMutation();
await assignMutation.mutateAsync({
  userId: 123,
  corporateCode: "CORP001"
});
```

### Assign Factory (Admin Only)

```typescript
const assignMutation = trpc.userAssignment.assignFactory.useMutation();
await assignMutation.mutateAsync({
  userId: 123,
  factoryCode: "FAC001"
});
```

### Remove Corporate Assignment (Admin Only)

```typescript
const removeMutation = trpc.userAssignment.removeCorporateAssignment.useMutation();
await removeMutation.mutateAsync({ id: 456 });
```

### Remove Factory Assignment (Admin Only)

```typescript
const removeMutation = trpc.userAssignment.removeFactoryAssignment.useMutation();
await removeMutation.mutateAsync({ id: 789 });
```

---

## Inspection APIs

### List Inspections

**Access Control:** Automatically filters by user assignments for non-admin users.

```typescript
const { data } = trpc.inspection.list.useQuery({
  machineId: 1,
  corporateCode: "CORP001",
  factoryCode: "FAC001",
  serialNumber: "SN123",
  result: "NG",
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-01-31'),
  limit: 50,
  offset: 0
});

// Returns: {
//   data: ProductInspection[],
//   total: number
// }
```

### Get Inspection by ID

```typescript
const { data } = trpc.inspection.getById.useQuery({ id: 123 });
```

### Search Inspections

```typescript
const { data } = trpc.inspection.search.useQuery({
  factoryCode: "FAC001",
  workshopCode: "WS01",
  lineCode: "LINE01",
  stationCode: "ST01",
  machineCode: "MCH01",
  serialNumber: "SN",
  productModel: "MODEL-A",
  result: "NG",
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-01-31'),
  limit: 100,
  offset: 0
});
```

---

## Statistics APIs

### Corporate/Factory Statistics

**Access Control:** Automatically filters by user assignments for non-admin users.

#### Get Yield Rate by Corporate

```typescript
const { data } = trpc.corporateFactoryStats.yieldRateByCorporate.useQuery({
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-01-31')
});

// Returns: Array<{
//   corporateCode: string;
//   totalInspections: number;
//   okCount: number;
//   ngCount: number;
//   ntfCount: number;
//   yieldRate: number;
// }>
```

#### Get Yield Rate by Factory

```typescript
const { data } = trpc.corporateFactoryStats.yieldRateByFactory.useQuery({
  corporateCode: "CORP001",
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-01-31')
});
```

#### Get Throughput by Corporate

```typescript
const { data } = trpc.corporateFactoryStats.throughputByCorporate.useQuery({
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-01-31'),
  interval: 'day' // 'hour' | 'day' | 'week'
});

// Returns: Array<{
//   corporateCode: string;
//   timeLabel: string;
//   totalInspections: number;
// }>
```

#### Get Throughput by Factory

```typescript
const { data } = trpc.corporateFactoryStats.throughputByFactory.useQuery({
  corporateCode: "CORP001",
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-01-31'),
  interval: 'day'
});
```

---

## Import/Export APIs

### Import Factories (Admin Only)

```typescript
const importMutation = trpc.import.importFactories.useMutation();

// Upload Excel file via frontend
const file = event.target.files[0];
const arrayBuffer = await file.arrayBuffer();
const workbook = XLSX.read(arrayBuffer);
const worksheet = workbook.Sheets[workbook.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(worksheet);

await importMutation.mutateAsync({ data });

// Returns: {
//   success: number;
//   failed: number;
//   errors: string[];
// }
```

**Excel Format:**

| code | name | description | address |
|------|------|-------------|---------|
| FAC001 | Factory 1 | Main factory | 123 Main St |
| FAC002 | Factory 2 | Branch factory | 456 Branch Ave |

### Import Workshops (Admin Only)

```typescript
await trpc.import.importWorkshops.mutateAsync({ data });
```

**Excel Format:**

| factoryCode | code | name | description |
|-------------|------|------|-------------|
| FAC001 | WS01 | Workshop 1 | Assembly workshop |
| FAC001 | WS02 | Workshop 2 | Testing workshop |

### Import Machines (Admin Only)

```typescript
await trpc.import.importMachines.mutateAsync({ data });
```

**Excel Format:**

| stationCode | code | name | machineType | ipAddress | port |
|-------------|------|------|-------------|-----------|------|
| ST01 | MCH01 | Machine 1 | AOI | 192.168.1.100 | 8080 |
| ST01 | MCH02 | Machine 2 | AVI | 192.168.1.101 | 8080 |

### Export Inspections (Admin Only)

```typescript
const exportMutation = trpc.export.exportInspections.useMutation();
const result = await exportMutation.mutateAsync({
  corporateCode: "CORP001",
  factoryCode: "FAC001",
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-01-31')
});

// Returns: {
//   fileUrl: string; // S3 URL to download Excel file
//   fileName: string;
//   recordCount: number;
// }
```

### Export Statistics (Admin Only)

```typescript
const result = await trpc.export.exportStatistics.mutateAsync({
  corporateCode: "CORP001",
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-01-31'),
  groupBy: 'factory' // 'factory' | 'workshop' | 'line' | 'machine'
});
```

---

## MQTT APIs

### Get MQTT Dashboard Stats

```typescript
const { data } = trpc.mqttClient.dashboardStats.useQuery();

// Returns: {
//   totalMessages: number;
//   messagesSent: number;
//   messagesFailed: number;
//   ngAlerts: number;
//   externalBrokerStatus: 'connected' | 'disconnected';
// }
```

### Get Realtime Stats

```typescript
const { data } = trpc.mqttClient.realtimeStats.useQuery();

// Returns: {
//   throughput1Min: number;
//   throughput5Min: number;
//   avgLatency: number;
//   p95Latency: number;
//   externalBrokerConnected: boolean;
// }
```

### Test NG Alert

```typescript
const testMutation = trpc.mqttClient.testNGAlert.useMutation();
await testMutation.mutateAsync();

// Publishes a test NG alert to MQTT broker
```

---

## Alert APIs

### MQTT Alert Rules

#### List Alert Rules

```typescript
const { data } = trpc.mqttAlert.list.useQuery();
```

#### Create Alert Rule

```typescript
const createMutation = trpc.mqttAlert.create.useMutation();
await createMutation.mutateAsync({
  name: "High Latency Alert",
  description: "Alert when latency exceeds 500ms",
  ruleType: "LATENCY_THRESHOLD",
  thresholdValue: 500,
  thresholdUnit: "ms",
  comparisonOperator: "GT",
  timeWindowMinutes: 5,
  notifyOwner: true,
  notifyEmail: false,
  notifyMqtt: false,
  cooldownMinutes: 15
});
```

**Rule Types:**

- `LATENCY_THRESHOLD`: Alert when MQTT message latency exceeds threshold
- `BROKER_DISCONNECT`: Alert when external broker disconnects
- `MESSAGE_FAILURE_RATE`: Alert when message failure rate exceeds threshold
- `THROUGHPUT_LOW`: Alert when throughput drops below threshold
- `THROUGHPUT_HIGH`: Alert when throughput exceeds threshold
- `CLIENT_OFFLINE`: Alert when MQTT client goes offline

#### Toggle Alert Rule

```typescript
const toggleMutation = trpc.mqttAlert.toggle.useMutation();
await toggleMutation.mutateAsync({ id: 123, isEnabled: false });
```

#### Delete Alert Rule

```typescript
const deleteMutation = trpc.mqttAlert.delete.useMutation();
await deleteMutation.mutateAsync({ id: 123 });
```

### Alert History

#### List Alert History

```typescript
const { data } = trpc.mqttAlert.listHistory.useQuery({
  ruleId: 123,
  isResolved: false,
  limit: 50,
  offset: 0
});
```

#### Resolve Alert

```typescript
const resolveMutation = trpc.mqttAlert.resolveAlert.useMutation();
await resolveMutation.mutateAsync({ id: 456 });
```

---

## Error Codes

### HTTP Status Codes

- **200 OK**: Request successful
- **400 BAD_REQUEST**: Invalid input parameters
- **401 UNAUTHORIZED**: Not authenticated
- **403 FORBIDDEN**: Not authorized (insufficient permissions)
- **404 NOT_FOUND**: Resource not found
- **500 INTERNAL_SERVER_ERROR**: Server error

### tRPC Error Codes

```typescript
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Admin only"
  }
}
```

**Common Error Codes:**

- `UNAUTHORIZED`: User not logged in
- `FORBIDDEN`: User lacks required permissions
- `NOT_FOUND`: Resource does not exist
- `BAD_REQUEST`: Invalid input data
- `INTERNAL_SERVER_ERROR`: Unexpected server error

### Access Control Errors

When a non-admin user tries to access data outside their assignments:

```typescript
{
  "data": [],
  "total": 0
}
// Empty result, no error thrown
```

---

## Rate Limits

- **Inspection List API**: Max 1000 records per request
- **Statistics APIs**: Max 90 days date range
- **Import APIs**: Max 1000 rows per Excel file
- **Export APIs**: Max 10000 records per export

---

## Best Practices

1. **Pagination**: Always use `limit` and `offset` for large datasets
2. **Date Filters**: Use `startDate` and `endDate` to limit query scope
3. **Access Control**: Non-admin users automatically see filtered data
4. **Error Handling**: Always handle tRPC errors in `onError` callback
5. **Optimistic Updates**: Use for instant UI feedback (list operations, toggles)
6. **Invalidation**: Use `trpc.useUtils().invalidate()` for critical operations

---

## Examples

### Complete Inspection Query with Access Control

```typescript
// Admin sees all data
const { data } = trpc.inspection.list.useQuery({
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-01-31'),
  limit: 50
});

// Non-admin user (assigned to CORP001, FAC001) automatically sees filtered data
// Backend applies: WHERE corporateCode IN ('CORP001') OR factoryCode IN ('FAC001')
```

### Complete Import Flow

```typescript
// 1. Download template
const downloadTemplate = () => {
  const template = [
    { code: 'FAC001', name: 'Factory 1', description: '', address: '' }
  ];
  const ws = XLSX.utils.json_to_sheet(template);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Factories');
  XLSX.writeFile(wb, 'factory_template.xlsx');
};

// 2. Upload and import
const handleImport = async (file: File) => {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer);
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(worksheet);
  
  const result = await importMutation.mutateAsync({ data });
  
  if (result.failed > 0) {
    console.error('Import errors:', result.errors);
  }
  
  toast.success(`Imported ${result.success} factories`);
};
```

---

## Support

For API issues or questions, contact: support@manus.im

