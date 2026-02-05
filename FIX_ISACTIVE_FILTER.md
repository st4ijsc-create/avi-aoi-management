# Fix: Management UI không hiển thị dữ liệu

## Vấn đề
Các chức năng quản lý (Factory, Workshop, Workstation, Machine, Production Line, Product Model) không lấy được dữ liệu mặc dù database có records.

## Nguyên nhân
Tất cả các query functions đều có filter mặc định `isActive = true`, nhưng:

1. **Một số records có `isActive = false`** trong database (ví dụ: 2/7 factories)
2. **Table workstations chỉ có 1 record** trong database
3. Trong **Management UI**, user cần thấy tất cả records (cả active và inactive) để quản lý

## Kết quả kiểm tra database

```
=== FACTORIES ===
Total: 7 records
- isActive = true: 5 records
- isActive = false: 2 records

=== WORKSHOPS ===  
Total: 30 records
- isActive = true: 29 records
- isActive = false: 1 record

=== WORKSTATIONS ===
Total: 1 record
- isActive = true: 1 record
```

## Giải pháp

### 1. Loại bỏ filter `isActive = true` mặc định
Sửa các management query functions để **không filter theo isActive** mặc định, chỉ filter khi được chỉ định rõ ràng.

### 2. Danh sách functions đã sửa

#### Factories
```typescript
// Before
export async function getFactories() {
  return db.select().from(factories)
    .where(eq(factories.isActive, true))
    .orderBy(factories.name);
}

// After
export async function getFactories() {
  return db.select().from(factories)
    .orderBy(factories.name); // Show all factories
}
```

#### Workshops
```typescript
// Before
export async function getWorkshops() {
  return db.select().from(workshops)
    .where(eq(workshops.isActive, true))
    .orderBy(workshops.name);
}

// After  
export async function getWorkshops() {
  return db.select().from(workshops)
    .orderBy(workshops.name); // Show all workshops
}

// Before
export async function getWorkshopsByFactory(factoryId: number) {
  return db.select().from(workshops)
    .where(and(
      eq(workshops.factoryId, factoryId), 
      eq(workshops.isActive, true)
    ))
    .orderBy(workshops.name);
}

// After
export async function getWorkshopsByFactory(factoryId: number) {
  return db.select().from(workshops)
    .where(eq(workshops.factoryId, factoryId))
    .orderBy(workshops.name); // Show all workshops for factory
}
```

#### Workstations
```typescript
// Before
export async function getWorkstations(filters?: { 
  lineId?: number; 
  workshopId?: number; 
  factoryId?: number; 
  isActive?: boolean 
}) {
  const conditions = [
    eq(workstations.isActive, filters?.isActive ?? true) // Default to true!
  ];
  // ... add other filters
  return db.select().from(workstations)
    .where(and(...conditions))
    .orderBy(workstations.orderIndex);
}

// After
export async function getWorkstations(filters?: { 
  lineId?: number; 
  workshopId?: number; 
  factoryId?: number; 
  isActive?: boolean 
}) {
  const conditions: any[] = [];
  
  // Only filter by isActive if explicitly specified
  if (filters?.isActive !== undefined) {
    conditions.push(eq(workstations.isActive, filters.isActive));
  }
  
  if (filters?.lineId) conditions.push(eq(workstations.lineId, filters.lineId));
  if (filters?.workshopId) conditions.push(eq(workstations.workshopId, filters.workshopId));
  if (filters?.factoryId) conditions.push(eq(workstations.factoryId, filters.factoryId));
  
  if (conditions.length === 0) {
    return db.select().from(workstations).orderBy(workstations.orderIndex);
  }
  return db.select().from(workstations)
    .where(and(...conditions))
    .orderBy(workstations.orderIndex);
}
```

#### Production Lines
```typescript
// Before
export async function getProductionLines() {
  return db.select().from(productionLines)
    .where(eq(productionLines.isActive, true))
    .orderBy(productionLines.name);
}

// After
export async function getProductionLines() {
  return db.select().from(productionLines)
    .orderBy(productionLines.name); // Show all lines
}

// Before
export async function getProductionLinesByWorkshop(workshopId: number) {
  return db.select().from(productionLines)
    .where(and(
      eq(productionLines.workshopId, workshopId),
      eq(productionLines.isActive, true)
    ))
    .orderBy(productionLines.name);
}

// After
export async function getProductionLinesByWorkshop(workshopId: number) {
  return db.select().from(productionLines)
    .where(eq(productionLines.workshopId, workshopId))
    .orderBy(productionLines.name); // Show all lines for workshop
}
```

