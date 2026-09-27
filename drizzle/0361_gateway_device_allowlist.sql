-- ════════════════════════════════════════════════════════════════════════════
-- 0361 — doc 81 Đợt 1C Task 4: ALLOWLIST THIẾT BỊ cho khoá gateway (`IOT_GATEWAY`)
--        (`gateway_device_allowlist`)
-- ════════════════════════════════════════════════════════════════════════════
--
-- VÌ SAO: quyết định chủ dự án 2026-09-27 — khoá của máy loại IOT_GATEWAY chỉ được GHI cho các
--   thiết bị nằm trong allowlist của CHÍNH gateway đó, ở cả `/api/ot/ingest` lẫn `/api/v1/ingest/*`.
--   Trước bản này `/api/ot/ingest` MIỄN ràng buộc cho IOT_GATEWAY (lỗ R17 đã ghi trong mã) ⇒ một khoá
--   gateway ghi được cho BẤT KỲ deviceId nào.
--
-- VÌ SAO BẢNG MỚI mà không dùng cột JSON có sẵn (Global Constraint 14 — chỉ thêm khi không có cột phù
--   hợp). `machines` không có cột metadata/config; cột JSON mở duy nhất là `capabilities`, và nó KHÔNG
--   phù hợp để chứa một CHÍNH SÁCH PHÂN QUYỀN:
--     • `machine.update` (settings_factory canEdit) GHI ĐÈ NGUYÊN KHỐI `capabilities` ⇒ một lối sửa thứ
--       hai, không qua cổng/audit riêng, và UI sửa capabilities sẽ lặng lẽ xoá allowlist;
--     • `capabilities` được TRẢ RA ở `/api/v1/assets*`, `equipment.*`, FOE, AI orchestration… (≥10 kẻ
--       đọc) ⇒ chính sách lộ ra mọi bề mặt đọc;
--     • `capabilitiesValidation` / drift-scan sẽ gắn cờ khoá lạ cho mọi gateway có allowlist.
--   Thêm CỘT vào `machines` cũng bị loại: mọi `select().from(machines)` của drizzle sẽ đòi cột ấy ⇒ DB
--   dev chưa áp migration là HỎNG TOÀN BỘ truy vấn máy. Bảng riêng chỉ ảnh hưởng đường gateway, và nếu
--   DB chưa áp thì đường ấy trả 503 (fail-closed, không ghi gì).
--
-- NGỮ NGHĨA: một hàng = gateway `gatewayMachineId` được phép ghi cho thiết bị `deviceMachineId`.
--   Gateway KHÔNG có hàng nào ⇒ allowlist RỖNG ⇒ gateway KHÔNG ghi được gì (fail-closed). Gateway muốn
--   ghi telemetry của CHÍNH nó phải tự có mặt trong allowlist của mình. Thiết bị đã ngừng (isActive =
--   false) bị bỏ qua lúc kiểm (không mở lại cho máy mới cùng mã — id là khoá, không phải mã).
--
-- ⚠ DDL chạy bằng owner `aoi` (`avi_app` → 42501): `node scripts/apply-migration-0361.mjs`.
-- ⚠ Repo CẤM `drizzle-kit push/generate` — bảng khai TAY vào `drizzle/schema/hierarchy.ts` cùng lượt.
-- ROLLBACK: DROP TABLE IF EXISTS "gateway_device_allowlist";
--
CREATE TABLE IF NOT EXISTS "gateway_device_allowlist" (
  "gatewayMachineId" integer NOT NULL REFERENCES "machines"("id") ON DELETE CASCADE,
  "deviceMachineId" integer NOT NULL REFERENCES "machines"("id") ON DELETE CASCADE,
  "addedBy" integer,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "pk_gateway_device_allowlist" PRIMARY KEY ("gatewayMachineId", "deviceMachineId")
);
CREATE INDEX IF NOT EXISTS "idx_gateway_device_allowlist_device" ON "gateway_device_allowlist" ("deviceMachineId");
-- Vai ứng dụng: SELECT (kiểm lúc ingest) + INSERT/DELETE (thay allowlist). KHÔNG UPDATE/TRUNCATE —
-- sửa allowlist = xoá + chèn trong MỘT transaction, kèm dòng control_audit_log. Bọc DO để môi trường
-- không có vai `avi_app` vẫn chạy được (khuôn 0357/0359).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    -- REVOKE tường minh: default ACL của dev cấp ĐỦ quyền cho avi_app (0357 đo 2026-09-15).
    REVOKE UPDATE, TRUNCATE ON "gateway_device_allowlist" FROM avi_app;
    GRANT SELECT, INSERT, DELETE ON "gateway_device_allowlist" TO avi_app;
  END IF;
END $$;
