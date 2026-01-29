#!/usr/bin/env python3
"""
Fix PostgreSQL patterns in TypeScript files:
1. Add .returning() to insert statements that don't have it
2. Fix result[0] patterns when result is already destructured
"""

import re
import os

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    
    # Pattern 1: Fix "const result = await db.insert(...).values(...);" without .returning()
    # Add .returning() and change to destructure
    pattern1 = r'const result = await db\.insert\((\w+)\)\.values\(([^;]+)\);(\s+return \{ id: Number\(result\[0\]\.id\))'
    def replace1(m):
        table = m.group(1)
        values = m.group(2)
        rest = m.group(3).replace('result[0].id', 'result.id')
        return f'const [result] = await db.insert({table}).values({values}).returning({{ id: {table}.id }});{rest}'
    content = re.sub(pattern1, replace1, content)
    
    # Pattern 2: Fix "const result = await db.insert(...).values(...);" followed by "return Number(result[0].id)"
    pattern2 = r'const result = await db\.insert\((\w+)\)\.values\(([^;]+)\);(\s+return Number\(result\[0\]\.id\))'
    def replace2(m):
        table = m.group(1)
        values = m.group(2)
        rest = m.group(3).replace('result[0].id', 'result.id')
        return f'const [result] = await db.insert({table}).values({values}).returning({{ id: {table}.id }});{rest}'
    content = re.sub(pattern2, replace2, content)
    
    # Pattern 3: Fix "const result = await db.insert(...).values(...);" followed by "return result[0].id"
    pattern3 = r'const result = await db\.insert\((\w+)\)\.values\(([^;]+)\);(\s+return result\[0\]\.id)'
    def replace3(m):
        table = m.group(1)
        values = m.group(2)
        rest = m.group(3).replace('result[0].id', 'result.id')
        return f'const [result] = await db.insert({table}).values({values}).returning({{ id: {table}.id }});{rest}'
    content = re.sub(pattern3, replace3, content)
    
    # Pattern 4: Fix "const result = await db.insert(...).values(...);" followed by "return result[0]"
    pattern4 = r'const result = await db\.insert\((\w+)\)\.values\(([^;]+)\);(\s+return result\[0\];)'
    def replace4(m):
        table = m.group(1)
        values = m.group(2)
        return f'const [result] = await db.insert({table}).values({values}).returning();{m.group(3).replace("result[0]", "result")}'
    content = re.sub(pattern4, replace4, content)
    
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        return True
    return False

# Fix files
files_to_fix = [
    '/home/ubuntu/avi-aoi-management/server/db.ts',
    '/home/ubuntu/avi-aoi-management/server/routers.ts',
]

for filepath in files_to_fix:
    if os.path.exists(filepath):
        if fix_file(filepath):
            print(f"Fixed: {filepath}")
        else:
            print(f"No changes: {filepath}")
    else:
        print(f"Not found: {filepath}")

print("Done!")
