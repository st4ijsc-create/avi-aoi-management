---
trang_thai: nhap
---

# Nháp thẻ vận hành — hàng chờ duyệt

Sinh bởi `scripts/ai-kb/build-operational-drafts.mjs`. Thư mục này là **hàng chờ**, không phải kho.

## Trạng thái hiện tại (2026-08-17)

**Rỗng.** 20 thẻ nháp sinh ngày 2026-08-17 đã được **chủ dự án duyệt** và chuyển sang
`knowledge/operational-approved/` (`trang_thai: da_duyet`, có `nguoi_duyet` + `ngay_duyet`).

Thư mục rỗng ở đây là trạng thái **đúng**, không phải lỗi — xem phần "ba hàng rào" bên dưới.

## ⚠️ Thư mục này KHÔNG nằm trong chỉ mục tri thức

`build-knowledge-chunks.mjs` quét `docs/`, `apidocs/`, `knowledge/domain`, `knowledge/features`,
`knowledge/operational`, **`knowledge/operational-approved`**, `knowledge/workflows`. Không có
đường nào tới `knowledge/drafts` ⇒ nháp **không có chunk, không có vector, trợ lý không trích dẫn
được**.

## Duyệt xong thì làm gì

1. Điền hoặc xoá mọi ô ⬜ (bỏ trống thành thật vẫn tốt hơn điền bừa — nhưng khi vào chỉ mục thì
   ô trống phải đọc thành *"chưa được ghi lại"*, không phải mệnh lệnh cho người duyệt).
2. `trang_thai: nhap` → `trang_thai: da_duyet`, thêm `nguoi_duyet` + `ngay_duyet`.
3. Chuyển sang **`knowledge/operational-approved/`**.
4. `npm run kb:chunk && npm run kb:embed:inc`.
5. `node scripts/ai-kb/buildPlaybookChunks.test.mjs` — cổng phải XANH và phải **đỏ** nếu bước 3 bị
   bỏ sót.

### ⚠⚠ ĐÍNH CHÍNH — bản README trước hướng dẫn SAI ở bước 3

Bản trước viết:

> Chuyển sang `knowledge/operational/` — ⚠ lưu ý `npm run kb:operational-cards` SINH LẠI thư mục đó
> và sẽ GHI ĐÈ file trùng tên. **Đổi tên (vd `<slug>-vanhanh.md`)** để tránh bị ghi đè.

**Đổi tên KHÔNG cứu được file.** `scripts/ai-kb/build-operational-cards.mjs:217` chạy

```js
fs.rmSync(OUT_DIR, { recursive: true, force: true });   // OUT_DIR = knowledge/operational
```

⇒ nó **xoá sạch CẢ THƯ MỤC** trước khi ghi, bất kể tên file. Làm theo lời khuyên cũ thì một lượt
`npm run kb:sync` là mất trắng toàn bộ thẻ người duyệt, và mất **im lặng** (chunker vẫn chạy xanh,
chỉ là kho ít đi vài chục chunk).

Đó là lý do có thư mục **riêng** `knowledge/operational-approved/`: cùng `sourceType: "operational"`
(⇒ cùng trọng số 1,15, cùng đường deep-link) nhưng **khác vòng đời ghi** — không script nào xoá nó.

## Ba hàng rào nay phát biểu gì

| # | Hàng rào | Trước 2026-08-17 | Nay |
|---|---|---|---|
| 1 | Đường quét của chunker | `knowledge/drafts` không có trong đường quét | vẫn không có; **thêm** `knowledge/operational-approved` |
| 2 | Front-matter | mọi nháp khai `trang_thai: nhap` | nháp khai `nhap`; thẻ đã duyệt khai `da_duyet` + người/ngày duyệt |
| 3 | Cổng test `buildPlaybookChunks.test.mjs` | "phải CÓ nháp trên đĩa, và nháp ⇒ 0 chunk" | "**nháp CÓ THỂ rỗng**; nhưng MỌI thẻ đã duyệt PHẢI có mặt trong chỉ mục đúng `sourceType`, và KHÔNG chunk nào trong chỉ mục đến từ file còn khai `nhap`" |

Điều kiện tiên quyết chống-xanh-rỗng được **DỜI**, không **XOÁ**: nửa "cấm" nay được phép vacuous,
nửa "khẳng định" (thẻ duyệt có mặt đủ) gánh vai trò bảo đảm cổng còn thật sự đo một cái gì.
