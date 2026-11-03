# 01 · Quy ước chung cho mọi module

Áp dụng cho mã **mới và mã được di trú**. Mã cũ chưa di trú không bắt buộc, nhưng mỗi đợt di trú phải đưa phần chạm tới về đúng quy ước.

## 1. Đặt tên

| Đối tượng | Quy ước | Ví dụ | Ghi chú |
|---|---|---|---|
| Bảng | `snake_case`, số ít, tiếng Anh | `asset`, `signal_sample`, `event` | Hiện trạng: 100 % snake_case nhưng số nhiều lẫn số ít, 8–14 bảng tiếng Việt `[đo]` |
| Cột | `snake_case` | `site_id`, `created_at` | Hiện trạng 68 % camelCase `[đo]`; bảng mới bắt buộc snake_case; bảng cũ đổi khi di trú |
| Khoá chính | `id bigint generated always as identity` | | `serial` chỉ giữ ở bảng cũ |
| Khoá ngoại | `<bảng>_id`, **luôn khai FK** với `ON DELETE` tường minh | `line_id … REFERENCES line(id) ON DELETE RESTRICT` | Hiện trạng ~50 % FK chỉ có trong SQL `[đo]` |
| Mã nghiệp vụ | `code varchar(50)`, unique theo phạm vi cha, chỉ `[A-Z0-9-_]` | `LINE-03` | Không dùng code làm FK (hiện `factories.corporateCode` là FK theo code `[đo]`) |
| Cờ xoá mềm | `deleted_at timestamptz NULL` | | Thay `isActive boolean`; unique partial `WHERE deleted_at IS NULL` |
| Thời gian | **`timestamptz`** cho mọi cột thời gian | `ts`, `created_at`, `updated_at` | Hiện trạng 87 % naive `[đo]`; gốc lỗi −7 h |
| Enum | `varchar` + kiểm ở app (Zod), **không** `pg enum` mới | `kind varchar(20)` | 174 pg enum hiện có `[đo]` làm ALTER TYPE tốn kém |
| JSON | `jsonb`, có Zod schema trong `shared/` | `attributes jsonb` | Mỗi cột jsonb phải có schema tên trong TechDocs |
| Router tRPC | `<module>.<thựcThể>.<hànhĐộng>` | `hierarchy.site.list` | Hành động: `list / get / create / update / archive / restore / tree` |
| Procedure | 5 loại: `public`, `protected`, `permission(key, action)`, `actuation(level)`, `admin` | | Thay >20 loại hiện có `[đo]` |
| Route FE | tiếng Việt không dấu, số ít, phân cấp theo vùng | `/tai-san`, `/giam-sat/may/:id` | Route cũ giữ `Redirect` ≥ 1 chu kỳ phát hành |
| Tệp FE | `pages/<vung>/<Man>.tsx` ≤ 600 dòng; thân tab tách `*Tab.tsx` | `pages/du-lieu-chu/TaiSan.tsx` | Hiện trạng 223 trang phẳng, 15 trang > 2 000 dòng `[đo]` |
| i18n | namespace theo vùng: `chung`, `giamSat`, `sanXuat`, `duLieuChu`, `kyThuat`, `thoCa`, `phanTich`, `quanTri` | `t("duLieuChu.taiSan.tieuDe")` | Cấm mặc định tiếng Việt inline trong `t()` |

## 2. Tenant và phạm vi

- **Một khoá tenant: `site_id int`** (= `factories.id` hiện tại). Mọi bảng nghiệp vụ có `site_id NOT NULL` (trừ bảng cấp enterprise và bảng hệ thống).
- `corporate_code`, `factory_code` chép cứng (53 + 12 cột `[đo]`) chỉ còn ở hypertable vì lý do hiệu năng, **phải dẫn xuất từ asset lúc ghi**, không nhập tay.
- Phạm vi người xem phân giải **ở một chỗ**: `server/db/hierarchy.ts::idsTrongPhamVi` (đã có). Mọi câu truy vấn theo phạm vi gọi hàm này; không chép chuỗi JOIN.
- Ý nghĩa giá trị trả về giữ nguyên: `null` = toàn quyền (không thêm cổng); `[]` = rỗng (trả 0 hàng, UI nói "tài khoản chưa được gán phạm vi").
- RLS: phủ mọi bảng có `site_id`, `FORCE ROW LEVEL SECURITY`, policy đọc `current_setting('app.site_ids')`; app chỉ kết nối bằng `avi_app`. Owner `aoi` chỉ để migration.

## 3. Thời gian và chuỗi thời gian

- Ghi bằng `timestamptz`, trả về ISO 8601 có offset; FE định dạng theo múi giờ của `site.timezone`.
- Hypertable: cột partition `ts timestamptz`; nén sau 7 ngày (telemetry) / 30 ngày (kết quả kiểm tra); retention theo hợp đồng và **không áp lên bảng audit**.
- Mọi mẫu dữ liệu sống mang `quality` (`good | bad | uncertain`) và `ts` nguồn; tuổi dữ liệu = `now() − ts` tính ở client từ `serverNow`.

## 4. Quyền

- Vai (8) → `permission_set`; bảng `permissions` theo người chỉ là ngoại lệ (`[QĐ-Q?]` chờ duyệt cùng 90-platform).
- Khoá quyền: `<miền>_<hànhĐộng>`; mỗi màn và mỗi procedure ghi rõ khoá trong TechDocs.
- Admin **không** bypass `permission` ở procedure `actuation` (RBAC_SCOPED_ADMIN, đã bật).
- Fail-closed: tập quyền rỗng ⇒ ẩn mục nav, procedure trả `FORBIDDEN`, không trả rỗng giả.

