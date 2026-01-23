# Enterprise Features Implementation Guide

## ✅ Completed Features

### 1. Dashboard Statistics by Corporate/Factory
**Status**: ✅ Fully Implemented

- Corporate/Factory statistics router với 4 endpoints
- DB functions: `getYieldRateByCorporate`, `getYieldRateByFactory`, `getThroughputByCorporate`, `getThroughputByFactory`
- `CorporateFactoryStats` component với yield rate bar chart và throughput line chart
- Filters: date range (7d/30d/90d), corporate selector
- Tab "Công ty/Nhà máy" trong Dashboard
- Summary cards cho từng corporate

**Usage**:
```typescript
// Query corporate yield rate
const corporateStats = trpc.corporateFactoryStats.yieldRateByCorporate.useQuery({
  startDate: new Date('2024-01-01'),
  endDate: new Date(),
});

// Query factory throughput
const factoryThroughput = trpc.corporateFactoryStats.throughputByFactory.useQuery({
  startDate: new Date('2024-01-01'),
  endDate: new Date(),
  interval: 'day',
});
```

---

### 2. Bulk Import/Export
**Status**: ✅ Fully Implemented

**Import Features**:
- Excel template download cho Factories, Workshops, Machines
- Batch import với error handling và result summary
- Validation: check duplicate codes, foreign key references
- Admin-only access

**Export Features**:
- Export Inspections với filters (corporateCode, factoryCode, date range)
- Export Statistics (corporate và factory stats)
- Auto upload to S3 và return download URL
- Max 10,000 records per export

**Routers**:
- `trpc.import.importFactories`
- `trpc.import.importWorkshops`
- `trpc.import.importMachines`
- `trpc.export.exportInspections`
- `trpc.export.exportStatistics`

**UI**: `/import-export` page với file upload và template download

**Excel Template Formats**:

**Factories Template**:
```
code | name | description | address | region | country | isActive
FAC001 | Nhà máy 1 | Mô tả | 123 Đường ABC | Miền Nam | Việt Nam | true
```

**Workshops Template**:
```
factoryCode | code | name | description | isActive
FAC001 | WS001 | Xưởng 1 | Mô tả | true
```

**Machines Template**:
```
stationCode | code | name | machineType | model | manufacturer | isActive
ST001 | MCH001 | Máy 1 | AVI | Model ABC | Manufacturer XYZ | true
```

**Usage Example**:
```typescript
// Import factories
const importResult = await trpc.import.importFactories.mutateAsync({
  data: [
    { code: 'FAC001', name: 'Factory 1', ... },
    { code: 'FAC002', name: 'Factory 2', ... },
  ]
});
// Returns: { success: 2, failed: 0, errors: [] }

// Export inspections
const exportResult = await trpc.export.exportInspections.mutateAsync({
  corporateCode: 'CORP001',
  startDate: new Date('2024-01-01'),
  endDate: new Date(),
});
// Returns: { url: 'https://...', filename: 'inspections_xxx.xlsx', count: 1234 }
```

---

### 3. Multi-tenant Access Control
**Status**: 🚧 Partially Implemented (Database schema + helper functions ready)

**Completed**:
- ✅ Database tables: `user_corporate_assignments`, `user_factory_assignments`
- ✅ DB helper functions: `getUserCorporateAssignments`, `getUserFactoryAssignments`, `createCorporateAssignment`, `createFactoryAssignment`, `deleteCorporateAssignment`, `deleteFactoryAssignment`
- ✅ Access check functions: `hasAccessToCorporate`, `hasAccessToFactory`

**Remaining Work**:

#### Step 1: Create User Assignment Router
Create `userAssignmentRouter` in `server/routers.ts`:

