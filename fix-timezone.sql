-- Check current state
SELECT COUNT(*), MIN("inspectionTime"), MAX("inspectionTime") FROM product_inspections;

-- Fix: shift all inspectionTime by +7 hours (UTC → UTC+7 Vietnam)
UPDATE product_inspections SET "inspectionTime" = "inspectionTime" + INTERVAL '7 hours';

-- Verify after fix
SELECT COUNT(*), MIN("inspectionTime"), MAX("inspectionTime") FROM product_inspections;
