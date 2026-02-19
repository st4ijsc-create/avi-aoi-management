-- Migration: Expand permission categories with new module categories
-- Add new permission categories for production, machine monitoring, and annotations

-- Add new enum values to permissioncategoryenum
ALTER TYPE "permissioncategoryenum" ADD VALUE IF NOT EXISTS 'production';
ALTER TYPE "permissioncategoryenum" ADD VALUE IF NOT EXISTS 'machine_monitoring';
ALTER TYPE "permissioncategoryenum" ADD VALUE IF NOT EXISTS 'annotations';
