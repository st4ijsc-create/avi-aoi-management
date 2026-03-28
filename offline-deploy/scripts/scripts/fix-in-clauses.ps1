# Fix PostgreSQL IN clause patterns automatically
# Run: .\scripts\fix-in-clauses.ps1

$dbFile = "server\db.ts"
$content = Get-Content $dbFile -Raw

Write-Host "🔍 Fixing IN clause patterns in $dbFile..." -ForegroundColor Cyan

# Backup original
Copy-Item $dbFile "$dbFile.backup" -Force
Write-Host "✅ Backup created: $dbFile.backup" -ForegroundColor Green

# Pattern 1: Numeric IDs - .where(sql`${column} IN (${ids.join(',')})`)
# Replace with: .where(inArray(column, ids))

$patterns = @(
    @{
        Old = "\.where\(sql``\$\{productionLines\.workshopId\} IN \(\$\{workshopIds\.join\(','\)\}\)``\)"
        New = ".where(inArray(productionLines.workshopId, workshopIds))"
        Desc = "productionLines.workshopId"
    },
    @{
        Old = "\.where\(sql``\$\{stations\.lineId\} IN \(\$\{lineIds\.join\(','\)\}\)``\)"
        New = ".where(inArray(stations.lineId, lineIds))"
        Desc = "stations.lineId"
    },
    @{
        Old = "\.where\(sql``\$\{machines\.stationId\} IN \(\$\{stationIds\.join\(','\)\}\)``\)"
        New = ".where(inArray(machines.stationId, stationIds))"
        Desc = "machines.stationId"
    },
    @{
        Old = "conditions\.push\(sql``\$\{productInspections\.machineId\} IN \(\$\{machineIds\.join\(','\)\}\)``\);"
        New = "conditions.push(inArray(productInspections.machineId, machineIds));"
        Desc = "productInspections.machineId (conditions.push)"
    },
    @{
        Old = "\.where\(sql``\$\{workshops\.factoryId\} IN \(\$\{factoryResult\.map\(f => f\.id\)\.join\(','\)\}\)``\)"
        New = ".where(inArray(workshops.factoryId, factoryResult.map(f => f.id)))"
        Desc = "workshops.factoryId"
    }
)

# Pattern 2: String codes with quotes - IN (${codes.map(c => `'${c}'`).join(',')})
# Replace with: inArray(column, codes)

$stringPatterns = @(
    @{
        Old = "sql``\$\{productInspections\.corporateCode\} IN \(\$\{corporateCodes\.map\(c => ``'`$\{c\}'``\)\.join\(','\)\}\)``"
        New = "inArray(productInspections.corporateCode, corporateCodes)"
        Desc = "productInspections.corporateCode"
    },
    @{
        Old = "sql``\$\{productInspections\.factoryCode\} IN \(\$\{factoryCodes\.map\([cf] => ``'`$\{[cf]\}'``\)\.join\(','\)\}\)``"
        New = "inArray(productInspections.factoryCode, factoryCodes)"
        Desc = "productInspections.factoryCode"
    }
)

$totalChanges = 0

foreach ($pattern in $patterns) {
    $regex = [regex]$pattern.Old
    $matches = $regex.Matches($content)
    if ($matches.Count -gt 0) {
        $content = $regex.Replace($content, $pattern.New)
        $totalChanges += $matches.Count
        Write-Host "  ✅ Fixed $($matches.Count)x: $($pattern.Desc)" -ForegroundColor Green
    }
}

foreach ($pattern in $stringPatterns) {
    $regex = [regex]$pattern.Old
    $matches = $regex.Matches($content)
    if ($matches.Count -gt 0) {
        $content = $regex.Replace($content, $pattern.New)
        $totalChanges += $matches.Count
        Write-Host "  ✅ Fixed $($matches.Count)x: $($pattern.Desc)" -ForegroundColor Green
    }
}

if ($totalChanges -gt 0) {
    Set-Content $dbFile $content -NoNewline
    Write-Host "`n🎉 Total changes: $totalChanges" -ForegroundColor Cyan
    Write-Host "✅ File updated: $dbFile" -ForegroundColor Green
    Write-Host "`n⚠️  Please run 'pnpm build' to verify changes" -ForegroundColor Yellow
} else {
    Write-Host "`n✅ No changes needed - all patterns already fixed!" -ForegroundColor Green
}
