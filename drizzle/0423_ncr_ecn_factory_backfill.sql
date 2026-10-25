-- 0423 — backfill `factoryId` cho NCR (nonconformance_reports) va ECN (engineering_changes). 2026-10-25 (luong-ui, lo L6a; dieu-phoi duyet huong (a)+(b)+(c)).
--
-- ⚠ DML tren du lieu that => CHAY BANG OWNER `aoi` qua `node scripts/apply-migration-0423.mjs --test-only|--dev-only|--both`. DEV chi sau khi phien dieu phoi duyet SQL + so hang do truoc.
--
-- LY DO: `ncr.create` / `ecn.create` truoc day KHONG ghi `factoryId` (cot nullable, input khong co) => moi phieu NULL => khong the pham vi hoa doc theo nha may.
-- Tu nay create tu suy factoryId (router); migration nay chi VA hang cu, CHI qua chuoi lien ket co that, KHONG doan:
--   NCR:  linkedInspectionId -> product_inspections.machineId -> machines -> stations -> production_lines -> workshops.factoryId
--   NCR:  (khong co lan kiem lien ket) serialNumber khop DUNG 1 nha may qua product_inspections (neu nhieu nha may => bo qua)
--   ECN:  productModelId -> product_machine_mappings -> machines -> ... -> factoryId, CHI khi san pham map toi DUNG 1 nha may
-- Hang khong suy ra duoc GIU NULL (tro thanh "chi toan quyen thay") — dem bang scripts/apply-migration-0423.mjs va bao chu du an.
-- Idempotent: chi UPDATE ... WHERE "factoryId" IS NULL; chay lai khong doi gi (hang da co factoryId khong bi dong vao).

UPDATE public.nonconformance_reports n
   SET "factoryId" = w."factoryId"
  FROM public.product_inspections pi
  JOIN public.machines m ON m.id = pi."machineId"
  JOIN public.stations st ON st.id = m."stationId"
  JOIN public.production_lines l ON l.id = st."lineId"
  JOIN public.workshops w ON w.id = l."workshopId"
 WHERE n."factoryId" IS NULL
   AND n."linkedInspectionId" IS NOT NULL
   AND pi.id = n."linkedInspectionId";

UPDATE public.nonconformance_reports n
   SET "factoryId" = x.factory_id
  FROM (
    SELECT n2.id AS ncr_id, (array_agg(DISTINCT w."factoryId"))[1] AS factory_id
      FROM public.nonconformance_reports n2
      JOIN public.product_inspections pi ON pi."serialNumber" = n2."serialNumber"
      JOIN public.machines m ON m.id = pi."machineId"
      JOIN public.stations st ON st.id = m."stationId"
      JOIN public.production_lines l ON l.id = st."lineId"
      JOIN public.workshops w ON w.id = l."workshopId"
     WHERE n2."factoryId" IS NULL AND n2."linkedInspectionId" IS NULL AND n2."serialNumber" IS NOT NULL
     GROUP BY n2.id
    HAVING count(DISTINCT w."factoryId") = 1
  ) x
 WHERE n.id = x.ncr_id AND n."factoryId" IS NULL;

UPDATE public.engineering_changes e
   SET "factoryId" = x.factory_id
  FROM (
    SELECT e2.id AS ecn_id, (array_agg(DISTINCT w."factoryId"))[1] AS factory_id
      FROM public.engineering_changes e2
      JOIN public.product_machine_mappings pmm ON pmm."productModelId" = e2."productModelId"
      JOIN public.machines m ON m.id = pmm."machineId"
      JOIN public.stations st ON st.id = m."stationId"
      JOIN public.production_lines l ON l.id = st."lineId"
      JOIN public.workshops w ON w.id = l."workshopId"
     WHERE e2."factoryId" IS NULL AND e2."productModelId" IS NOT NULL
     GROUP BY e2.id
    HAVING count(DISTINCT w."factoryId") = 1
  ) x
 WHERE e.id = x.ecn_id AND e."factoryId" IS NULL;
