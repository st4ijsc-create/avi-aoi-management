-- ★★ AI Local Đợt 5.1 phía VSCode (2026-10-17) — `ai_agent_feedback` nhận phiếu của lượt agent CHẠY CỤC BỘ trong extension.
--
-- Bối cảnh: phiếu web (0397) khoá theo `runId` của `ai_agent_runs` và máy chủ tự lấy văn bản từ SỔ. Lượt agent của
-- extension VSCode chạy cục bộ (lõi `shared/agentCore`, model qua `/v1`) — KHÔNG có hàng `ai_agent_runs`, nên:
--   • khoá phiếu = (người, `luotClient` — uuid do extension sinh, `chiSoTin`) — chỉ mục UNIQUE một phần RIÊNG;
--   • văn bản (câu hỏi + câu trả lời) do CLIENT gửi; máy chủ che bí mật + cắt trần (`thuTucPhanHoiClient`) — mức tin
--     THẤP hơn văn bản lấy từ sổ ⇒ cột `nguon` TÁCH hai mức: `web` (mặc định — mọi hàng 0397 hiện có) | `vscode`.
--   Không trộn: tổng hợp đếm tách nguồn, bộ xuất chỉ đọc `web` và mỗi mẫu JSONL ghi `nguon`.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHẠY BẰNG OWNER `aoi` qua `node scripts/apply-migration-0398.mjs --test-only|--dev-only|--both`.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- VÌ SAO không nhét uuid client vào `runId`: `runId` NGHĨA LÀ id `ai_agent_runs` (bộ xuất và `timRunTheoAction` dựa vào
-- đó); một uuid client trong cùng cột làm hàng vscode trông như có sổ máy chủ đứng sau — đúng kiểu trộn mức tin phải tránh.
-- Idempotent: ADD COLUMN IF NOT EXISTS; CHECK hình dạng THAY bằng bản mới chỉ khi định nghĩa cũ chưa nhắc `luotClient`.
-- KHÔNG FUNCTION/TRIGGER ⇒ không search_path phải ghim. Quyền avi_app (0397) phủ cột mới (GRANT theo bảng).

ALTER TABLE public.ai_agent_feedback ADD COLUMN IF NOT EXISTS nguon varchar(8) NOT NULL DEFAULT 'web';
ALTER TABLE public.ai_agent_feedback ADD COLUMN IF NOT EXISTS "luotClient" uuid;

-- MỘT phiếu cho mỗi (người × lượt client × khối) — gửi lại là SỬA (upsert). Chỉ mục web (0397) không đụng: hàng vscode có
-- `runId` NULL nên không bao giờ va vào nó.
CREATE UNIQUE INDEX IF NOT EXISTS ai_agent_feedback_vscode_uq
  ON public.ai_agent_feedback ("userId", "luotClient", "chiSoTin") WHERE loai = 'tra-loi' AND nguon = 'vscode';

DO $$
BEGIN
  -- Hình dạng: tra-loi mang ĐÚNG MỘT trong (runId | luotClient); diff không bao giờ mang luotClient.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_ai_agent_feedback_hinh_dang' AND pg_get_constraintdef(oid) LIKE '%luotClient%'
  ) THEN
    ALTER TABLE public.ai_agent_feedback DROP CONSTRAINT IF EXISTS chk_ai_agent_feedback_hinh_dang;
    ALTER TABLE public.ai_agent_feedback
      ADD CONSTRAINT chk_ai_agent_feedback_hinh_dang CHECK (
        (loai = 'tra-loi' AND "chiSoTin" IS NOT NULL AND "chiSoTin" >= 0
           AND "actionId" IS NULL AND "quyetDinh" IS NULL AND "danhGia" IS NOT NULL
           AND (("runId" IS NOT NULL AND "luotClient" IS NULL) OR ("runId" IS NULL AND "luotClient" IS NOT NULL)))
        OR
        (loai = 'diff' AND "actionId" IS NOT NULL AND "chiSoTin" IS NULL AND "luotClient" IS NULL
           AND ("danhGia" IS NOT NULL OR "quyetDinh" IS NOT NULL))
      );
  END IF;
  -- Nguồn: `web` ⇔ không luotClient (văn bản từ sổ máy chủ); `vscode` ⇒ CHỈ phiếu câu trả lời, khoá lượt client, có văn
  -- bản (không sổ để tra lại — phiếu không chữ là phiếu vô nghĩa), văn bản trong trần (cùng trần `shared/phanHoiAgent.ts`).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_agent_feedback_nguon') THEN
    ALTER TABLE public.ai_agent_feedback
      ADD CONSTRAINT chk_ai_agent_feedback_nguon CHECK (
        (nguon = 'web' AND "luotClient" IS NULL)
        OR
        (nguon = 'vscode' AND loai = 'tra-loi' AND "runId" IS NULL AND "luotClient" IS NOT NULL
           AND "noiDung" IS NOT NULL AND char_length("noiDung") <= 100000
           AND ("cauHoi" IS NULL OR char_length("cauHoi") <= 20000))
      );
  END IF;
END $$;