```typescript
const userAssignmentRouter = router({
  // Get user's assignments
  getMyAssignments: protectedProcedure
    .query(async ({ ctx }) => {
      const corporates = await db.getUserCorporateAssignments(ctx.user.id);
      const factories = await db.getUserFactoryAssignments(ctx.user.id);
      return { corporates, factories };
    }),

  // Get all users with assignments (admin only)
  getAllUserAssignments: adminProcedure
    .query(async () => {
      const users = await db.getUsers();
      const result = [];
      for (const user of users) {
        const corporates = await db.getUserCorporateAssignments(user.id);
        const factories = await db.getUserFactoryAssignments(user.id);
        result.push({ user, corporates, factories });
      }
      return result;
    }),

  // Assign user to corporate (admin only)
  assignCorporate: adminProcedure
    .input(z.object({
      userId: z.number(),
      corporateCode: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      return db.createCorporateAssignment({
        userId: input.userId,
        corporateCode: input.corporateCode,
        assignedBy: ctx.user.id,
      });
    }),

  // Assign user to factory (admin only)
  assignFactory: adminProcedure
    .input(z.object({
      userId: z.number(),
      factoryCode: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      return db.createFactoryAssignment({
        userId: input.userId,
        factoryCode: input.factoryCode,
        assignedBy: ctx.user.id,
      });
    }),

  // Remove corporate assignment (admin only)
  removeCorporateAssignment: adminProcedure
    .input(z.object({
      userId: z.number(),
      corporateCode: z.string(),
    }))
    .mutation(async ({ input }) => {
      return db.deleteCorporateAssignment(input.userId, input.corporateCode);
    }),

  // Remove factory assignment (admin only)
  removeFactoryAssignment: adminProcedure
    .input(z.object({
      userId: z.number(),
      factoryCode: z.string(),
    }))
    .mutation(async ({ input }) => {
      return db.deleteFactoryAssignment(input.userId, input.factoryCode);
    }),
});

// Add to appRouter
export const appRouter = router({
  // ... existing routers
  userAssignment: userAssignmentRouter,
});
```

#### Step 2: Apply Access Control to Inspection Queries
Update `getProductInspections` in `server/db.ts`:

```typescript
export async function getProductInspections(params: {
  userId?: number; // Add userId for access control
  corporateCode?: string;
  factoryCode?: string;
  // ... other params
}) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };

  let query = db.select().from(productInspections);

  // Apply access control for non-admin users
  if (params.userId) {
    const user = await getUserById(params.userId);
    if (user?.role !== 'admin') {
      const corporateAssignments = await getUserCorporateAssignments(params.userId);
      const factoryAssignments = await getUserFactoryAssignments(params.userId);
      
      const corporateCodes = corporateAssignments.map(a => a.corporateCode);
      const factoryCodes = factoryAssignments.map(a => a.factoryCode);
      
      // Filter by assigned corporates/factories
      if (corporateCodes.length > 0 || factoryCodes.length > 0) {
        query = query.where(
          or(
            corporateCodes.length > 0 ? inArray(productInspections.corporateCode, corporateCodes) : undefined,
            factoryCodes.length > 0 ? inArray(productInspections.factoryCode, factoryCodes) : undefined
          )
        );
      } else {
        // User has no assignments, return empty
        return { data: [], total: 0 };
      }
    }
  }

  // ... rest of query logic
}
```

Update inspection router to pass userId:

```typescript
list: protectedProcedure
  .input(z.object({
    // ... existing inputs
  }))
  .query(async ({ input, ctx }) => {
    return db.getProductInspections({
      ...input,
      userId: ctx.user.id, // Pass user ID for access control
    });
  }),
```

#### Step 3: Create User Assignments UI
Create `client/src/pages/UserAssignments.tsx`:

