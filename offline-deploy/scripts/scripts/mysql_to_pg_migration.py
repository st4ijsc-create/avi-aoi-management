#!/usr/bin/env python3
"""
Comprehensive MySQL to PostgreSQL migration script for Drizzle ORM
Converts schema.ts and db.ts from MySQL to PostgreSQL syntax
"""

import re
import os

def convert_schema(content):
    """Convert drizzle/schema.ts from MySQL to PostgreSQL"""
    
    # Step 1: Replace imports
    content = re.sub(
        r'import \{[^}]+\} from "drizzle-orm/mysql-core";',
        '''import { pgTable, pgEnum, serial, integer, text, timestamp, varchar, decimal, boolean, bigint, index, json, uniqueIndex } from "drizzle-orm/pg-core";''',
        content
    )
    
    # Step 2: Replace mysqlTable with pgTable
    content = content.replace('mysqlTable(', 'pgTable(')
    
    # Step 3: Replace int().autoincrement().primaryKey() with serial().primaryKey()
    content = re.sub(
        r'int\("(\w+)"\)\.autoincrement\(\)\.primaryKey\(\)',
        r'serial("\1").primaryKey()',
        content
    )
    
    # Step 4: Replace int() with integer()
    content = re.sub(r'\bint\("', 'integer("', content)
    
    # Step 5: Convert mysqlEnum to pgEnum
    # First, collect all unique enum definitions
    enum_definitions = {}
    enum_pattern = r'mysqlEnum\("(\w+)",\s*\[([^\]]+)\]\)'
    
    for match in re.finditer(enum_pattern, content):
        col_name = match.group(1)
        values = match.group(2)
        # Create unique enum name based on column name
        enum_name = f"{col_name}Enum"
        if enum_name not in enum_definitions:
            enum_definitions[enum_name] = values
    
    # Create enum declarations at the top of the file (after imports)
    enum_declarations = []
    enum_counter = {}
    
    def get_unique_enum_name(base_name, values):
        """Generate unique enum name for duplicate column names with different values"""
        key = f"{base_name}_{values}"
        if key not in enum_counter:
            # Check if this exact enum already exists
            for name, vals in enum_counter.items():
                if vals == values:
                    return name.split('_')[0]
            enum_counter[key] = len([k for k in enum_counter if k.startswith(base_name)])
        
        count = enum_counter[key]
        if count == 0:
            return base_name
        return f"{base_name}_{count}"
    
    # Track created enums
    created_enums = {}
    
    def replace_enum(match):
        col_name = match.group(1)
        values = match.group(2).strip()
        
        # Create a unique key for this enum based on values
        values_key = values.replace(" ", "").replace('"', "'")
        
        if values_key not in created_enums:
            # Generate unique enum name
            base_enum_name = f"{col_name}Enum"
            enum_var_name = base_enum_name
            counter = 1
            while enum_var_name in [v[0] for v in created_enums.values()]:
                enum_var_name = f"{base_enum_name}_{counter}"
                counter += 1
            
            created_enums[values_key] = (enum_var_name, values)
        
        enum_var_name = created_enums[values_key][0]
        return f'{enum_var_name}("{col_name}")'
    
    # Replace all mysqlEnum usages
    content = re.sub(enum_pattern, replace_enum, content)
    
    # Generate enum declarations
    enum_decl_lines = []
    for values_key, (enum_name, values) in created_enums.items():
        enum_decl_lines.append(f'export const {enum_name} = pgEnum("{enum_name.lower()}", [{values}]);')
    
    # Insert enum declarations after imports
    import_end = content.find('/**')
    if import_end == -1:
        import_end = content.find('export const')
    
    if import_end > 0:
        enum_block = '\n\n// PostgreSQL Enum Definitions\n' + '\n'.join(enum_decl_lines) + '\n\n'
        content = content[:import_end] + enum_block + content[import_end:]
    
    # Step 6: Replace .onUpdateNow() (MySQL specific) with just defaultNow()
    content = re.sub(r'\.onUpdateNow\(\)', '', content)
    
    # Step 7: Fix any remaining autoincrement patterns
    content = re.sub(r'\.autoincrement\(\)', '', content)
    
    return content


def convert_db(content):
    """Convert server/db.ts from MySQL to PostgreSQL"""
    
    # Step 1: Replace imports
    content = re.sub(
        r'import \{ drizzle \} from "drizzle-orm/mysql2";',
        'import { drizzle } from "drizzle-orm/node-postgres";'
    )
    
    content = re.sub(
        r'from "drizzle-orm/mysql2"',
        'from "drizzle-orm/node-postgres"'
    )
    
    # Step 2: Replace mysql2 pool creation with pg Pool
    # Find and replace the database connection setup
    content = re.sub(
        r'import mysql from "mysql2/promise";',
        'import { Pool } from "pg";'
    )
    
    content = re.sub(
        r'mysql\.createPool\(\{[^}]+\}\)',
        '''new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  })''',
        content,
        flags=re.DOTALL
    )
    
    # Step 3: Replace onDuplicateKeyUpdate with onConflictDoUpdate
    content = re.sub(
        r'\.onDuplicateKeyUpdate\(\{([^}]+)\}\)',
        lambda m: '.onConflictDoUpdate({ target: [], set: {' + m.group(1) + '}})',
        content
    )
    
    # Step 4: Replace insertId pattern with returning
    # Pattern: const result = await db.insert(table).values(...); ... result.insertId
    # Should become: const [result] = await db.insert(table).values(...).returning({ id: table.id });
    
    return content


def convert_routers(content, filename):
    """Convert router files from MySQL patterns to PostgreSQL"""
    
    # Replace insertId patterns
    # Pattern: result.insertId or result[0].insertId
    content = re.sub(r'result\.insertId', 'result[0].id', content)
    content = re.sub(r'result\[0\]\.insertId', 'result[0].id', content)
    
    # Replace onDuplicateKeyUpdate with onConflictDoUpdate
    content = re.sub(
        r'\.onDuplicateKeyUpdate\(\{',
        '.onConflictDoUpdate({ target: [], set: {',
        content
    )
    
    return content


def main():
    print("Starting MySQL to PostgreSQL migration...")
    
    # Convert schema.ts
    schema_path = 'drizzle/schema.ts'
    print(f"Converting {schema_path}...")
    with open(schema_path, 'r') as f:
        schema_content = f.read()
    
    # Backup original
    with open(schema_path + '.mysql.backup', 'w') as f:
        f.write(schema_content)
    
    converted_schema = convert_schema(schema_content)
    with open(schema_path, 'w') as f:
        f.write(converted_schema)
    print(f"  Converted {schema_path}")
    
    print("\nMigration complete!")
    print("\nNext steps:")
    print("1. Install pg driver: pnpm add pg @types/pg")
    print("2. Update drizzle.config.ts to use 'pg' dialect")
    print("3. Update server/db.ts to use node-postgres")
    print("4. Run: pnpm drizzle-kit generate")
    print("5. Run: pnpm db:push")


if __name__ == "__main__":
    main()
