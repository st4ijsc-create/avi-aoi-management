# SCADA R1b-2b-1 · An toàn và nợ — Báo cáo nghiệm thu (KHUNG — Task 2 tạo, Task 16 điền)

> Khung do Task 2 (kiem-dinh G1 — một luật bool) tạo. CHỈ §4 mục 2b và Phụ lục A đã có nội dung; mọi mục khác do Task 16 điền.
> `server/services/scada/lenhInterlockLechLuoi.baoCao.test.ts` so khối SQL §4 mục 2b với hằng `TRUY_VAN_TRUOC_TRIEN_KHAI_BOOL` TỪNG KÝ TỰ — Task 16
> KHÔNG được sửa khối đó (sửa hằng ⇒ sửa khối, và ngược lại).

## Kết luận ngắn

_(Task 16)_

## 1. Ma trận ô

_(Task 16)_

## 2. Đột biến cấp hệ thống

_(Task 16)_

## 3. Bench OpenPLC

_(Task 16 — ô B1: ghim STOP `1` trên coil kiểu int ⇒ ghi TRUE, acked; bản DB tương đương đã có ở Task 2:
`commandDispatcher.kenh.r1a.db.test.ts` ca "KD-T2 + điều kiện 1c".)_

## 4. Thứ tự triển khai

1. _(Task 16 — migration / điều kiện R1b-2a §4 vẫn bắt buộc.)_
2. _(Task 16 — truy vấn R1b-2a `TRUY_VAN_TRUOC_TRIEN_KHAI` = 0 hàng.)_

2b. **BẮT BUỘC, TRƯỚC bản build, trên MỌI DB: truy vấn bool trước triển khai = 0 hàng** (R1b-2b-1 Task 2, kiem-dinh G1). Bản build làm `dispatch()`
   từ chối (`TYPE_MISMATCH`) mọi giá trị ngoài `true`/`false`, `1`/`0`, `"1"`/`"0"`, `"true"`/`"false"` gửi lên tag bool CHƯA khai, và mọi driver ghi
   bool bằng cùng luật (trước: `Boolean("false")` = TRUE trên thiết bị). Một luật interlock ĐÃ BẬT từ trước với `commandValue` như `"on"` / `2` / `{"v":1}`
   trên tag bool sẽ bị từ chối đúng lúc hành động bảo vệ cần chạy. Chạy trong phiên `SET default_transaction_read_only = on`. Chuỗi dưới là bản
   NGUYÊN VĂN của hằng `TRUY_VAN_TRUOC_TRIEN_KHAI_BOOL` (`server/services/scada/lenhInterlockLechLuoi.ts`):

```sql
-- R1b-2b-1 §4 mục 2b — luật interlock ĐANG BẬT nhắm tag bool với commandValue ngoài tập bool hợp lệ (CHỈ ĐỌC). ≥ 1 hàng ⇒ DỪNG triển khai.
SELECT r.id, r.name, r."targetAdapterId", t."tagKey", r."commandValue", 'KHONG_PARSE_DUOC' AS ket_luan
FROM interlock_rules r
JOIN device_tags t ON t."adapterId" = r."targetAdapterId" AND t."tagKey" = r."commandTag"
WHERE r.enabled AND r.action::text <> 'alert' AND t."dataType"::text = 'bool'
  AND NOT (
        r."commandValue" IS NULL
     OR jsonb_typeof(r."commandValue") IN ('null', 'boolean')
     OR (CASE WHEN jsonb_typeof(r."commandValue") = 'number' THEN (r."commandValue" #>> '{}')::numeric IN (0, 1) ELSE false END)
     OR (jsonb_typeof(r."commandValue") = 'string' AND lower(btrim(r."commandValue" #>> '{}')) IN ('0', '1', 'true', 'false'))
  )
ORDER BY r.id
```

   **Census Task 2 (cổng dừng C12 / Q2 / điều kiện 1a):** census TEST 0 hàng; census DEV 0 hàng, nhưng DEV không có ghim / luật bật / tag slmp-mc; mọi
   DB đích khác phải chạy lại `task-2-census.sql` (phụ lục) trước triển khai. Census phủ (Q1–Q6): luật bật nhắm tag bool / tag địa chỉ coil–bit với
   `commandValue` ngoài tập; write FOE (`step.args.writes`, mọi độ sâu, cả lịch sử phiên bản) lên tag bool / coil–bit ngoài tập; tag bool có `stop_value`
   không phải boolean; ghim STOP trên MỌI tag địa chỉ coil–bit (coil Modbus, holding bool, bit-device SLMP / MC, bit S7) ngoài tập 8 giá trị. ≥ 1 hàng
   ở bất kỳ câu nào ⇒ DỪNG, sửa dữ liệu trước. Kết quả TEST chi tiết: `.superpowers/sdd/2026-10-26-scada-r1b-2b-1-an-toan-va-no/task-2-census-test.md`.

