# Enterprise Features Implementation Guide

## ✅ Completed: Dashboard Statistics by Corporate/Factory

### Features
- **Yield Rate by Corporate**: Bar chart so sánh tỷ lệ đạt giữa các công ty
- **Yield Rate by Factory**: Bar chart chi tiết theo nhà máy khi chọn công ty
- **Throughput Trends**: Line chart xu hướng throughput theo thời gian
- **Summary Cards**: Cards tóm tắt cho từng corporate với yield rate và số lượng
- **Filters**: Date range (7d/30d/90d), Corporate selector

### API Endpoints
- `corporateFactoryStats.yieldRateByCorporate` - Lấy yield rate theo corporate
- `corporateFactoryStats.yieldRateByFactory` - Lấy yield rate theo factory
- `corporateFactoryStats.throughputByCorporate` - Lấy throughput theo corporate
- `corporateFactoryStats.throughputByFactory` - Lấy throughput theo factory

### Location
- Tab "Công ty/Nhà máy" trong Dashboard (`/dashboard`)
- Component: `client/src/components/CorporateFactoryStats.tsx`
- Router: `corporateFactoryStatsRouter` trong `server/routers.ts`
- DB Functions: `server/db.ts` (lines 4647-4800)

---

## 🚧 TODO: Bulk Import/Export

### Overview
Cho phép admin import hàng loạt factories, workshops, machines từ Excel và export inspection data theo corporate/factory.

### Implementation Steps

#### 1. Backend - Import Router

Tạo `importRouter` trong `server/routers.ts`:

```typescript
const importRouter = router({
  importFactories: adminProcedure
    .input(z.object({
      data: z.array(z.object({
        code: z.string(),
        name: z.string(),
        description: z.string().optional(),
        address: z.string().optional(),
        region: z.string().optional(),
        country: z.string().optional(),
        isActive: z.boolean().optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      const results = { success: 0, failed: 0, errors: [] as string[] };
      
      for (const item of input.data) {
        try {
          await db.createFactory(item);
          results.success++;
        } catch (error: any) {
          results.failed++;
          results.errors.push(`${item.code}: ${error.message}`);
        }
      }
      
      return results;
    }),

  importWorkshops: adminProcedure
    .input(z.object({
      data: z.array(z.object({
        factoryCode: z.string(), // Lookup factoryId by code
        code: z.string(),
        name: z.string(),
        description: z.string().optional(),
        isActive: z.boolean().optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      const results = { success: 0, failed: 0, errors: [] as string[] };
      
      for (const item of input.data) {
        try {
          // Lookup factory by code
          const factory = await db.getFactoryByCode(item.factoryCode);
          if (!factory) {
            throw new Error(`Factory ${item.factoryCode} not found`);
          }
          
          await db.createWorkshop({
            factoryId: factory.id,
            code: item.code,
            name: item.name,
            description: item.description,
            isActive: item.isActive ?? true,
          });
          results.success++;
        } catch (error: any) {
          results.failed++;
          results.errors.push(`${item.code}: ${error.message}`);
        }
      }
      
      return results;
    }),

  importMachines: adminProcedure
    .input(z.object({
      data: z.array(z.object({
        stationCode: z.string(), // Lookup stationId by code
        code: z.string(),
        name: z.string(),
        machineType: z.enum(['AVI', 'AOI', 'SPI', 'X-RAY', 'OTHER']),
        model: z.string().optional(),
        manufacturer: z.string().optional(),
        isActive: z.boolean().optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      const results = { success: 0, failed: 0, errors: [] as string[] };
      
      for (const item of input.data) {
        try {
          // Lookup station by code
          const station = await db.getStationByCode(item.stationCode);
          if (!station) {
            throw new Error(`Station ${item.stationCode} not found`);
          }
          
          // Generate API key
          const apiKey = crypto.randomBytes(32).toString('hex');
          
          await db.createMachine({
            stationId: station.id,
            code: item.code,
            name: item.name,
            machineType: item.machineType,
            model: item.model,
            manufacturer: item.manufacturer,
            apiKey,
            isActive: item.isActive ?? true,
          });
          results.success++;
        } catch (error: any) {
          results.failed++;
          results.errors.push(`${item.code}: ${error.message}`);
        }
      }
      
      return results;
    }),
});
```

