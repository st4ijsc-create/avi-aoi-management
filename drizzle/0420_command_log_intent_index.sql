-- ★★★ 2026-10-24 — CHỈ MỤC BIỂU THỨC cho truy vấn "intent mở" của `commandLog.stats` (đợt rà phạm vi nhà máy, dieu-phoi giao).
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHẠY BẰNG OWNER `aoi` qua `node scripts/apply-migration-0420.mjs --test-only|--dev-only|--both`.
-- ⚠⚠ `CREATE INDEX CONCURRENTLY` KHÔNG được nằm trong giao dịch / lô nhiều câu lệnh ⇒ tệp này CỐ Ý CHỈ MỘT câu lệnh.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- Truy vấn (server/routers/commandLogRouter.ts, `stats`): với MỖI hàng intent, `NOT EXISTS (SELECT 1 FROM command_log r WHERE r."ackValue" ->> 'intentId' = "command_log"."id"::text)`.
-- Không có chỉ mục trên biểu thức ấy ⇒ mỗi hàng intent quét TOÀN BẢNG (O(n²)): 179 136 hàng ở `_test` ⇒ >120 s (statement_timeout).
-- Chỉ mục một phần (chỉ hàng có `intentId`): điều kiện `... ->> 'intentId' = x` kéo theo `IS NOT NULL` (toán tử STRICT) nên planner chứng minh được khớp.
--
-- KHÔNG đổi quyền: `command_log` là WORM (REVOKE UPDATE/DELETE) — tạo chỉ mục không đụng GRANT/REVOKE/trigger. Idempotent (`IF NOT EXISTS`).
-- ⚠ Nếu lần dựng bị ngắt, PG để lại chỉ mục INVALID và `IF NOT EXISTS` sẽ BỎ QUA nó: script áp kiểm `indisvalid` và chỉ cách xử lý
-- (`DROP INDEX CONCURRENTLY public.idx_command_log_intent_id;` rồi chạy lại).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_command_log_intent_id
  ON public.command_log ((("ackValue" ->> 'intentId')))
  WHERE ("ackValue" ->> 'intentId') IS NOT NULL;