```typescript
import { useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { UserPlus, X } from 'lucide-react';
import { navItems } from '@/lib/navigation';

export default function UserAssignments() {
  const [selectedUser, setSelectedUser] = useState<number | null>(null);
  const [selectedCorporate, setSelectedCorporate] = useState<string>('');
  const [selectedFactory, setSelectedFactory] = useState<string>('');

  const { data: allAssignments, refetch } = trpc.userAssignment.getAllUserAssignments.useQuery();
  const assignCorporate = trpc.userAssignment.assignCorporate.useMutation();
  const assignFactory = trpc.userAssignment.assignFactory.useMutation();
  const removeCorporate = trpc.userAssignment.removeCorporateAssignment.useMutation();
  const removeFactory = trpc.userAssignment.removeFactoryAssignment.useMutation();

  const handleAssignCorporate = async () => {
    if (!selectedUser || !selectedCorporate) return;
    
    try {
      await assignCorporate.mutateAsync({
        userId: selectedUser,
        corporateCode: selectedCorporate,
      });
      toast.success('Assigned corporate successfully');
      refetch();
    } catch (error: any) {
      toast.error(`Failed: ${error.message}`);
    }
  };

  const handleRemoveCorporate = async (userId: number, corporateCode: string) => {
    try {
      await removeCorporate.mutateAsync({ userId, corporateCode });
      toast.success('Removed corporate assignment');
      refetch();
    } catch (error: any) {
      toast.error(`Failed: ${error.message}`);
    }
  };

  return (
    <DashboardLayout
      title="User Assignments"
      navItems={navItems}
      currentPath="/user-assignments"
    >
      <div className="space-y-6">
        {/* Assignment Form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Assign User to Corporate/Factory
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Select value={selectedUser?.toString() || ''} onValueChange={(v) => setSelectedUser(Number(v))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select User" />
                </SelectTrigger>
                <SelectContent>
                  {allAssignments?.map((item) => (
                    <SelectItem key={item.user.id} value={item.user.id.toString()}>
                      {item.user.name || item.user.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={selectedCorporate} onValueChange={setSelectedCorporate}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Corporate" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CORP001">CORP001</SelectItem>
                  <SelectItem value="CORP002">CORP002</SelectItem>
                </SelectContent>
              </Select>

              <Button onClick={handleAssignCorporate} disabled={!selectedUser || !selectedCorporate}>
                Assign Corporate
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* User Assignments List */}
        <div className="space-y-4">
          {allAssignments?.map((item) => (
            <Card key={item.user.id}>
              <CardHeader>
                <CardTitle className="text-lg">
                  {item.user.name || item.user.email}
                  <Badge variant="outline" className="ml-2">{item.user.role}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h4 className="font-semibold mb-2">Corporate Assignments:</h4>
                  <div className="flex flex-wrap gap-2">
                    {item.corporates.map((corp) => (
                      <Badge key={corp.id} variant="secondary" className="flex items-center gap-1">
                        {corp.corporateCode}
                        <X 
                          className="h-3 w-3 cursor-pointer" 
                          onClick={() => handleRemoveCorporate(item.user.id, corp.corporateCode)}
                        />
                      </Badge>
                    ))}
                    {item.corporates.length === 0 && <span className="text-muted-foreground text-sm">No assignments</span>}
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Factory Assignments:</h4>
                  <div className="flex flex-wrap gap-2">
                    {item.factories.map((factory) => (
                      <Badge key={factory.id} variant="secondary" className="flex items-center gap-1">
                        {factory.factoryCode}
                        <X 
                          className="h-3 w-3 cursor-pointer" 
                          onClick={() => handleRemoveFactory(item.user.id, factory.factoryCode)}
                        />
                      </Badge>
                    ))}
                    {item.factories.length === 0 && <span className="text-muted-foreground text-sm">No assignments</span>}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
```

Add route in `client/src/App.tsx`:
```typescript
import UserAssignments from "./pages/UserAssignments";
// ...
<Route path="/user-assignments" component={UserAssignments} />
```

Add to navigation in `client/src/lib/navigation.tsx`:
```typescript
{ href: "/user-assignments", label: "User Assignments", icon: <Users className="h-4 w-4" /> },
```