#### 2. Backend - Export Router

Tạo `exportRouter` trong `server/routers.ts`:

```typescript
import * as XLSX from 'xlsx';

const exportRouter = router({
  exportInspections: protectedProcedure
    .input(z.object({
      corporateCode: z.string().optional(),
      factoryCode: z.string().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .mutation(async ({ input }) => {
      const inspections = await db.getProductInspections({
        corporateCode: input.corporateCode,
        factoryCode: input.factoryCode,
        startDate: input.startDate,
        endDate: input.endDate,
        limit: 10000, // Max export limit
      });

      // Transform data for Excel
      const data = inspections.data.map(i => ({
        'Inspection ID': i.id,
        'Corporate Code': i.corporateCode,
        'Factory Code': i.factoryCode,
        'Serial Number': i.serialNumber,
        'Product Model': i.productModel,
        'Result': i.overallResult,
        'Inspection Time': new Date(i.inspectionTime).toLocaleString('vi-VN'),
        'Batch Number': i.batchNumber,
        'Machine Code': i.machineCode,
      }));

      // Create workbook
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Inspections');

      // Generate buffer
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      
      // Upload to S3
      const { storagePut } = await import('./storage');
      const filename = `inspections_${Date.now()}.xlsx`;
      const { url } = await storagePut(`exports/${filename}`, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      
      return { url, filename, count: data.length };
    }),

  exportStatistics: adminProcedure
    .input(z.object({
      startDate: z.date(),
      endDate: z.date(),
    }))
    .mutation(async ({ input }) => {
      const corporateStats = await db.getYieldRateByCorporate(input);
      const factoryStats = await db.getYieldRateByFactory(input);

      const wb = XLSX.utils.book_new();
      
      // Corporate sheet
      const corporateWs = XLSX.utils.json_to_sheet(corporateStats.map(s => ({
        'Corporate Code': s.corporateCode,
        'Total Inspections': s.totalInspections,
        'OK Count': s.okCount,
        'NG Count': s.ngCount,
        'NTF Count': s.ntfCount,
        'Yield Rate (%)': s.yieldRate,
      })));
      XLSX.utils.book_append_sheet(wb, corporateWs, 'Corporate Stats');

      // Factory sheet
      const factoryWs = XLSX.utils.json_to_sheet(factoryStats.map(s => ({
        'Corporate Code': s.corporateCode,
        'Factory Code': s.factoryCode,
        'Total Inspections': s.totalInspections,
        'OK Count': s.okCount,
        'NG Count': s.ngCount,
        'NTF Count': s.ntfCount,
        'Yield Rate (%)': s.yieldRate,
      })));
      XLSX.utils.book_append_sheet(wb, factoryWs, 'Factory Stats');

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      
      const { storagePut } = await import('./storage');
      const filename = `statistics_${Date.now()}.xlsx`;
      const { url } = await storagePut(`exports/${filename}`, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      
      return { url, filename };
    }),
});
```

#### 3. Frontend - Import/Export Page

Tạo `client/src/pages/ImportExport.tsx`:

```typescript
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Upload, Download, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';

export function ImportExport() {
  const [importing, setImporting] = useState(false);
  
  const importFactories = trpc.import.importFactories.useMutation();
  const importWorkshops = trpc.import.importWorkshops.useMutation();
  const importMachines = trpc.import.importMachines.useMutation();
  const exportInspections = trpc.export.exportInspections.useMutation();

  const handleFileUpload = async (file: File, type: 'factories' | 'workshops' | 'machines') => {
    setImporting(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      let result;
      if (type === 'factories') {
        result = await importFactories.mutateAsync({ data: jsonData as any });
      } else if (type === 'workshops') {
        result = await importWorkshops.mutateAsync({ data: jsonData as any });
      } else {
        result = await importMachines.mutateAsync({ data: jsonData as any });
      }

      toast.success(`Import thành công: ${result.success} items. Failed: ${result.failed}`);
      if (result.errors.length > 0) {
        console.error('Import errors:', result.errors);
      }
    } catch (error: any) {
      toast.error(`Import failed: ${error.message}`);
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = (type: 'factories' | 'workshops' | 'machines') => {
    let template: any[] = [];
    if (type === 'factories') {
      template = [{ code: 'FAC001', name: 'Factory 1', description: '', address: '', region: '', country: '', isActive: true }];
    } else if (type === 'workshops') {
      template = [{ factoryCode: 'FAC001', code: 'WS001', name: 'Workshop 1', description: '', isActive: true }];
    } else {
      template = [{ stationCode: 'ST001', code: 'MCH001', name: 'Machine 1', machineType: 'AVI', model: '', manufacturer: '', isActive: true }];
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(template);
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, `${type}_template.xlsx`);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Import/Export Data</h1>

      {/* Import Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Import Data
          </CardTitle>
          <CardDescription>Upload Excel files to import factories, workshops, or machines</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {['factories', 'workshops', 'machines'].map(type => (
            <div key={type} className="flex items-center gap-4">
              <Button variant="outline" onClick={() => downloadTemplate(type as any)}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Download {type} template
              </Button>
              <Input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file, type as any);
                }}
                disabled={importing}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Export Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Export Data
          </CardTitle>
          <CardDescription>Export inspection data and statistics to Excel</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={async () => {
              const result = await exportInspections.mutateAsync({});
              window.open(result.url, '_blank');
              toast.success(`Exported ${result.count} inspections`);
            }}
          >
            <Download className="h-4 w-4 mr-2" />
            Export Inspections
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

#### 4. Add to Navigation

Thêm vào `client/src/lib/navigation.tsx`:

```typescript
{
  title: 'Import/Export',
  href: '/import-export',
  icon: FileDown,
  requiresAdmin: true,
}
```

---

## 🚧 TODO: Multi-tenant Access Control

### Overview
Phân quyền user chỉ xem được data của corporate/factory được assign. Admin có thể assign user vào corporate/factory.

### Database Schema

Thêm vào `drizzle/schema.ts`:

```typescript
export const userCorporateAssignments = mysqlTable('user_corporate_assignments', {
  id: int('id').primaryKey().autoincrement(),
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  corporateCode: varchar('corporate_code', { length: 50 }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const userFactoryAssignments = mysqlTable('user_factory_assignments', {
  id: int('id').primaryKey().autoincrement(),
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  factoryCode: varchar('factory_code', { length: 50 }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});
```

### Middleware

Tạo `server/middleware/accessControl.ts`:

```typescript
import { TRPCError } from '@trpc/server';
import * as db from '../db';

export async function checkCorporateAccess(userId: number, corporateCode: string) {
  const user = await db.getUserById(userId);
  if (user?.role === 'admin') return true; // Admin has full access

  const assignments = await db.getUserCorporateAssignments(userId);
  return assignments.some(a => a.corporateCode === corporateCode);
}

export async function checkFactoryAccess(userId: number, factoryCode: string) {
  const user = await db.getUserById(userId);
  if (user?.role === 'admin') return true;

  const assignments = await db.getUserFactoryAssignments(userId);
  return assignments.some(a => a.factoryCode === factoryCode);
}

export async function filterByUserAccess<T extends { corporateCode?: string; factoryCode?: string }>(
  userId: number,
  data: T[]
): Promise<T[]> {
  const user = await db.getUserById(userId);
  if (user?.role === 'admin') return data;

  const corporateAssignments = await db.getUserCorporateAssignments(userId);
  const factoryAssignments = await db.getUserFactoryAssignments(userId);

  const allowedCorporates = new Set(corporateAssignments.map(a => a.corporateCode));
  const allowedFactories = new Set(factoryAssignments.map(a => a.factoryCode));

  return data.filter(item => {
    if (item.corporateCode && allowedCorporates.has(item.corporateCode)) return true;
    if (item.factoryCode && allowedFactories.has(item.factoryCode)) return true;
    return false;
  });
}
```

### Update Procedures

Cập nhật tất cả inspection/statistics procedures:

```typescript
// Example: Update getProductInspections
list: protectedProcedure
  .input(z.object({
    corporateCode: z.string().optional(),
    factoryCode: z.string().optional(),
    // ... other filters
  }))
  .query(async ({ input, ctx }) => {
    // Admin can see all
    if (ctx.user.role === 'admin') {
      return db.getProductInspections(input);
    }

    // Non-admin: filter by assignments
    const corporateAssignments = await db.getUserCorporateAssignments(ctx.user.id);
    const factoryAssignments = await db.getUserFactoryAssignments(ctx.user.id);

    // If user has specific assignments, apply filters
    if (corporateAssignments.length > 0 || factoryAssignments.length > 0) {
      const allowedCorporates = corporateAssignments.map(a => a.corporateCode);
      const allowedFactories = factoryAssignments.map(a => a.factoryCode);

      // Get all inspections and filter
      const result = await db.getProductInspections(input);
      result.data = result.data.filter(i => 
        (i.corporateCode && allowedCorporates.includes(i.corporateCode)) ||
        (i.factoryCode && allowedFactories.includes(i.factoryCode))
      );
      result.total = result.data.length;
      return result;
    }

    // No assignments = no access
    return { data: [], total: 0 };
  }),
```

### User Assignment UI

Tạo `client/src/pages/UserAssignments.tsx`:

```typescript
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { UserPlus, X } from 'lucide-react';

export function UserAssignments() {
  const { data: users } = trpc.user.list.useQuery({ limit: 1000 });
  const { data: corporates } = trpc.corporateFactoryStats.yieldRateByCorporate.useQuery({});
  const assignCorporate = trpc.userAssignment.assignCorporate.useMutation();
  const removeCorporate = trpc.userAssignment.removeCorporate.useMutation();

  // Similar UI for factory assignments

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">User Assignments</h1>

      {users?.data.map(user => (
        <Card key={user.id}>
          <CardHeader>
            <CardTitle>{user.name} ({user.email})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Corporate Access</h3>
              <div className="flex flex-wrap gap-2">
                {user.corporateAssignments?.map(a => (
                  <Badge key={a.id} variant="secondary">
                    {a.corporateCode}
                    <X
                      className="ml-1 h-3 w-3 cursor-pointer"
                      onClick={() => removeCorporate.mutate({ userId: user.id, corporateCode: a.corporateCode })}
                    />
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2 mt-2">
                <Select onValueChange={(code) => assignCorporate.mutate({ userId: user.id, corporateCode: code })}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Add corporate" />
                  </SelectTrigger>
                  <SelectContent>
                    {corporates?.map(c => (
                      <SelectItem key={c.corporateCode} value={c.corporateCode}>
                        {c.corporateCode}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

---

## Testing Checklist

### Dashboard Statistics
- [ ] Test yield rate chart với nhiều corporates
- [ ] Test factory drill-down khi chọn corporate
- [ ] Test throughput trends với date range khác nhau
- [ ] Test filters hoạt động đúng
- [ ] Test empty state khi không có data

### Bulk Import/Export
- [ ] Test import factories với valid data
- [ ] Test import với duplicate codes (should fail)
- [ ] Test import workshops với invalid factoryCode
- [ ] Test export inspections với filters
- [ ] Test export file format đúng
- [ ] Test large file import (1000+ rows)

### Multi-tenant Access Control
- [ ] Test admin có full access
- [ ] Test user chỉ thấy assigned corporate/factory
- [ ] Test user không có assignment không thấy gì
- [ ] Test assignment CRUD operations
- [ ] Test filter hoạt động đúng trong tất cả endpoints
