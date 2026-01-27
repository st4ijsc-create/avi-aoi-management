#!/usr/bin/env python3
"""
Fix remaining PostgreSQL patterns in TypeScript files.
Converts result[0].id to result.id when result is already destructured.
"""

import re
import os
import glob

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    
    # Pattern: const [result] = ... ; ... result[0].id -> result.id
    # This is for cases where we destructure but still use result[0]
    
    # Find all lines with result[0].id and check if result was destructured
    lines = content.split('\n')
    new_lines = []
    
    for i, line in enumerate(lines):
        # Check if this line has result[0].id
        if 'result[0].id' in line:
            # Look back to find if result was destructured
            found_destructure = False
            for j in range(max(0, i-20), i):
                if 'const [result]' in lines[j] or 'const [ result ]' in lines[j]:
                    found_destructure = True
                    break
            
            if found_destructure:
                # Replace result[0].id with result.id
                line = line.replace('result[0].id', 'result.id')
        
        new_lines.append(line)
    
    content = '\n'.join(new_lines)
    
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        return True
    return False

def main():
    print("Fixing remaining PostgreSQL patterns...")
    
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