#### Machines
```typescript
// Before
export async function getMachines() {
  return db.select().from(machines)
    .where(eq(machines.isActive, true))
    .orderBy(machines.name);
}

// After
export async function getMachines() {
  return db.select().from(machines)
    .orderBy(machines.name); // Show all machines
}

// Before
export async function getMachinesByStation(stationId: number) {
  return db.select().from(machines)
    .where(and(
      eq(machines.stationId, stationId),
      eq(machines.isActive, true)
    ))
    .orderBy(machines.name);
}

// After
export async function getMachinesByStation(stationId: number) {
  return db.select().from(machines)
    .where(eq(machines.stationId, stationId))
    .orderBy(machines.name); // Show all machines for station
}
```

#### Product Models
```typescript
// Before
export async function getProductModels(options?: {
  search?: string;
  lifecycleStatus?: string;
  // ...
}) {
  const conditions = [
    eq(productModels.isActive, true) // Always filter active!
  ];
  // ... rest of query
}

// After
export async function getProductModels(options?: {
  search?: string;
  lifecycleStatus?: string;
  isActive?: boolean; // Add optional filter
  // ...
}) {
  const conditions: any[] = [];
  
  // Only filter by isActive if explicitly specified
  if (options?.isActive !== undefined) {
    conditions.push(eq(productModels.isActive, options.isActive));
  }
  
  // ... rest of query
}
```

## Files đã sửa
- `server/db.ts`: 10 functions

## Impact

### ✅ Tích cực
1. **Management UI hiển thị tất cả records** - User có thể quản lý cả active và inactive entities
2. **Linh hoạt hơn** - Frontend có thể filter theo isActive nếu cần
3. **Consistent behavior** - Tất cả management functions có cùng pattern

### ⚠️ Lưu ý
1. **Dashboard queries** vẫn nên filter `isActive = true` để chỉ hiển thị active entities trong báo cáo
2. **Frontend cần update** để hiển thị status badge (active/inactive) và cho phép user filter
3. **APIs cho mobile/external** nên mặc định filter `isActive = true` 

## Testing Checklist
✅ Server starts without errors
✅ getFactories() returns all 7 factories (not just 5)
✅ getWorkshops() returns all 30 workshops (not just 29)
✅ getWorkstations() returns all workstations
✅ getMachines() returns all machines
✅ getProductionLines() returns all lines
✅ getProductModels() returns all product models

## Khuyến nghị tiếp theo

### 1. Seed thêm dữ liệu Workstations
Database hiện chỉ có **1 workstation**, cần seed thêm data cho testing và demo:

```sql
INSERT INTO workstations (code, name, description, "lineId", "workshopId", "factoryId", "processType", "orderIndex", "isActive")
VALUES 
  ('WS-SMT-01', 'SMT Station 1', 'Surface Mount Technology 1', 1, 37, 102, 'SMT', 1, true),
  ('WS-SMT-02', 'SMT Station 2', 'Surface Mount Technology 2', 1, 37, 102, 'SMT', 2, true),
  ('WS-DIP-01', 'DIP Station 1', 'Dual Inline Package 1', 2, 37, 102, 'DIP', 1, true),
  ('WS-AOI-01', 'AOI Station 1', 'Automated Optical Inspection 1', 3, 37, 102, 'AOI', 1, true),
  ('WS-TEST-01', 'Test Station 1', 'Final Testing Station', 4, 37, 102, 'TEST', 1, true);
```

### 2. Update Frontend UI
Thêm các features sau vào Management UI:

- **Status Badge**: Hiển thị active/inactive status
- **Filter Controls**: Cho phép user filter by isActive
- **Activate/Deactivate Buttons**: Toggle isActive status
- **Visual Indicators**: Gray out inactive items

### 3. API Documentation
Document rõ behavior khác nhau giữa:
- **Management APIs**: Return all records (no isActive filter)
- **Dashboard APIs**: Return only active records
- **Mobile APIs**: Return only active records

## Conclusion
Vấn đề đã được fix bằng cách loại bỏ hard-coded `isActive = true` filter trong management query functions. Giờ Management UI sẽ hiển thị tất cả records, cho phép admins quản lý đầy đủ các entities trong hệ thống.
