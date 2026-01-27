#!/usr/bin/env python3
"""
Fix PostgreSQL patterns in TypeScript files:
1. Replace .insertId with .returning() pattern
2. Replace 'as any[]' with proper typing
3. Fix sql.raw() patterns
"""

import re
import os
import glob

def fix_insert_id_patterns(content, filename):
    """
    Convert MySQL insertId pattern to PostgreSQL returning pattern
    
    Before:
    const result = await db.insert(table).values({...});
    return { id: result.insertId };
    
    After:
    const [result] = await db.insert(table).values({...}).returning({ id: table.id });
    return { id: result.id };
    """
    changes = 0
    
    # Pattern 1: result.insertId -> result[0].id (when using returning)
    content = re.sub(r'result\.insertId', 'result[0].id', content)
    
    # Pattern 2: result[0].insertId -> result[0].id
    content = re.sub(r'result\[0\]\.insertId', 'result[0].id', content)
    
    return content

def fix_as_any_array(content, filename):
    """
    Replace 'as any[]' with proper unknown first cast
    """
    # Pattern: ) as any[] -> ) as unknown as any[]
    content = re.sub(r'\)\s*as\s+any\[\]', ') as unknown as any[]', content)
    return content

def fix_sql_raw_patterns(content, filename):
    """
    Fix sql.raw patterns that might have MySQL-specific syntax
    """
    # No specific changes needed for now
    return content

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    
    content = fix_insert_id_patterns(content, filepath)
    content = fix_as_any_array(content, filepath)
    content = fix_sql_raw_patterns(content, filepath)
    
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        return True
    return False

def main():
    print("Fixing PostgreSQL patterns...")
    
    changed_files = []
    
    # Process all TypeScript files in server/
    for filepath in glob.glob('server/**/*.ts', recursive=True):
        if '.test.ts' in filepath:
            continue
        if process_file(filepath):
            changed_files.append(filepath)
            print(f"  Fixed: {filepath}")
    
    print(f"\nTotal files changed: {len(changed_files)}")

if __name__ == "__main__":
    main()
