-- Dot 10.3 B1 (2026-10-26) — enum nha cung cap AI ngoai: them anthropic, gemini, openai_compat vao "apikeyprovider".
-- Tep RIENG va CHI gom ALTER TYPE ... ADD VALUE: gia tri moi khong dung duoc trong cung giao dich voi lenh them no (0414 dung chung).
--
-- ⚠ DDL ⇒ owner `aoi` qua `node scripts/apply-migration-0413.mjs --test-only|--dev-only|--both`. DEV chi sau khi dieu-phoi duyet SQL.
--
-- ROLLBACK: Postgres KHONG xoa duoc gia tri enum. Gia tri thua vo hai (khong hang nao dung khi 0414 chua ap / da go).

ALTER TYPE public.apikeyprovider ADD VALUE IF NOT EXISTS 'anthropic';
ALTER TYPE public.apikeyprovider ADD VALUE IF NOT EXISTS 'gemini';
ALTER TYPE public.apikeyprovider ADD VALUE IF NOT EXISTS 'openai_compat';
