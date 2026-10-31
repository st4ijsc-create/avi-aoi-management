-- Dot 10.4b L0a' (2026-10-30) — DAU NGUON lượt sinh chu bang model NGOAI (ke hoach v2.1 §2 D9, ra kiem-dinh M5 / 6b-4).
--
-- ⚠ DDL ⇒ owner `aoi` qua `node scripts/apply-migration-0417.mjs --test-only|--dev-only|--both`. DEV chi sau khi dieu-phoi duyet SQL.
--
-- Vi sao: kho chat do CLIENT ghi (`aiChat.saveStreamedMessage` nhan nguyen van cau tra loi) ⇒ dau nguon KHONG duoc la loi khai cua client.
--   • ai_external_calls."bamTraLoi"      sha256 (hex) noi dung tra ve cua nha cung cap — CONG ghi cung hang ket qua.
--   • ai_chat_messages."nguonModel"       `ngoai:<ncc>:<model>` khi may chu XAC MINH (callId cua dung nguoi + ketCuc ok + bam khop) — NULL = cuc bo.
--   • ai_chat_messages."ngoaiCallId"      hang so cong da xac minh (JOIN ⇒ token / chi phi hien lich su). Xoa hang so (het han giu) ⇒ NULL;
--                                         "nguonModel" van giu (dau nguon khong mat khi so het han).
--   • ai_chat_conversations."coLuotNgoai" / ai_coding_sessions."coLuotNgoai"   MAY CHU dat luc goi (request mang conversationId / phienId)
--     hoac luc luu (callId da xac minh) ⇒ lich su cua hoi thoai do bi boc UNTRUSTED + loai khoi hoc / ingest, ke ca khi mot tin bi sua mat dau.
-- Moi cot moi: mac dinh = hanh vi cu (khong co luot ngoai).
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS public."ai_external_calls_nguoi_bam_idx"; DROP INDEX IF EXISTS public."ai_chat_messages_ngoai_call_idx";
--   ALTER TABLE public."ai_external_calls" DROP CONSTRAINT IF EXISTS "ai_external_calls_bam_tra_loi_chk", DROP COLUMN IF EXISTS "bamTraLoi";
--   ALTER TABLE public."ai_chat_messages" DROP CONSTRAINT IF EXISTS "ai_chat_messages_nguon_model_chk",
--     DROP COLUMN IF EXISTS "ngoaiCallId", DROP COLUMN IF EXISTS "nguonModel";
--   ALTER TABLE public."ai_chat_conversations" DROP COLUMN IF EXISTS "coLuotNgoai";
--   ALTER TABLE public."ai_coding_sessions" DROP COLUMN IF EXISTS "coLuotNgoai";

ALTER TABLE public."ai_external_calls" ADD COLUMN IF NOT EXISTS "bamTraLoi" char(64);
ALTER TABLE public."ai_external_calls" DROP CONSTRAINT IF EXISTS "ai_external_calls_bam_tra_loi_chk";
ALTER TABLE public."ai_external_calls" ADD CONSTRAINT "ai_external_calls_bam_tra_loi_chk"
  CHECK ("bamTraLoi" IS NULL OR "bamTraLoi" ~ '^[0-9a-f]{64}$');
-- Do theo bam trong 24 h gan nhat cua MOT nguoi (client quen gui callId) — chi cac hang co bam.
CREATE INDEX IF NOT EXISTS "ai_external_calls_nguoi_bam_idx"
  ON public."ai_external_calls" ("userId", "bamTraLoi") WHERE "bamTraLoi" IS NOT NULL;

ALTER TABLE public."ai_chat_messages"
  ADD COLUMN IF NOT EXISTS "nguonModel" varchar(140),
  ADD COLUMN IF NOT EXISTS "ngoaiCallId" bigint REFERENCES public."ai_external_calls"("id") ON DELETE SET NULL;
ALTER TABLE public."ai_chat_messages" DROP CONSTRAINT IF EXISTS "ai_chat_messages_nguon_model_chk";
ALTER TABLE public."ai_chat_messages" ADD CONSTRAINT "ai_chat_messages_nguon_model_chk"
  CHECK ("nguonModel" IS NULL OR ("nguonModel" ~ '^ngoai:[a-z0-9_-]{1,32}:[A-Za-z0-9._:/@-]{1,96}$' AND "role" = 'assistant'));

-- FK ON DELETE SET NULL ⇒ moi hang so bi xoa se tim ai_chat_messages theo cot nay — chi muc mot phan (dieu-phoi duyet SQL 2026-10-30).
CREATE INDEX IF NOT EXISTS "ai_chat_messages_ngoai_call_idx"
  ON public."ai_chat_messages" ("ngoaiCallId") WHERE "ngoaiCallId" IS NOT NULL;

ALTER TABLE public."ai_chat_conversations" ADD COLUMN IF NOT EXISTS "coLuotNgoai" boolean NOT NULL DEFAULT false;
ALTER TABLE public."ai_coding_sessions" ADD COLUMN IF NOT EXISTS "coLuotNgoai" boolean NOT NULL DEFAULT false;