#### Step 4: Apply Access Control to All Data Queries
Update these routers to include access control:
- `inspectionRouter.list` - filter inspections by user assignments
- `corporateFactoryStatsRouter` - filter stats by user assignments
- `dashboardRouter.stats` - filter dashboard stats by user assignments
- `historyRouter.list` - filter history by user assignments

Pattern:
```typescript
protectedProcedure
  .input(z.object({ /* ... */ }))
  .query(async ({ input, ctx }) => {
    // Check if user is admin
    if (ctx.user.role !== 'admin') {
      // Get user assignments
      const corporateAssignments = await db.getUserCorporateAssignments(ctx.user.id);
      const factoryAssignments = await db.getUserFactoryAssignments(ctx.user.id);
      
      // If no assignments, return empty
      if (corporateAssignments.length === 0 && factoryAssignments.length === 0) {
        return { data: [], total: 0 };
      }
      
      // Apply filters
      input.corporateCodes = corporateAssignments.map(a => a.corporateCode);
      input.factoryCodes = factoryAssignments.map(a => a.factoryCode);
    }
    
    return db.getProductInspections(input);
  }),
```

---

### 4. Dashboard Drill-down
**Status**: 📝 Not Started

**Implementation Steps**:

#### Step 1: Add Drill-down State Management
Update `client/src/components/CorporateFactoryStats.tsx`:

```typescript
const [drillDownState, setDrillDownState] = useState<{
  level: 'corporate' | 'factory' | 'machine';
  corporateCode?: string;
  factoryCode?: string;
}>({ level: 'corporate' });

const [selectedCorporate, setSelectedCorporate] = useState<string | null>(null);
const [selectedFactory, setSelectedFactory] = useState<string | null>(null);
```

#### Step 2: Add onClick Handler to Charts
```typescript
// In Bar Chart config
const chartConfig = {
  onClick: (event, elements) => {
    if (elements.length > 0) {
      const index = elements[0].index;
      const corporateCode = corporateStats[index].corporateCode;
      setSelectedCorporate(corporateCode);
      setDrillDownState({ level: 'factory', corporateCode });
    }
  },
};
```

#### Step 3: Create Factory Details Query
Add to `corporateFactoryStatsRouter`:

