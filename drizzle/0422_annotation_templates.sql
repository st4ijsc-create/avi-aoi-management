-- 0422 — bang `annotation_templates` (mau chu thich dung chung). 2026-10-24 (luong-ui, dieu-phoi giao sau khi lo L1b do duoc loi).
--
-- ⚠⚠ DDL => CHAY BANG OWNER `aoi` qua `node scripts/apply-migration-0422.mjs --test-only|--dev-only|--both`. DEV chi sau khi phien dieu phoi duyet SQL nay.
--
-- LOI THAT: `server/routers/annotationRouters.ts` (annotationTemplate.list|create|delete va annotation.bulkApplyTemplate) doc/ghi bang `annotation_templates` bang SQL tho,
-- nhung KHONG migration nao tao bang (grep toan repo: 0 file .sql / schema drizzle). Do tren DEV `aoi_management` va `aoi_management_test`: bang KHONG ton tai
-- (annotation_history + image_annotations CO) => trang mau chu thich va "ap mau hang loat" loi `relation "annotation_templates" does not exist`.
--
-- Cot theo dung cach ma doc/ghi (annotationRouters.ts): id, name, category (defect_marker|measurement_guide|quality_stamp|custom), description, annotations (JSON),
-- previewUrl, isSystem (mau he thong khong xoa duoc), createdBy, createdAt. Mau la DU LIEU DUNG CHUNG (khong gan nha may) — xem MIEN_TRU o kiem-dinh.
-- Idempotent (IF NOT EXISTS) — chay lai khong doi gi.
CREATE TABLE IF NOT EXISTS public.annotation_templates (
  id          serial PRIMARY KEY,
  name        varchar(255) NOT NULL,
  category    varchar(32)  NOT NULL DEFAULT 'custom'
                CONSTRAINT annotation_templates_category_chk CHECK (category IN ('defect_marker', 'measurement_guide', 'quality_stamp', 'custom')),
  description text,
  annotations json         NOT NULL DEFAULT '[]'::json,
  "previewUrl" text,
  "isSystem"  boolean      NOT NULL DEFAULT false,
  "createdBy" integer,
  "createdAt" timestamp    NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_annotation_templates_category ON public.annotation_templates (category);

-- Quyen cho vai ung dung (khuon 0431): bang moi cua owner `aoi` da co default ACL, nhung khai ro.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    RAISE NOTICE '[0422] role avi_app absent — grants skipped (dev DB without least-privilege role; apply 0224 first).';
    RETURN;
  END IF;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.annotation_templates TO avi_app;
  GRANT USAGE, SELECT ON SEQUENCE public.annotation_templates_id_seq TO avi_app;
END $$;
