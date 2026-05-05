-- Check measurement_results createdAt range
SELECT COUNT(*), MIN("createdAt"), MAX("createdAt") FROM measurement_results;

-- Check if createdAt matches inspectionTime pattern (stored as UTC)
-- Compare with product_inspections to see if offset exists
SELECT pi."inspectionTime", mr."createdAt", pi."inspectionTime" - mr."createdAt" as diff
FROM product_inspections pi
JOIN measurement_results mr ON mr."inspectionId" = pi.id
ORDER BY pi.id DESC LIMIT 5;
