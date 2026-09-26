-- ============================================================================
-- Migration 0312: vram_leases — SỔ CHUNG SỐNG, xuyên tiến trình
-- (Pha 3 Task 2, docs/superpowers/plans/2026-08-05-vram-pha3-so-chung.md)
--
-- ⚠⚠ ĐÍNH CHÍNH MỘT GIẢ ĐỊNH CỦA CHÍNH KẾ HOẠCH: kế hoạch Pha 3 viết "bảng
-- `vram_leases` đã tồn tại từ Pha 1". KHÔNG. Pha 1 (migration 0310) chỉ dựng
-- `vram_events` — một nhật ký CHỈ-GHI-THÊM, và docstring của nó nói rõ "Sổ cái
-- SỐNG nằm trong bộ nhớ tiến trình". Sổ chung ở DB chưa từng tồn tại; đây là
-- lượt tạo ĐẦU TIÊN.
--
-- HAI BẢNG, HAI VAI — đừng nhầm:
--   • vram_events  = LỊCH SỬ, chỉ-ghi-thêm, không ai đọc để quyết định.
--   • vram_leases  = TRẠNG THÁI SỐNG, có xoá, và ĐƯỜNG QUYẾT ĐỊNH ĐỌC NÓ.
--     Một dòng cho mỗi giấy phép đang tồn tại, ở BẤT KỲ tiến trình nào.
--
-- ⚠ Bảng này KHÔNG phải nguồn sự thật của một tiến trình về CHÍNH NÓ (sổ cục bộ
-- trong `vramBroker` mới là). Nó là BẢN CÔNG BỐ: mỗi tiến trình ghi trạng thái
-- của mình vào đây và đọc của anh em ra. Một hàng biến mất KHÔNG phải bằng
-- chứng tiến trình đó đã nhả — xem `server/services/vram/vramSharedLedger.ts`.
--
-- ⚠ `bytes` là bigint: mọi giá trị không hữu hạn phải bị chặn TRƯỚC khi tới đây
-- (22P02 làm mất CẢ LÔ — đúng tiền lệ 0311 với 22001). Hàng rào nằm ở
-- `vramSharedLedgerStore.rowFromLease()`.
--
-- ⚠ `processKey` chứa `bootMs` vì HĐH CẤP LẠI PID: một worker chết rồi tiến
-- trình khác nhận đúng PID đó sẽ "kế thừa" giấy phép của người đã chết và sổ
-- chung khai một khối byte không tồn tại (cùng lớp lỗi nợ N2-2 của Pha 2A).
--
-- ⚠⚠⚠ RÀNG BUỘC TOPO — **MỘT DATABASE = MỘT THIẾT BỊ GPU.** (I-2, review TOÀN
-- NHÁNH.) Bảng này CỐ Ý không có cột `host`/`device`, và hàng nền
-- (`leaseKey = 'vram:baseline'`) là **MỘT hàng cho CẢ DB**. Hệ quả, phải đọc
-- trước khi ai nối máy thứ hai:
--   • mọi tiến trình ghi vào một DB đang khai rằng chúng dùng CHUNG một card;
--     `foreignBytes` cộng thẳng byte của mọi hàng không phải của mình, không hỏi
--     chúng nằm ở máy nào;
--   • hai máy dùng chung một Postgres ⇒ nền của card A bị đọc làm nền của card B,
--     và dư địa của mỗi bên bị trừ cho byte NẰM TRÊN CARD KHÁC. Không cơ chế nào
--     trong Pha 3 phát hiện được chuyện đó — nó KHÔNG phải một lệch đo được, nó
--     là một phép cộng sai dân số.
-- HÔM NAY ràng buộc này ĐÚNG: `ROLE` chỉ có `api`/`worker`/all-in-one trên cùng
-- một máy (`edge` là dịch vụ C#, sidecar là tiến trình con — cả hai KHÔNG gọi
-- `startVramReconciler()` nên KHÔNG đọc/ghi bảng này; xem
-- `vramSharedLedgerStore.ts` M-7).
-- Nối site/edge thứ hai ⇒ **PHẢI** thêm chiều thiết bị TRƯỚC: cột `deviceKey`
-- (host + UUID GPU) vào khoá chính, vào `vram:baseline`, và vào phép lọc của
-- `dungBanSao()`. Đừng nối trước rồi vá sau.
--
-- ADDITIVE + IDEMPOTENT. Run by owner `aoi` (DDL convention — KHÔNG chạy bằng
-- role `avi_app`, sẽ lỗi 42501). Áp lên CẢ DB chính LẪN DB test
-- `aoi_management_test`.
-- ROLLBACK: DROP TABLE "vram_leases";
-- ============================================================================

CREATE TABLE IF NOT EXISTS "vram_leases" (
  "leaseKey"   varchar(200) PRIMARY KEY NOT NULL,
  "processKey" varchar(96) NOT NULL,
  "pid"        integer NOT NULL,
  "role"       varchar(32) NOT NULL,
  "leaseId"    varchar(64) NOT NULL,
  "owner"      varchar(160) NOT NULL,
  "leaseKind"  varchar(32) NOT NULL,
  "priority"   varchar(16) NOT NULL,
  "bytes"      bigint NOT NULL,
  "measured"   boolean DEFAULT false NOT NULL,
  "refCount"   integer DEFAULT 1 NOT NULL,
  "reclaimer"  varchar(32),
  "acquiredAt" timestamp NOT NULL,
  "updatedAt"  timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "vram_leases_process_idx" ON "vram_leases" ("processKey");
CREATE INDEX IF NOT EXISTS "vram_leases_updated_idx" ON "vram_leases" ("updatedAt");
