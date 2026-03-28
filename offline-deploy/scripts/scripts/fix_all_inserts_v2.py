#!/usr/bin/env python3
"""
Fix all insert patterns that are missing .returning() for PostgreSQL.
Handles multiline insert statements.
"""

import re
import os
import glob

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    
    # Pattern: const [result] = await db.insert(tableName).values({...});
    # Need to add .returning({ id: tableName.id }) before the semicolon
    # Handle multiline values
    
    # Find all insert patterns and add .returning() if missing
    pattern = r'(const \[result\] = await db\.insert\((\w+)\)\.values\()(\{[^}]*\}|\([^)]*\))(\))(;)'
    
    def add_returning(match):
        prefix = match.group(1)  # const [result] = await db.insert(tableName).values(
        table_name = match.group(2)  # tableName
        values = match.group(3)  # {...} or (...)
        close_paren = match.group(4)  # )
        semicolon = match.group(5)  # ;
        
        # Check if already has .returning
        full_match = match.group(0)
        if '.returning' in full_match:
            return full_match
        
        # Add .returning({ id: tableName.id })
        return f'{prefix}{values}{close_paren}.returning({{ id: {table_name}.id }}){semicolon}'
    
    # Use DOTALL flag to match across lines
    content = re.sub(pattern, add_returning, content, flags=re.DOTALL)
    
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        return True
    return False

def main():
    print("Fixing all insert patterns missing .returning() (v2)...")
    
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
