#!/usr/bin/env python3
"""
Fix all insert patterns that are missing .returning() for PostgreSQL.
"""

import re
import os
import glob

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    
    # Pattern: const [result] = await db.insert(tableName).values(...);
    # Need to add .returning({ id: tableName.id }) before the semicolon
    
    # Find all matches of insert without returning
    pattern = r'(const \[result\] = await db\.insert\((\w+)\)\.values\([^)]+\))(?!\.returning)'
    
    def add_returning(match):
        full_match = match.group(1)
        table_name = match.group(2)
        # Add .returning({ id: tableName.id })
        return f'{full_match}.returning({{ id: {table_name}.id }})'
    
    content = re.sub(pattern, add_returning, content)
    
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        return True
    return False

def main():
    print("Fixing all insert patterns missing .returning()...")
    
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
