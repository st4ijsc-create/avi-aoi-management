#!/usr/bin/env python3
"""
Fix all insert patterns in db.ts for PostgreSQL:
1. Add .returning() to all insert statements
2. Change result[0] to result when using destructuring
"""

import re

filepath = '/home/ubuntu/avi-aoi-management/server/db.ts'

with open(filepath, 'r') as f:
    lines = f.readlines()

# Find all lines with "const result = await db.insert" without .returning()
changes = []
for i, line in enumerate(lines):
    if 'const result = await db.insert' in line and '.returning(' not in line:
        # Find the table name
        match = re.search(r'db\.insert\((\w+)\)', line)
        if match:
            table = match.group(1)
            # Check if line ends with );
            if line.rstrip().endswith(');'):
                # Single line insert - add .returning() before );
                new_line = line.rstrip()[:-2] + f'.returning({{ id: {table}.id }});\n'
                changes.append((i, new_line, table))
            else:
                # Multi-line insert - need to find closing );
                # For now, mark for manual review
                print(f"Line {i+1}: Multi-line insert for {table} - needs manual fix")

# Apply changes in reverse order to preserve line numbers
for i, new_line, table in reversed(changes):
    old_line = lines[i]
    lines[i] = new_line.replace('const result =', 'const [result] =')
    print(f"Line {i+1}: Fixed insert for {table}")

# Now fix result[0] patterns
content = ''.join(lines)

# Fix result[0].id -> result.id when result is destructured
# Pattern: after "const [result] = await db.insert"
content = re.sub(r'return result\[0\]\.id;', 'return result.id;', content)
content = re.sub(r'return Number\(result\[0\]\.id\);', 'return Number(result.id);', content)
content = re.sub(r'return \{ id: Number\(result\[0\]\.id\)', 'return { id: Number(result.id)', content)
content = re.sub(r'return result\[0\];', 'return result;', content)
content = re.sub(r'return result\[0\] \|\| null;', 'return result || null;', content)

with open(filepath, 'w') as f:
    f.write(content)

print("Done!")
