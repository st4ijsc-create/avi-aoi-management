# F12 — Nhãn giao diện thôi lọt tiếng Việt sang en/zh

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Người dùng chọn tiếng Anh hoặc tiếng Trung thôi đọc nhãn tiếng Việt trên giao diện.

**Architecture:** Hai nhánh độc lập. (a) 533 lời gọi `t(key, "…tiếng Việt…")` mà khoá **vắng ở cả ba** locale — `defaultValue` luôn thắng nên mọi ngôn ngữ đọc tiếng Việt; sửa bằng cách **thêm khoá** vào vi/en/zh. (b) 610 chuỗi tiếng Việt **trần** không qua `t()` — không có khoá nào để tra; sửa bằng cách **bọc `t()`** rồi thêm khoá. Cả hai đều đã có cổng canh: nhánh (a) do `npm run i18n:check` sẵn có (nền 817, trần không tự ghi được), nhánh (b) do `client/src/lib/viStringCoverage.unit.test.ts` (ngân sách 610).

**Tech Stack:** React 19 · react-i18next · vitest

## Global Constraints

- **Chi phí thật nằm ở BẢN DỊCH, không ở mã.** ~1143 mục × 2 ngôn ngữ = ~2286 câu en + zh. Dịch sai nghĩa còn tệ hơn để nguyên tiếng Việt — người dùng en/zh ít nhất còn đoán được đây là chuỗi chưa dịch, chứ một câu tiếng Anh SAI thì họ tin.
- **Bám thuật ngữ đã có.** Trước khi dịch một khoá, tra các khoá anh em trong cùng namespace. Ví dụ đã chốt: `entity.machine`=设备 (không phải 机台) · `AXI (Kiểm tra X-quang)`→`AXI (X-ray Inspection)`/`AXI（X射线检测）`. Lệch thuật ngữ giữa hai khoá cùng cụm là một lỗi, dù mỗi câu đọc riêng đều đúng.
- **KHÔNG đổi câu tiếng Việt đang có.** `vi` lấy nguyên `defaultValue`/chuỗi trần hiện tại. Đợt này chỉ THÊM en/zh và chuyển chỗ, không viết lại nội dung.
- **Ba cổng phải xanh sau mỗi lô:** `npm run i18n:check` · `viStringCoverage.unit.test.ts` · `npx vitest run client/src`.
- Hạ ngân sách `ALLOWED_RAW_VI_STRINGS` sau mỗi lô nhánh (b). **Không bao giờ nâng.**
- **KHÔNG `git add -A` / `git add -u`** — cây làm việc có nhiều việc dở của người khác (`knowledge/*`, `tools/machine-simulator/*`, ảnh `.png`).
- Kiểm kiểu: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`. Lỗi tiền tồn tại bỏ qua: `client/src/pages/SessionManagement.tsx:194`.

## Số đo tại `e4532027`

| Nhánh | Số | File | Cổng canh |
|---|---:|---:|---|
| (a) `t(key,"vi")` khoá vắng cả ba locale | 533 | 64 | `i18n:check` (nền 817) |
| (b) chuỗi tiếng Việt trần | 610 | 47 | `viStringCoverage` (ngân sách 610) |

Tự đo lại đầu mỗi task — số sẽ đổi khi các lô trước hạ dần.

---

## Task 1 — Nhánh (a) lô 1: 15 file nặng nhất

**Files:** 15 file `.tsx`/`.ts` nhiều lời gọi `t(key,"vi")` khoá-vắng nhất · `client/src/i18n/locales/{vi,en,zh}.json`

- [ ] **Step 1: Sinh danh sách** — script quét `t("key", "…")` có chữ Việt, đối chiếu ba file locale, xếp theo số chỗ mỗi file. Ghi bảng vào report TRƯỚC khi sửa.
- [ ] **Step 2: Với mỗi khoá** — thêm vào `vi.json` đúng `defaultValue` hiện có; dịch sang `en.json`/`zh.json`. **Tra khoá anh em cùng namespace trước khi chọn từ.**
- [ ] **Step 3:** giữ nguyên lời gọi `t(key, "default")` — `defaultValue` ở lại làm lưới an toàn, đúng khuôn 3951 chỗ đang lành.
- [ ] **Step 4:** chạy `npm run i18n:check` — số "missing-in-all" phải GIẢM đúng bằng số khoá vừa thêm. Nếu không giảm đúng, dừng và báo lại: nghĩa là khoá bạn thêm không phải khoá mã đang tham chiếu.
- [ ] **Step 5:** chạy `viStringCoverage` + `vitest run client/src` + tsc. Commit lô.

## Task 2 — Nhánh (a) lô 2: 15 file tiếp

- [ ] Lặp đúng Task 1 cho 15 file tiếp theo.

## Task 3 — Nhánh (a) lô 3: phần còn lại (~34 file)

- [ ] Lặp đúng Task 1. Sau lô cuối, số "missing-in-all" trong `i18n:check` phải giảm **533** so với `e4532027`.
- [ ] **Hạ nền:** chạy `node scripts/i18n-check.mjs --update-baseline`, rồi **hạ hai con số trong `scripts/i18n-baseline-tran.json`** cho khớp. ⚠ File trần đó `--update-baseline` KHÔNG ghi được — phải sửa tay, và đó là chủ ý.

## Task 4 — Nhánh (b) lô 1: 12 file nhiều chuỗi trần nhất

**Files:** 12 file `.tsx` · ba file locale

- [ ] **Step 1: Sinh danh sách** — dùng chính hàm `demChuoiTran()` trong `viStringCoverage.unit.test.ts` (đừng viết bộ quét thứ hai; lệch nhau là ngân sách không bao giờ về 0 được).
- [ ] **Step 2:** với mỗi chuỗi — đặt khoá theo namespace của màn (`<man>.<vung>.<ten>`), chuyển sang `t("khoa", "…tiếng Việt nguyên văn…")`, thêm đủ ba locale.
- [ ] **Step 3:** ⚠ **Chuỗi có nội suy** (`{bien}` trong JSX) phải thành tham số i18n (`t("khoa", { bien })`), KHÔNG nối chuỗi. Nối chuỗi làm câu không dịch được sang ngôn ngữ có trật tự từ khác.
- [ ] **Step 4:** hạ `ALLOWED_RAW_VI_STRINGS` xuống đúng số mới. Chạy ba cổng + tsc. Commit lô.

## Task 5 — Nhánh (b) lô 2: 12 file tiếp

- [ ] Lặp đúng Task 4.

## Task 6 — Nhánh (b) lô 3: phần còn lại (~23 file), hạ ngân sách về 0

- [ ] Lặp đúng Task 4. Lô cuối hạ `ALLOWED_RAW_VI_STRINGS = 0`.
- [ ] **Chứng minh cổng vẫn đỏ được** ở mức 0: tiêm một chuỗi trần, xác nhận đỏ, hoàn nguyên.

## Task 7 — Nghiệm thu bằng mắt

- [ ] Rebuild + restart `:3000` (`pwsh scripts/redeploy.ps1`).
- [ ] Đổi ngôn ngữ sang **en**, chụp: menu chính · một màn vận hành · một màn cài đặt · một hộp thoại có lỗi.
- [ ] Lặp với **zh**.
- [ ] Đối chiếu với 14 ảnh của lượt kiểm mắt trước (`.superpowers/sdd/2026-07-30-*/`) — các nhãn từng lọt tiếng Việt ("Thay đổi kỹ thuật (ECN)", "Xưởng kỹ thuật", "Chỉ huy nhà máy", "Trung tâm bảo trì", "Bảo trì (CMMS)", "Vật tư đã dùng") phải hết.
- [ ] ⚠ Cổng tĩnh chứng minh khoá TỒN TẠI, không chứng minh câu ghép ra **đọc được**. Bước này là bước duy nhất chứng minh điều đó.

---

## Self-Review

**Spec coverage:** nhánh (a) → Task 1-3 · nhánh (b) → Task 4-6 · nghiệm thu → Task 7.

**Rủi ro lớn nhất:** chất lượng bản dịch en/zh. Cổng chỉ chứng minh khoá **có mặt**, không chứng minh nó **đúng nghĩa**. Vì vậy Task 7 là bắt buộc, và chủ dự án nên rà lại một mẫu — đặc biệt thuật ngữ chuyên ngành (AOI/SPI/AXI/SMT, tên công đoạn, tên vai trò).

**Điểm cần review chú ý:** Task 3 bước hạ nền — `i18n-baseline-tran.json` phải sửa TAY và đó là chủ ý; ai đó "tiện tay" cho `--update-baseline` ghi nó là gỡ mất cầu chì của cả cơ chế.