## 5. Audit

- Mọi mutation nghiệp vụ ghi `audit_trail` (WORM): `actor_kind (user | ai | system | machine)`, `actor_id`, `action`, `target_kind`, `target_id`, `site_id`, `before`, `after`, `correlation_id`, `ts`.
- Hành động của AI có `actor_kind = 'ai'` và `proposal_id`; người duyệt ghi riêng một dòng `approve`.

## 6. Mẫu đặc tả bảng

```
### <tên_bảng>
Mục đích: …
| Cột | Kiểu | Null | Mặc định | Ràng buộc | Ghi chú |
Index: …
RLS: có/không, policy …
Retention/nén: …
Nguồn ghi: (procedure/job nào được ghi)
```

## 7. Mẫu đặc tả procedure

```
### <module>.<thựcThể>.<hànhĐộng>
Loại: public | protected | permission(key, action) | actuation(level) | admin
Input (Zod): …
Output: …
Phạm vi: áp idsTrongPhamVi theo cấp …
Audit: có/không, action = …
Sự kiện phát: socket/bus …
Lỗi: mã lỗi và điều kiện
```

## 8. Mẫu đặc tả màn hình

```
### <Tên màn> — <route>
Vùng: … · Quyền: … · ISA-101 cấp: (nếu Giám sát)
Mục đích (một câu):
Bố cục: (vỏ chung + PageHeader + thân; tab nếu có)
Dữ liệu: procedure nào, tần suất, socket nào
Trạng thái: đang tải / rỗng / lỗi / phạm vi rỗng / dữ liệu cũ / mô phỏng
Hành động: nút nào → procedure nào → cần quyền/2FA mức nào
Thay cho: trang cũ nào (route cũ → redirect)
i18n namespace:
Nghiệm thu: (tiêu chí đo được)
```

## 9. Ràng buộc đã duyệt (không được vi phạm)

1. Interlock thiếu dữ liệu thì chặn; đọc giá trị sống (D2, D11).
2. Chưa khai kênh chế độ = LOCAL; lệnh request→confirm TTL 60 s; 2FA theo mức (D3–D5).
3. Di động không gửi lệnh (D7).
4. Gỡ REST v1 lệnh; che phải quét REST + tRPC + import động (D8).
5. Ghi thật chỉ khi có safety PLC; twin/mô phỏng không là hệ an toàn (D9).
6. ISA-101: xám sáng, màu chỉ bất thường, hình + số + chữ, không xanh lá cho bình thường, ≥ 11 px, tương phản ≥ 4,5:1 (D6).
7. Dữ liệu cũ tím gạch thắng màu cảnh báo; uncertain viền chấm xám; thiếu tag fault = "không có tín hiệu" (D10).
8. Hoạt ảnh trung thực; STOP chỉ hiện khi xác nhận; nhãn poll/mô phỏng/cũ luôn thấy.
9. Chế độ tối sau pha 1 SCADA.
10. Mô phỏng chỉ kỹ sư + admin, server kiểm, không trộn tag, không ghi KPI, nút lệnh khoá.
11. Không đổi poll 5 s; SLO < 300 ms chỉ tầng nóng; socket cần 2 cờ; chỉ chủ dự án sửa `.env`.
12. Pha 1 SCADA UI = L2 + L3; không chen trước hàng A2.
13. Không cổng phụ nào che nút DỪNG.
14. `/twin` xem ≠ `/twin-studio` sửa; 3 màn 3 canvas; URL phân cấp.
15. Không xoá `MachineCockpit`, `RobotCockpit`.
16. Một lối vào một href; quyền rỗng thì ẩn; nhúng mảnh cũ = nhận nợ tenant của nó.
17. AI chạm thiết bị theo hướng năng lượng, fail-closed; `AI_OT_CONTROL_ENABLED` tắt; không đo bằng admin.
18. Đúng hơn nhanh; đổi model = 3 khoá `.env`; một llama-server 64k.
19. Seed sai thì sửa seed; canh bất biến; báo trước khi xoá/seed lại.
20. Xoá tệp hoặc đổi kế hoạch hoàn toàn phải hỏi chủ dự án.
21. Chỉ dieu-phoi gộp/push; SQL duyệt trước, áp `--test-only` trước; test không dùng owner `aoi`; census đủ + `check:tests`.
22. Không thêm `socket.join` / `io.emit` mới; phòng `robot:{id}` chặn gương robot.
23. OIP chỉ tham khảo: census tag và chấm ST theo hành vi.

## 10. Nghiệm thu một đợt

Một đợt được coi là xong khi **đủ cả bốn**:

1. Số đo ra khớp mục "Nghiệm thu" của TechDocs (ghi vào Nhật ký module).
2. `tsc` 0 lỗi; census đủ (~88 tệp) + `check:tests` xanh; đột biến bắt buộc cho hàm an toàn.
3. Route/procedure cũ còn `Redirect`/alias hoặc đã hết chu kỳ và được gỡ theo danh sách duyệt.
4. Bằng chứng LIVE cho phần người dùng thấy (Playwright screenshot hoặc LCP/element-attribution), không nhận lời khai.
