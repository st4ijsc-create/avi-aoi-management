# Fix MySQL → PostgreSQL Migration Patterns

## ✅ Đã Fix
1. `result[0]` → `result.rows` (getDailyStats, getHourlyStats)
2. `inArray()` cho topNGPoints (3 chỗ)
3. `inArray()` cho corporateCode/factoryCode (2 chỗ line 751, 755)

## 🔄 Cần Fix (16 chỗ còn lại)

### Pattern: `IN (${ids.join(',')})`
Thay bằng `inArray(column, ids)`

**Locations in server/db.ts:**
- Line 1094: `sql\`${productionLines.workshopId} IN (${workshopIds.join(',')})\``
- Line 1099: `sql\`${stations.lineId} IN (${lineIds.join(',')})\``
- Line 1104: `sql\`${machines.stationId} IN (${stationIds.join(',')})\``
- Line 1108: `sql\`${productInspections.machineId} IN (${machineIds.join(',')})\``
- Line 1457: `sql\`${workshops.factoryId} IN (${factoryResult.map(f => f.id).join(',')})\``
- Line 1472: `sql\`${productionLines.workshopId} IN (${workshopIds.join(',')})\``
- Line 1486: `sql\`${stations.lineId} IN (${lineIds.join(',')})\``
- Line 1500: `sql\`${machines.stationId} IN (${stationIds.join(',')})\``
- Line 1508: `sql\`${productInspections.machineId} IN (${machineIds.join(',')})\``
- Line 4790: `sql\`${productInspections.corporateCode} IN (${corporateCodes.map(c => \`'${c}'\`).join(',')})\``
- Line 4847: `sql\`${productInspections.corporateCode} IN (${corporateCodes.map(c => \`'${c}'\`).join(',')})\``
- Line 4851: `sql\`${productInspections.factoryCode} IN (${factoryCodes.map(f => \`'${f}'\`).join(',')})\``
- Line 4909: `sql\`${productInspections.corporateCode} IN (${corporateCodes.map(c => \`'${c}'\`).join(',')})\``
- Line 4970: `sql\`${productInspections.corporateCode} IN (${corporateCodes.map(c => \`'${c}'\`).join(',')})\``
- Line 4974: `sql\`${productInspections.factoryCode} IN (${factoryCodes.map(f => \`'${f}'\`).join(',')})\``
- Line 7415: `sql\`${productInspections.machineId} IN (${machineIds.join(',')})\``
- Line 7466: `sql\`${productInspections.machineId} IN (${machineIds.join(',')})\``

## 🐛 Lỗi Validation (Không liên quan PostgreSQL)
- **productModel.list**: limit=1000 > max=100
- **inspection.list**: limit=10000 > max=1000

Fix: Giảm limit trong frontend hoặc tăng max ở router.

## 📝 Script Fix Commands

```bash
# Tìm tất cả IN clause với numeric IDs
grep -n "IN (\${.*\.join(',')})" server/db.ts | grep -v "corporateCode\|factoryCode"

# Tìm tất cả IN clause với string codes  
grep -n "IN (\${.*map.*join(',')})" server/db.ts
```
