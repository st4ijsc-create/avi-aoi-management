# Hướng dẫn — Đưa một board PCB mới vào vận hành (commission a new PCB)

> **Đối tượng**: kỹ sư AOI/AVI, kỹ sư sản phẩm.
> **Module**: Sản phẩm & Chương trình › Onboarding (`/product-onboarding`).
> **Nguồn**: WD-1 (doc 31 Đợt D · gap UX1) — trình hướng dẫn (wizard) nối 9 điểm đến rời rạc thành MỘT hành trình liền mạch, non-linear, có thể lưu nháp và tiếp tục sau.

## 1. Bối cảnh — vì sao cần wizard

Trước đây, để cấu hình đầy đủ một board mới, kỹ sư phải tự đi qua 9–10 trang nằm rải rác ở 3 nhóm menu (tạo sản phẩm → canvas điểm đo → phát hành chương trình → panel → MSA → thư viện linh kiện → golden → mapping máy → onboarding máy) mà **không có luồng nào nối chúng lại**, cũng không có chỉ số cho biết "board này đã cấu hình bao nhiêu %". Trang **Onboarding sản phẩm** (`/product-onboarding`) gom tất cả vào một wizard: mỗi bước hoặc **nhúng thẳng** dialog sẵn có, hoặc **deep-link** sang đúng trang chuyên biệt (mở tab mới, prefill sẵn context sản phẩm), rồi quay lại wizard. Wizard KHÔNG viết lại tính năng nào — nó chỉ khâu lại.

## 2. Chín bước của hành trình

Mở `/product-onboarding` (từ nút "Onboarding" trên trang `/products`, hoặc trực tiếp). Có thể vào bằng deep-link `/product-onboarding?product=<id>&step=<key>`.

| # | Bước (`key`) | Bắt buộc | Việc cần làm | Nơi thực hiện |
|---|---|:---:|---|---|
| 0 | `product` | ✅ | Tạo mới hoặc chọn sản phẩm; upload ảnh mẫu (**bắt buộc có kích thước ảnh** để toạ độ điểm đo portable giữa các máy) | Nhúng form tạo/sửa sản phẩm |
| 1 | `fiducials` | ✅ | Khai báo fiducial mark để align board trước khi soi (tab này trước đây **mồ côi — không truy cập được**, WD-1 mount lại) | Nhúng `ProductFiducialsTab` |
| 2 | `points` | ✅ | Vẽ/nhập điểm đo (ROI). Nhanh nhất: **import centroid/pick-place CSV** (WC-1) thay vì click từng điểm | Deep-link `/products` (canvas + Centroid Import) |
| 3 | `thresholds` | ✅ | Đặt giới hạn spec LSL/USL/Target cho từng điểm. Sản phẩm `development` sửa thẳng; `active`/đã released phải qua hàng đợi duyệt (SoD) | Deep-link editor điểm đo |
| 4 | `golden` | ⬚ (tuỳ) | Chụp ảnh golden known-good, gắn theo sản phẩm (FK) | Nhúng panel golden + deep-link capture |
| 5 | `panel` | ⬚ (tuỳ) | Định nghĩa panel N-up (nếu board đi theo panel ghép) | Nhúng `PanelDefinitionPanel` |
| 6 | `release` | ✅ | Phát hành chương trình kiểm tra (workflow SoD: người request ≠ người approve). **Lưu ý: release hiện là audit-only** — provenance/checksum, không tự gate máy | Nhúng `ProgramReleasePanel` |
| 7 | `mapping` | ✅ | Ánh xạ tên điểm từ máy ↔ định nghĩa điểm đo thật (giảm tỉ lệ `__UNMAPPED__`) | Deep-link trang product-mapping, prefilled |
| 8 | `review` | ✅ | Xem điểm **completeness/readiness** (image/points/limits/golden/release/mapping…) và kết thúc | Tóm tắt readiness |

> **Điểm hoàn thiện (readiness)** được tính có trọng số: limit chiếm nhiều nhất (25), rồi image/points, component, fiducial, golden, release, mapping. VISUAL point KHÔNG bị tính vào phần trăm limit (board AOI toàn VISUAL sẽ không bị "đỏ oan"). Badge hiển thị ví dụ: `62% • còn 40 điểm thiếu limit`.

## 3. Nguyên tắc quan trọng

