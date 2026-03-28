#!/usr/bin/env python3
"""
Fix all getXxxById functions to return single object instead of array
"""

import re

filepath = '/home/ubuntu/avi-aoi-management/server/db.ts'

with open(filepath, 'r') as f:
    content = f.read()

# Pattern to find: functions that end with "return result;" after a .limit(1) query
# and change to "return result.length > 0 ? result[0] : undefined;"

# Find all occurrences of pattern like:
# const result = await db.select()...limit(1);
# return result;

# Replace with:
# const result = await db.select()...limit(1);
# return result.length > 0 ? result[0] : undefined;

# Pattern for single line
pattern = r'(const result = await db\.select\(\)\.from\(\w+\)\.where\([^)]+\)\.limit\(1\);)\s*\n(\s*)return result;'

def replace_func(m):
    query_line = m.group(1)
    indent = m.group(2)
    return f'{query_line}\n{indent}return result.length > 0 ? result[0] : undefined;'

content = re.sub(pattern, replace_func, content)

# Also fix pattern with orderBy
pattern2 = r'(const result = await db\.select\(\)\.from\(\w+\)\.where\([^)]+\)\.orderBy\([^)]+\)\.limit\(1\);)\s*\n(\s*)return result;'
content = re.sub(pattern2, replace_func, content)

with open(filepath, 'w') as f:
    f.write(content)

print("Done!")