3. _(Task 16)_

## 5. Chạy toàn bộ

_(Task 16)_

## 6. Giới hạn đã biết

_(Task 16)_

## Phụ lục A — `task-2-census.sql` (NGUYÊN VĂN, chỉ đọc)

Chạy trên DB đích bằng psql: `BEGIN TRANSACTION READ ONLY;` → dán / `\i` khối dưới → `ROLLBACK;`. Q1–Q6 là CỔNG (mọi câu phải 0 hàng); I1 là kiểm kê.

```sql
-- SCADA R1b-2b-1 Task 2 — CENSUS TRƯỚC (cổng dừng C12 / Q2 / điều kiện 1a). CHỈ ĐỌC: mọi câu là SELECT thuần, chạy được
-- trong một transaction read_only (BEGIN TRANSACTION READ ONLY; ... ; ROLLBACK;). Không hàm tạm, không bảng tạm, không tham số.
--
-- TẬP HỢP LỆ (8 giá trị): jsonb boolean; jsonb number đúng bằng 0 hoặc 1; jsonb string mà lower(btrim(.)) ∈ ('0','1','true','false').
--   btrim của Postgres chỉ cắt dấu cách; JS trim() cắt cả TAB / xuống dòng / NBSP ⇒ SQL BÁO DƯ (không bỏ sót) với "\ttrue".
-- Luật interlock: commandValue NULL / jsonb null ⇒ gửi `true` (giaTriLenhInterlock) ⇒ HỢP LỆ.
-- Write FOE: thiếu `value` / jsonb null ⇒ KHÔNG hợp lệ (dispatch nhận undefined/null).
--
-- LỚP ĐỊA CHỈ BIT (lop_bit), theo đúng bộ phân tích của driver:
--   modbus_coil          — protocol modbus; "coil:N" | "0x:N" | số Modicon thuần 1..9999 (modbusDecode.parseModbusAddress)
--   modbus_holding_bool  — protocol modbus; dataType bool trên holding ("holding:N" | "4x:N" | 40001..49999) — encodeModbus("bool")
--   slmp_bit             — protocol slmp; device ∈ SLMP_BIT_DEVICES (slmpEncoder.ts) — slmpDriver ghi bit khi `dev.isBit` bất kể dataType
--   mc_bit               — protocol mitsubishi-mc; device ∈ BIT_DEVICES (mcAddress.ts) hoặc "<word>.<bit>"
--   s7_bit               — protocol s7; "DB<n>,X<o>.<b>" hoặc vùng M/I/E/Q/A/PI/PQ có modifier X hoặc ".bit" (s7Address.ts) — THÊM để báo dư
--   (ethernet-ip / opcua: địa chỉ là TÊN — không suy ra bit từ địa chỉ; tag bool của chúng đã phủ ở Q1–Q3 theo dataType.)
--
-- Q1–Q6 là CỔNG (≥ 1 hàng ở bất kỳ DB nào ⇒ DỪNG). I1 chỉ là KIỂM KÊ (không phải cổng).

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Q1 (brief a) — luật interlock BẬT, action <> 'alert', đích là tag dataType bool, commandValue NGOÀI tập hợp lệ.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
SELECT r.id, r.name, r."targetAdapterId", t."tagKey", t.address, t."dataType"::text AS kieu, r."commandValue", r.action::text AS action
FROM interlock_rules r
JOIN device_tags t ON t."adapterId" = r."targetAdapterId" AND t."tagKey" = r."commandTag"
WHERE r.enabled AND r.action::text <> 'alert' AND t."dataType"::text = 'bool'
  AND NOT (
        r."commandValue" IS NULL
     OR jsonb_typeof(r."commandValue") IN ('null', 'boolean')
     OR (CASE WHEN jsonb_typeof(r."commandValue") = 'number' THEN (r."commandValue" #>> '{}')::numeric IN (0, 1) ELSE false END)
     OR (jsonb_typeof(r."commandValue") = 'string' AND lower(btrim(r."commandValue" #>> '{}')) IN ('0', '1', 'true', 'false'))
  )
ORDER BY r.id;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Q2 (brief b) — write FOE (bước `command` ở MỌI độ sâu: steps / then / else / compensation; args.writes[] hoặc args.tagKey+value)
-- lên tag dataType bool với giá trị NGOÀI tập hợp lệ. Bảng đầu (orchestration_workflows, mọi status) + lịch sử phiên bản
-- (orchestration_workflow_versions — rollback triển khai lại bản cũ). Adapter: args.adapterId (số) nếu có, ngược lại MỌI adapter
-- gắn máy của bước (báo dư so với "đúng một adapter bật" của engine).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
WITH dinh_nghia AS (
  SELECT 'orchestration_workflows'::text AS bang, w.id AS wf_id, w.ref, w.version, w.status::text AS trang_thai, w."definitionJson" AS def
  FROM orchestration_workflows w
  UNION ALL
  SELECT 'orchestration_workflow_versions'::text, v."workflowId", v.ref, v.version, NULL::text, v."definitionJson"
  FROM orchestration_workflow_versions v
), buoc AS (
  SELECT d.bang, d.wf_id, d.ref, d.version, d.trang_thai, s AS step
  FROM dinh_nghia d
  CROSS JOIN LATERAL jsonb_path_query(d.def, 'strict $.** ? (@.type == "command")') AS s
  WHERE jsonb_typeof(s) = 'object'
), ghi AS (
  SELECT b.bang, b.wf_id, b.ref, b.version, b.trang_thai, b.step ->> 'id' AS step_id,
         b.step -> 'machineId' AS machine_j, b.step -> 'args' -> 'adapterId' AS adapter_j, x.tag_key, x.gia_tri
  FROM buoc b
  CROSS JOIN LATERAL (
    SELECT e ->> 'tagKey' AS tag_key, e -> 'value' AS gia_tri
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(b.step -> 'args' -> 'writes') = 'array' THEN b.step -> 'args' -> 'writes' ELSE '[]'::jsonb END) AS e
    WHERE jsonb_typeof(e) = 'object'
    UNION ALL
    SELECT b.step -> 'args' ->> 'tagKey', b.step -> 'args' -> 'value'
    WHERE jsonb_typeof(b.step -> 'args' -> 'writes') IS DISTINCT FROM 'array' AND jsonb_typeof(b.step -> 'args' -> 'tagKey') = 'string'
  ) AS x
)
SELECT g.bang, g.wf_id, g.ref, g.version, g.trang_thai, g.step_id, a.id AS adapter_id, t."tagKey", t.address, t."dataType"::text AS kieu, g.gia_tri
FROM ghi g
JOIN device_adapters a ON (
      (jsonb_typeof(g.adapter_j) = 'number' AND a.id::numeric = CASE WHEN jsonb_typeof(g.adapter_j) = 'number' THEN (g.adapter_j #>> '{}')::numeric END)
   OR (jsonb_typeof(g.adapter_j) IS DISTINCT FROM 'number'
       AND a."machineId"::numeric = CASE WHEN jsonb_typeof(g.machine_j) = 'number' THEN (g.machine_j #>> '{}')::numeric END))
JOIN device_tags t ON t."adapterId" = a.id AND t."tagKey" = g.tag_key
WHERE t."dataType"::text = 'bool'
  AND NOT COALESCE(
        jsonb_typeof(g.gia_tri) = 'boolean'
     OR (CASE WHEN jsonb_typeof(g.gia_tri) = 'number' THEN (g.gia_tri #>> '{}')::numeric IN (0, 1) ELSE false END)
     OR (jsonb_typeof(g.gia_tri) = 'string' AND lower(btrim(g.gia_tri #>> '{}')) IN ('0', '1', 'true', 'false')),
     false)
ORDER BY g.bang, g.wf_id, g.version, g.step_id, t."tagKey";

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Q3 (brief c) — tag dataType bool có stop_value KHÔNG phải jsonb boolean (validateStopValue chuẩn hoá bool ⇒ boolean).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
SELECT t.id, t."adapterId", a.protocol::text AS giao_thuc, t."tagKey", t.address, t.stop_value, jsonb_typeof(t.stop_value) AS kieu_json,
       t.writable, t."isEnabled"
FROM device_tags t
JOIN device_adapters a ON a.id = t."adapterId"
WHERE t."dataType"::text = 'bool' AND t.stop_value IS NOT NULL AND jsonb_typeof(t.stop_value) <> 'boolean'
ORDER BY t.id;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Q4 (điều kiện 1a) — ghim STOP trên MỌI tag có địa chỉ coil / bit (mọi dataType) mà stop_value NGOÀI tập 8 giá trị.
-- (Mọi tag, kể cả writable=false / tắt: ghim cũ sẽ sống lại khi tag được bật.)
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
WITH tag_bit AS (
  SELECT t.id, t."adapterId", a.protocol::text AS giao_thuc, t."tagKey", t.address, t."dataType"::text AS kieu, t.stop_value,
         t.writable, t."isEnabled",
         CASE
           WHEN a.protocol::text = 'modbus' AND (
                  lower(btrim(t.address)) ~ '^coil:[0-9]+$'
               OR lower(btrim(t.address)) ~ '^0x:[0-9]+$'
               OR (CASE WHEN btrim(t.address) ~ '^[0-9]{1,15}$' THEN btrim(t.address)::numeric BETWEEN 1 AND 9999 ELSE false END)) THEN 'modbus_coil'
           WHEN a.protocol::text = 'modbus' AND t."dataType"::text = 'bool' AND (
                  lower(btrim(t.address)) ~ '^holding:[0-9]+$'
               OR lower(btrim(t.address)) ~ '^4x:[0-9]+$'
               OR (CASE WHEN btrim(t.address) ~ '^[0-9]{1,15}$' THEN btrim(t.address)::numeric BETWEEN 40001 AND 49999 ELSE false END)) THEN 'modbus_holding_bool'
           WHEN a.protocol::text = 'slmp'
                AND substring(upper(btrim(t.address)) FROM '^([A-Z]+)[0-9A-F]+$')
                    IN ('X', 'Y', 'M', 'L', 'F', 'V', 'B', 'SM', 'SB', 'DX', 'DY', 'S', 'TS', 'TC', 'CS', 'CC') THEN 'slmp_bit'
           WHEN a.protocol::text = 'mitsubishi-mc' AND (
                  substring(upper(btrim(t.address)) FROM '^([A-Z]+)[0-9A-F]+(\.[0-9A-F]+)?$')
                    IN ('M', 'X', 'Y', 'B', 'S', 'L', 'F', 'SM', 'SB', 'DX', 'DY', 'V', 'TS', 'TC', 'CS', 'CC')
               OR upper(btrim(t.address)) ~ '^[A-Z]+[0-9A-F]+\.[0-9A-F]+$') THEN 'mc_bit'
           WHEN a.protocol::text = 's7' AND (
                  upper(btrim(t.address)) ~ '^DB[0-9]+,X[0-9]+(\.[0-9]+)?$'
               OR upper(btrim(t.address)) ~ '^([MIEQAT C]|PI|PQ)X[0-9]+(\.[0-9]+)?$'
               OR upper(btrim(t.address)) ~ '^([MIEQAT C]|PI|PQ)[0-9]+\.[0-9]+$') THEN 's7_bit'
         END AS lop_bit
  FROM device_tags t
  JOIN device_adapters a ON a.id = t."adapterId"
)
SELECT id, "adapterId", giao_thuc, lop_bit, "tagKey", address, kieu, stop_value, jsonb_typeof(stop_value) AS kieu_json, writable, "isEnabled"
FROM tag_bit
WHERE lop_bit IS NOT NULL AND stop_value IS NOT NULL
  AND NOT (
        jsonb_typeof(stop_value) = 'boolean'
     OR (CASE WHEN jsonb_typeof(stop_value) = 'number' THEN (stop_value #>> '{}')::numeric IN (0, 1) ELSE false END)
     OR (jsonb_typeof(stop_value) = 'string' AND lower(btrim(stop_value #>> '{}')) IN ('0', '1', 'true', 'false'))
  )
ORDER BY id;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Q5 (điều kiện 1a/iii) — write FOE lên tag có địa chỉ coil / bit (MỌI dataType) với giá trị NGOÀI tập hợp lệ
-- (gồm chuỗi truthy lạ "on" / "yes" / "true " — "true " sau btrim là hợp lệ, "on" / "yes" thì không).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
WITH tag_bit AS (
  SELECT t.id, t."adapterId", a.protocol::text AS giao_thuc, t."tagKey", t.address, t."dataType"::text AS kieu,
         CASE
           WHEN a.protocol::text = 'modbus' AND (
                  lower(btrim(t.address)) ~ '^coil:[0-9]+$'
               OR lower(btrim(t.address)) ~ '^0x:[0-9]+$'
               OR (CASE WHEN btrim(t.address) ~ '^[0-9]{1,15}$' THEN btrim(t.address)::numeric BETWEEN 1 AND 9999 ELSE false END)) THEN 'modbus_coil'
           WHEN a.protocol::text = 'modbus' AND t."dataType"::text = 'bool' AND (
                  lower(btrim(t.address)) ~ '^holding:[0-9]+$'
               OR lower(btrim(t.address)) ~ '^4x:[0-9]+$'
               OR (CASE WHEN btrim(t.address) ~ '^[0-9]{1,15}$' THEN btrim(t.address)::numeric BETWEEN 40001 AND 49999 ELSE false END)) THEN 'modbus_holding_bool'
           WHEN a.protocol::text = 'slmp'
                AND substring(upper(btrim(t.address)) FROM '^([A-Z]+)[0-9A-F]+$')
                    IN ('X', 'Y', 'M', 'L', 'F', 'V', 'B', 'SM', 'SB', 'DX', 'DY', 'S', 'TS', 'TC', 'CS', 'CC') THEN 'slmp_bit'
           WHEN a.protocol::text = 'mitsubishi-mc' AND (
                  substring(upper(btrim(t.address)) FROM '^([A-Z]+)[0-9A-F]+(\.[0-9A-F]+)?$')
                    IN ('M', 'X', 'Y', 'B', 'S', 'L', 'F', 'SM', 'SB', 'DX', 'DY', 'V', 'TS', 'TC', 'CS', 'CC')
               OR upper(btrim(t.address)) ~ '^[A-Z]+[0-9A-F]+\.[0-9A-F]+$') THEN 'mc_bit'
           WHEN a.protocol::text = 's7' AND (
                  upper(btrim(t.address)) ~ '^DB[0-9]+,X[0-9]+(\.[0-9]+)?$'
               OR upper(btrim(t.address)) ~ '^([MIEQAT C]|PI|PQ)X[0-9]+(\.[0-9]+)?$'
               OR upper(btrim(t.address)) ~ '^([MIEQAT C]|PI|PQ)[0-9]+\.[0-9]+$') THEN 's7_bit'
         END AS lop_bit
  FROM device_tags t
  JOIN device_adapters a ON a.id = t."adapterId"
), dinh_nghia AS (
  SELECT 'orchestration_workflows'::text AS bang, w.id AS wf_id, w.ref, w.version, w.status::text AS trang_thai, w."definitionJson" AS def
  FROM orchestration_workflows w
  UNION ALL
  SELECT 'orchestration_workflow_versions'::text, v."workflowId", v.ref, v.version, NULL::text, v."definitionJson"
  FROM orchestration_workflow_versions v
), buoc AS (
  SELECT d.bang, d.wf_id, d.ref, d.version, d.trang_thai, s AS step
  FROM dinh_nghia d
  CROSS JOIN LATERAL jsonb_path_query(d.def, 'strict $.** ? (@.type == "command")') AS s
  WHERE jsonb_typeof(s) = 'object'
), ghi AS (
  SELECT b.bang, b.wf_id, b.ref, b.version, b.trang_thai, b.step ->> 'id' AS step_id,
         b.step -> 'machineId' AS machine_j, b.step -> 'args' -> 'adapterId' AS adapter_j, x.tag_key, x.gia_tri
  FROM buoc b
  CROSS JOIN LATERAL (
    SELECT e ->> 'tagKey' AS tag_key, e -> 'value' AS gia_tri
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(b.step -> 'args' -> 'writes') = 'array' THEN b.step -> 'args' -> 'writes' ELSE '[]'::jsonb END) AS e
    WHERE jsonb_typeof(e) = 'object'
    UNION ALL
    SELECT b.step -> 'args' ->> 'tagKey', b.step -> 'args' -> 'value'
    WHERE jsonb_typeof(b.step -> 'args' -> 'writes') IS DISTINCT FROM 'array' AND jsonb_typeof(b.step -> 'args' -> 'tagKey') = 'string'
  ) AS x
)
SELECT g.bang, g.wf_id, g.ref, g.version, g.trang_thai, g.step_id, a.id AS adapter_id, tb.giao_thuc, tb.lop_bit, tb."tagKey", tb.address, tb.kieu, g.gia_tri
FROM ghi g
JOIN device_adapters a ON (
      (jsonb_typeof(g.adapter_j) = 'number' AND a.id::numeric = CASE WHEN jsonb_typeof(g.adapter_j) = 'number' THEN (g.adapter_j #>> '{}')::numeric END)
   OR (jsonb_typeof(g.adapter_j) IS DISTINCT FROM 'number'
       AND a."machineId"::numeric = CASE WHEN jsonb_typeof(g.machine_j) = 'number' THEN (g.machine_j #>> '{}')::numeric END))
JOIN tag_bit tb ON tb."adapterId" = a.id AND tb."tagKey" = g.tag_key
WHERE tb.lop_bit IS NOT NULL
  AND NOT COALESCE(
        jsonb_typeof(g.gia_tri) = 'boolean'
     OR (CASE WHEN jsonb_typeof(g.gia_tri) = 'number' THEN (g.gia_tri #>> '{}')::numeric IN (0, 1) ELSE false END)
     OR (jsonb_typeof(g.gia_tri) = 'string' AND lower(btrim(g.gia_tri #>> '{}')) IN ('0', '1', 'true', 'false')),
     false)
ORDER BY g.bang, g.wf_id, g.version, g.step_id, tb."tagKey";

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Q6 (điều kiện 1a/iii) — luật interlock BẬT, action <> 'alert', đích là tag có địa chỉ coil / bit (MỌI dataType), commandValue
-- NGOÀI tập hợp lệ (NULL / jsonb null ⇒ true ⇒ hợp lệ).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
WITH tag_bit AS (
  SELECT t.id, t."adapterId", a.protocol::text AS giao_thuc, t."tagKey", t.address, t."dataType"::text AS kieu,
         CASE
           WHEN a.protocol::text = 'modbus' AND (
                  lower(btrim(t.address)) ~ '^coil:[0-9]+$'
               OR lower(btrim(t.address)) ~ '^0x:[0-9]+$'
               OR (CASE WHEN btrim(t.address) ~ '^[0-9]{1,15}$' THEN btrim(t.address)::numeric BETWEEN 1 AND 9999 ELSE false END)) THEN 'modbus_coil'
           WHEN a.protocol::text = 'modbus' AND t."dataType"::text = 'bool' AND (
                  lower(btrim(t.address)) ~ '^holding:[0-9]+$'
               OR lower(btrim(t.address)) ~ '^4x:[0-9]+$'
               OR (CASE WHEN btrim(t.address) ~ '^[0-9]{1,15}$' THEN btrim(t.address)::numeric BETWEEN 40001 AND 49999 ELSE false END)) THEN 'modbus_holding_bool'
           WHEN a.protocol::text = 'slmp'
                AND substring(upper(btrim(t.address)) FROM '^([A-Z]+)[0-9A-F]+$')
                    IN ('X', 'Y', 'M', 'L', 'F', 'V', 'B', 'SM', 'SB', 'DX', 'DY', 'S', 'TS', 'TC', 'CS', 'CC') THEN 'slmp_bit'
           WHEN a.protocol::text = 'mitsubishi-mc' AND (
                  substring(upper(btrim(t.address)) FROM '^([A-Z]+)[0-9A-F]+(\.[0-9A-F]+)?$')
                    IN ('M', 'X', 'Y', 'B', 'S', 'L', 'F', 'SM', 'SB', 'DX', 'DY', 'V', 'TS', 'TC', 'CS', 'CC')
               OR upper(btrim(t.address)) ~ '^[A-Z]+[0-9A-F]+\.[0-9A-F]+$') THEN 'mc_bit'
           WHEN a.protocol::text = 's7' AND (
                  upper(btrim(t.address)) ~ '^DB[0-9]+,X[0-9]+(\.[0-9]+)?$'
               OR upper(btrim(t.address)) ~ '^([MIEQAT C]|PI|PQ)X[0-9]+(\.[0-9]+)?$'
               OR upper(btrim(t.address)) ~ '^([MIEQAT C]|PI|PQ)[0-9]+\.[0-9]+$') THEN 's7_bit'
         END AS lop_bit
  FROM device_tags t
  JOIN device_adapters a ON a.id = t."adapterId"
)
SELECT r.id, r.name, r."targetAdapterId", tb.giao_thuc, tb.lop_bit, tb."tagKey", tb.address, tb.kieu, r."commandValue", r.action::text AS action
FROM interlock_rules r
JOIN tag_bit tb ON tb."adapterId" = r."targetAdapterId" AND tb."tagKey" = r."commandTag"
WHERE r.enabled AND r.action::text <> 'alert' AND tb.lop_bit IS NOT NULL
  AND NOT (
        r."commandValue" IS NULL
     OR jsonb_typeof(r."commandValue") IN ('null', 'boolean')
     OR (CASE WHEN jsonb_typeof(r."commandValue") = 'number' THEN (r."commandValue" #>> '{}')::numeric IN (0, 1) ELSE false END)
     OR (jsonb_typeof(r."commandValue") = 'string' AND lower(btrim(r."commandValue" #>> '{}')) IN ('0', '1', 'true', 'false'))
  )
ORDER BY r.id;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- I1 (KIỂM KÊ, KHÔNG phải cổng) — số ghim STOP trên tag địa chỉ coil / bit theo giao thức × lớp × dataType × kiểu json,
-- và số trong đó NGOÀI tập 8 giá trị (= Q4 gộp nhóm). Cho biết phạm vi mà luật lúc ĐẶT ghim (điều kiện 1b) sẽ chạm.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
WITH tag_bit AS (
  SELECT a.protocol::text AS giao_thuc, t."dataType"::text AS kieu, t.stop_value,
         CASE
           WHEN a.protocol::text = 'modbus' AND (
                  lower(btrim(t.address)) ~ '^coil:[0-9]+$'
               OR lower(btrim(t.address)) ~ '^0x:[0-9]+$'
               OR (CASE WHEN btrim(t.address) ~ '^[0-9]{1,15}$' THEN btrim(t.address)::numeric BETWEEN 1 AND 9999 ELSE false END)) THEN 'modbus_coil'
           WHEN a.protocol::text = 'modbus' AND t."dataType"::text = 'bool' AND (
                  lower(btrim(t.address)) ~ '^holding:[0-9]+$'
               OR lower(btrim(t.address)) ~ '^4x:[0-9]+$'
               OR (CASE WHEN btrim(t.address) ~ '^[0-9]{1,15}$' THEN btrim(t.address)::numeric BETWEEN 40001 AND 49999 ELSE false END)) THEN 'modbus_holding_bool'
           WHEN a.protocol::text = 'slmp'
                AND substring(upper(btrim(t.address)) FROM '^([A-Z]+)[0-9A-F]+$')
                    IN ('X', 'Y', 'M', 'L', 'F', 'V', 'B', 'SM', 'SB', 'DX', 'DY', 'S', 'TS', 'TC', 'CS', 'CC') THEN 'slmp_bit'
           WHEN a.protocol::text = 'mitsubishi-mc' AND (
                  substring(upper(btrim(t.address)) FROM '^([A-Z]+)[0-9A-F]+(\.[0-9A-F]+)?$')
                    IN ('M', 'X', 'Y', 'B', 'S', 'L', 'F', 'SM', 'SB', 'DX', 'DY', 'V', 'TS', 'TC', 'CS', 'CC')
               OR upper(btrim(t.address)) ~ '^[A-Z]+[0-9A-F]+\.[0-9A-F]+$') THEN 'mc_bit'
           WHEN a.protocol::text = 's7' AND (
                  upper(btrim(t.address)) ~ '^DB[0-9]+,X[0-9]+(\.[0-9]+)?$'
               OR upper(btrim(t.address)) ~ '^([MIEQAT C]|PI|PQ)X[0-9]+(\.[0-9]+)?$'
               OR upper(btrim(t.address)) ~ '^([MIEQAT C]|PI|PQ)[0-9]+\.[0-9]+$') THEN 's7_bit'
         END AS lop_bit
  FROM device_tags t
  JOIN device_adapters a ON a.id = t."adapterId"
  WHERE t.stop_value IS NOT NULL
)
SELECT giao_thuc, lop_bit, kieu, jsonb_typeof(stop_value) AS kieu_json, count(*) AS so_ghim,
       count(*) FILTER (WHERE NOT (
             jsonb_typeof(stop_value) = 'boolean'
          OR (CASE WHEN jsonb_typeof(stop_value) = 'number' THEN (stop_value #>> '{}')::numeric IN (0, 1) ELSE false END)
          OR (jsonb_typeof(stop_value) = 'string' AND lower(btrim(stop_value #>> '{}')) IN ('0', '1', 'true', 'false')))) AS ngoai_tap
FROM tag_bit
WHERE lop_bit IS NOT NULL
GROUP BY giao_thuc, lop_bit, kieu, jsonb_typeof(stop_value)
ORDER BY giao_thuc, lop_bit, kieu, kieu_json;
```