```typescript
factoryDetails: protectedProcedure
  .input(z.object({
    corporateCode: z.string(),
    startDate: z.date(),
    endDate: z.date(),
  }))
  .query(async ({ input }) => {
    // Query factory-level details for a specific corporate
    return db.getYieldRateByFactory({
      corporateCode: input.corporateCode,
      startDate: input.startDate,
      endDate: input.endDate,
    });
  }),

machineAnalytics: protectedProcedure
  .input(z.object({
    factoryCode: z.string(),
    startDate: z.date(),
    endDate: z.date(),
  }))
  .query(async ({ input }) => {
    // Query machine-level analytics for a specific factory
    const db = await getDb();
    if (!db) return [];
    
    const results = await db.select({
      machineCode: productInspections.machineCode,
      totalInspections: sql<number>`COUNT(*)`,
      okCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'OK' THEN 1 ELSE 0 END)`,
      ngCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END)`,
      yieldRate: sql<number>`ROUND(SUM(CASE WHEN ${productInspections.overallResult} = 'OK' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2)`,
    })
    .from(productInspections)
    .where(and(
      eq(productInspections.factoryCode, input.factoryCode),
      gte(productInspections.inspectionTime, input.startDate),
      lte(productInspections.inspectionTime, input.endDate)
    ))
    .groupBy(productInspections.machineCode);
    
    return results;
  }),
```

#### Step 4: Create Drill-down UI
```typescript
// In CorporateFactoryStats component
return (
  <div className="space-y-4">
    {/* Breadcrumb Navigation */}
    {drillDownState.level !== 'corporate' && (
      <div className="flex items-center gap-2 text-sm">
        <Button variant="ghost" size="sm" onClick={() => setDrillDownState({ level: 'corporate' })}>
          All Corporates
        </Button>
        {drillDownState.corporateCode && (
          <>
            <span>/</span>
            {drillDownState.level === 'machine' ? (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setDrillDownState({ level: 'factory', corporateCode: drillDownState.corporateCode })}
              >
                {drillDownState.corporateCode}
              </Button>
            ) : (
              <span className="font-semibold">{drillDownState.corporateCode}</span>
            )}
          </>
        )}
        {drillDownState.factoryCode && (
          <>
            <span>/</span>
            <span className="font-semibold">{drillDownState.factoryCode}</span>
          </>
        )}
      </div>
    )}

    {/* Conditional Rendering based on drill-down level */}
    {drillDownState.level === 'corporate' && (
      <CorporateChart onClick={(corporateCode) => {
        setSelectedCorporate(corporateCode);
        setDrillDownState({ level: 'factory', corporateCode });
      }} />
    )}

    {drillDownState.level === 'factory' && drillDownState.corporateCode && (
      <FactoryChart 
        corporateCode={drillDownState.corporateCode}
        onClick={(factoryCode) => {
          setSelectedFactory(factoryCode);
          setDrillDownState({ 
            level: 'machine', 
            corporateCode: drillDownState.corporateCode, 
            factoryCode 
          });
        }}
      />
    )}

    {drillDownState.level === 'machine' && drillDownState.factoryCode && (
      <MachineAnalyticsTable factoryCode={drillDownState.factoryCode} />
    )}
  </div>
);
```

#### Step 5: Add Loading States
```typescript
const { data: factoryDetails, isLoading: isLoadingFactory } = trpc.corporateFactoryStats.factoryDetails.useQuery(
  {
    corporateCode: drillDownState.corporateCode!,
    startDate,
    endDate,
  },
  { enabled: drillDownState.level === 'factory' && !!drillDownState.corporateCode }
);

{isLoadingFactory && <Skeleton className="h-64" />}
```

---

## Testing Checklist

### Bulk Import/Export
- [ ] Upload valid Excel files for factories, workshops, machines
- [ ] Test duplicate code validation
- [ ] Test foreign key validation (e.g., invalid factoryCode in workshops)
- [ ] Test error handling and result summary
- [ ] Test template download
- [ ] Test export with different date ranges
- [ ] Test export with corporate/factory filters
- [ ] Verify S3 upload and download URL

### Multi-tenant Access Control
- [ ] Assign user to corporate and verify assignment
- [ ] Assign user to factory and verify assignment
- [ ] Remove assignments and verify
- [ ] Login as non-admin user and verify filtered data
- [ ] Verify admin can see all data
- [ ] Test inspection list with access control
- [ ] Test dashboard stats with access control

### Dashboard Drill-down
- [ ] Click corporate bar and verify factory details load
- [ ] Click factory bar and verify machine analytics load
- [ ] Test breadcrumb navigation back to corporate view
- [ ] Verify loading states during drill-down
- [ ] Test with different date ranges

---

## Performance Considerations

1. **Access Control Queries**: Cache user assignments in memory or Redis to avoid repeated DB queries
2. **Export Large Datasets**: Consider background jobs for exports > 10,000 records
3. **Drill-down Queries**: Add indexes on `corporateCode`, `factoryCode`, `machineCode` in `product_inspections`
4. **Import Validation**: Batch validation in chunks of 100-500 records to avoid memory issues

---

## Security Considerations

1. **Import/Export**: Admin-only access enforced via `adminProcedure`
2. **User Assignments**: Only admins can assign/remove assignments
3. **Access Control**: Enforce at DB query level, not just UI level
4. **SQL Injection**: Use parameterized queries (Drizzle ORM handles this)
5. **File Upload**: Validate file size (< 10MB) and file type (.xlsx, .xls only)

---

## Next Steps Priority

1. **High Priority**: Complete Multi-tenant Access Control UI and apply to all data queries
2. **Medium Priority**: Implement Dashboard Drill-down for better analytics UX
3. **Low Priority**: Add background jobs for large exports, add Redis caching for assignments
