#!/usr/bin/env python3
"""
Fix all remaining functions that return result || null
"""

import re

filepath = '/home/ubuntu/avi-aoi-management/server/db.ts'

with open(filepath, 'r') as f:
    content = f.read()

# Pattern to find: .limit(1);\n  return result || null;
# Replace with: .limit(1);\n  return result.length > 0 ? result[0] : null;

pattern = r'(\.limit\(1\);)\s*\n(\s*)return result \|\| null;'

def replace_func(m):
    limit_part = m.group(1)
    indent = m.group(2)
    return f'{limit_part}\n{indent}return result.length > 0 ? result[0] : null;'

content = re.sub(pattern, replace_func, content)

with open(filepath, 'w') as f:
    f.write(content)

print("Done!")
