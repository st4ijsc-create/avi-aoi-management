#!/usr/bin/env python3
"""
Fix all getXxxById functions to return single object instead of array
"""

import re

filepath = '/home/ubuntu/avi-aoi-management/server/db.ts'

with open(filepath, 'r') as f:
    content = f.read()

# List of functions to fix
functions_to_fix = [
    'getWorkshopById',
    'getLineById', 
    'getStationById',
    'getMachineById',
    'getProductModelById',
    'getProductModelByCode',
    'getProductInspectionById',
    'getMeasurementPointDefById',
    'getMeasurementResultById',
    'getFactoryLayoutById',
    'getAlertSettingById',
    'getProductionOrderById',
    'getLineStageById',
    'getManualConnectionById',
    'getYieldAlertThresholdById',
    'getWorkstationById',
    'getScheduledReportById',
    'getMqttClientById',
    'getMqttAlertRuleById',
    'getEmailTemplateConfigById',
    'getDashboardTemplateById',
    'getProcessById',
    'getLineProcessAssignmentById',
    'getWidgetStylePresetById',
    'getProductCategoryById',
    'getScheduledBackupById',
    'getMarketplaceTemplateById',
]

count = 0
for func in functions_to_fix:
    # Pattern: find the function and replace "return result;" with "return result.length > 0 ? result[0] : undefined;"
    # Only if it's not already fixed
    pattern = rf'(export async function {func}\([^)]*\) \{{\s*const db = await getDb\(\);\s*if \(!db\) return undefined;\s*const result = await db\.select\(\)[^;]+\.limit\(1\);)\s*return result;'
    
    def replace_func(m):
        return m.group(1) + '\n  return result.length > 0 ? result[0] : undefined;'
    
    new_content = re.sub(pattern, replace_func, content, flags=re.DOTALL)
    if new_content != content:
        count += 1
        content = new_content

with open(filepath, 'w') as f:
    f.write(content)

print(f"Fixed {count} functions")
