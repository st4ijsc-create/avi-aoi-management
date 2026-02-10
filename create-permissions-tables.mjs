import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

const sql = postgres(process.env.DATABASE_URL);

async function runMigration() {
  try {
    console.log('🚀 Creating permissions tables...');
    
    // Create permission category enum
    try {
      await sql.unsafe(`
        CREATE TYPE "public"."permissioncategoryenum" AS ENUM(
          'dashboard', 
          'history', 
          'analytics', 
          'reports', 
          'mqtt', 
          'settings', 
          'admin'
        );
      `);
      console.log('✓ Created permissioncategoryenum type');
    } catch (err) {
      if (err.code === '42710') {
        console.log('⏭️  permissioncategoryenum already exists');
      } else throw err;
    }
    
    // Create permissions table
    try {
      await sql.unsafe(`
        CREATE TABLE "permissions" (
          "id" serial PRIMARY KEY NOT NULL,
          "userId" integer NOT NULL,
          "category" "permissioncategoryenum" NOT NULL,
          "moduleName" varchar(100) NOT NULL,
          "canView" boolean DEFAULT false NOT NULL,
          "canCreate" boolean DEFAULT false NOT NULL,
          "canEdit" boolean DEFAULT false NOT NULL,
          "canDelete" boolean DEFAULT false NOT NULL,
          "canExport" boolean DEFAULT false NOT NULL,
          "customPermissions" json,
          "grantedBy" integer,
          "grantedAt" timestamp DEFAULT now() NOT NULL,
          "expiresAt" timestamp,
          "createdAt" timestamp DEFAULT now() NOT NULL,
          "updatedAt" timestamp DEFAULT now() NOT NULL
        );
      `);
      console.log('✓ Created permissions table');
    } catch (err) {
      if (err.code === '42P07') {
        console.log('⏭️  permissions table already exists');
      } else throw err;
    }
    
    // Create indexes
    try {
      await sql.unsafe(`CREATE INDEX "idx_permissions_user" ON "permissions" USING btree ("userId");`);
      console.log('✓ Created idx_permissions_user');
    } catch (err) {
      if (err.code === '42P07') console.log('⏭️  idx_permissions_user already exists');
      else throw err;
    }
    
    try {
      await sql.unsafe(`CREATE INDEX "idx_permissions_category" ON "permissions" USING btree ("category");`);
      console.log('✓ Created idx_permissions_category');
    } catch (err) {
      if (err.code === '42P07') console.log('⏭️  idx_permissions_category already exists');
      else throw err;
    }
    
    try {
      await sql.unsafe(`CREATE INDEX "idx_permissions_module" ON "permissions" USING btree ("moduleName");`);
      console.log('✓ Created idx_permissions_module');
    } catch (err) {
      if (err.code === '42P07') console.log('⏭️  idx_permissions_module already exists');
      else throw err;
    }
    
    try {
      await sql.unsafe(`CREATE UNIQUE INDEX "idx_permissions_user_module" ON "permissions" USING btree ("userId","moduleName");`);
      console.log('✓ Created idx_permissions_user_module');
    } catch (err) {
      if (err.code === '42P07') console.log('⏭️  idx_permissions_user_module already exists');
      else throw err;
    }
    
    // Create user_roles table
    try {
      await sql.unsafe(`
        CREATE TABLE "user_roles" (
          "id" serial PRIMARY KEY NOT NULL,
          "name" varchar(100) NOT NULL,
          "description" text,
          "isSystem" boolean DEFAULT false NOT NULL,
          "permissions" json NOT NULL,
          "createdBy" integer,
          "createdAt" timestamp DEFAULT now() NOT NULL,
          "updatedAt" timestamp DEFAULT now() NOT NULL,
          CONSTRAINT "user_roles_name_unique" UNIQUE("name")
        );
      `);
      console.log('✓ Created user_roles table');
    } catch (err) {
      if (err.code === '42P07') {
        console.log('⏭️  user_roles table already exists');
      } else throw err;
    }
    
    console.log('✅ Permissions tables created successfully!');
    
  } catch (err) {
    console.error('❌ Migration failed:', err);
    throw err;
  } finally {
    await sql.end();
  }
}

runMigration().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