- **Non-linear + resumable**: có thể nhảy bước, làm dở rồi thoát; nháp lưu ở `product_onboarding_drafts`, lần sau mở lại đúng chỗ.
- **Kích thước ảnh là bắt buộc** (PM8): thiếu dims → toạ độ điểm đo là pixel thô, không chuyển được giữa máy khác độ phân giải.
- **Governance ngưỡng (SoD)**: không ai tự duyệt thay đổi limit của chính mình; sản phẩm đã `active`/đã released bắt buộc đi qua hàng đợi threshold-approval.
- **Đừng click từng điểm cho board 200 linh kiện**: dùng import centroid CSV (map cột refdes/x/y/rotation/side/package như hot-folder adapter), hoặc **clone** từ board tương tự (deep-copy points/fiducials/panel/sampling).
- **Phân loại NG cần defect code**: máy/adapter phải gửi `defectCatalogCode`; code không khớp catalog KHÔNG bị bỏ — được giữ ở `defectCodeRaw` và gom vào `unmatched_defect_codes` để curation.

---

# Guide — Commission a new PCB (English)

> **Audience**: AOI/AVI engineers, product engineers.
> **Module**: Products & Programs › Onboarding (`/product-onboarding`).

## 1. Why a wizard

Fully configuring a new board used to mean walking 9–10 pages scattered across 3 menu groups with **nothing stitching them together** and no "this board is X% configured" signal. The **Product Onboarding** page (`/product-onboarding`) gathers everything into one non-linear, resumable wizard. Each step either **embeds** the existing dialog or **deep-links** to the specialized page (new tab, product context pre-filled) and returns. It rewrites nothing — it only connects.

## 2. The nine-step journey

Open `/product-onboarding` (from the "Onboarding" button on `/products`, or directly). Deep-link supported: `/product-onboarding?product=<id>&step=<key>`.

| # | Step (`key`) | Required | What you do | Where |
|---|---|:---:|---|---|
| 0 | `product` | Yes | Create/select the product; upload the reference image (**image dimensions are mandatory** so point coordinates are portable across machines) | Embedded create/edit form |
| 1 | `fiducials` | Yes | Declare fiducial marks used to register the board before inspection (this tab was **orphaned/unreachable** before; WD-1 re-mounts it) | Embedded `ProductFiducialsTab` |
| 2 | `points` | Yes | Draw/import measurement points (ROIs). Fastest path: **import a centroid / pick-place CSV** instead of clicking each point | Deep-link `/products` (canvas + Centroid Import) |
| 3 | `thresholds` | Yes | Set LSL/USL/Target per point. `development` products edit directly; `active`/released ones go through the approval queue (SoD) | Deep-link point editor |
| 4 | `golden` | Optional | Capture known-good golden images, linked to the product (FK) | Embedded golden panel + deep-link capture |
| 5 | `panel` | Optional | Define the N-up panel (if the board runs as a panel) | Embedded `PanelDefinitionPanel` |
| 6 | `release` | Yes | Release the inspection program (SoD: requester ≠ approver). **Note: release is audit-only today** — provenance/checksum, it does not gate machines by itself | Embedded `ProgramReleasePanel` |
| 7 | `mapping` | Yes | Map machine-emitted point names ↔ real point defs (drives down the `__UNMAPPED__` rate) | Deep-link product-mapping, prefilled |
| 8 | `review` | Yes | Read the **completeness/readiness** score and finish | Readiness summary |

> **Readiness** is weighted: limits weigh the most (25), then image/points, component, fiducial, golden, release, mapping. VISUAL points are excluded from the limit percentage (an all-VISUAL AOI board is not penalized). The badge reads e.g. `62% • 40 points missing limits`.

## 3. Key rules

- **Non-linear + resumable**: jump between steps, leave mid-way; the draft is saved in `product_onboarding_drafts` and reopens where you left off.
- **Image dimensions are mandatory** (PM8): without dims, point coordinates are raw pixels and are not portable across resolutions.
- **Threshold governance (SoD)**: nobody self-approves their own limit change; `active`/released products must go through the threshold-approval queue.
- **Do not hand-click a 200-part board**: import a centroid CSV (map refdes/x/y/rotation/side/package columns like a hot-folder adapter), or **clone** a similar board (deep-copies points/fiducials/panel/sampling).
- **NG classification needs a defect code**: the machine/adapter must send `defectCatalogCode`; codes that do not match the catalog are NOT dropped — they are kept in `defectCodeRaw` and rolled up into `unmatched_defect_codes` for curation.

## 4. See also

- `howto-measurement-point-shapes.md` — ROI shapes and coordinate modes.
- `aoi-thresholds.md` — spec-limit / threshold governance.
- `aoi-defect-types.md` — defect catalog (IPC-A-610).
- Playbook `create-measurement-point.playbook.yaml` — single-point create + set-limits (HITL).
