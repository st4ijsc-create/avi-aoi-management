# WS1 — Hệ 3 theme toàn app (Implementation Plan)

> Thực thi qua superpowers:subagent-driven-development (implementer + review opus mỗi task). Controller tự kiểm chứng visual.

**Goal:** Biến app từ light/dark thành 3 theme chọn được (Glass/Console/Warmth), mặc định Glass, phủ cả 11 route, giữ nguyên bất biến an toàn.

**Spec:** `docs/PRODUCTION_UI_DESIGN.md` (WS1). **Nhánh:** `feat/machine-simulator`, base `50445304`.

## Global Constraints (mọi task ngầm áp)
- Chỉ `.../web/`. Không git branch/checkout. Commit qua `git -C D:/SOURCES/avi-aoi-sim`.
- **TOKENS-only, không hex thô** (giữ grep-check). Mọi màu/bóng/bo-góc/glow đọc qua biến CSS.
- **Bất biến an toàn §4 (PRODUCTION_UI_DESIGN):** màu trạng thái chỉ mang nghĩa trạng thái (không-dữ-liệu = chờ, không phải lỗi); nút an toàn không cuộn/không đổi chỗ; trang không cuộn; song ngữ (gloss EN ngoài `<label>`); tabular-nums; offline; focus rõ; `prefers-reduced-motion`.
- **axe AA 0 serious/critical trên CẢ 3 theme.** Đo, không tin mắt.
- **Ngưỡng thị giác 0.00002 — không nới, không mở mask.**
- Persona: panel-PC 10.1" 1280×800.
- E2e xanh; `12-hmi-safety-rail.spec.ts` phải xanh trên mọi theme.

## Token vocabulary hiện có (map 3 theme lên ĐÚNG các tên này, KHÔNG đổi tên)
`--color-bg` `--color-surface` `--color-text` `--color-divider` `--color-divider-strong` · `--surface-base/-subtle/-card` `--border` `--border-strong` · navy ramp `--navy-50..900` + `--color-accent` · `--text-strong` `--text-muted` `--accent-100/500/600` · status `--status-run/warn/fault/idle` (+`-text`), alias `--ok/warn/danger/neutral/info` (+`-text`) · `--radius` `--radius-card` `--radius-pill` (+ downstream `--radius-sm..4xl`). Có `@custom-variant dark (&:is([data-theme="dark"] *))`.

---

## Task 1 — Hạ tầng theme (foundation)
**Files:** `web/src/theme/ThemeToggle.tsx` (Theme type + provider), `web/src/index.css` (token blocks), `web/src/theme/chartTokens.ts` (3 biến thể), bộ chọn theme mới (topbar + Settings).

**Nội dung:**
- `Theme = "glass" | "console" | "warmth"`; provider mặc định **glass**; lưu localStorage; migrate giá trị cũ light→glass, dark→console.
- `index.css`: định nghĩa **bộ token đầy đủ cho cả 3 theme** dưới `:root[data-theme="glass|console|warmth"]` (glass cũng là `:root` mặc định). **`--radius` giờ per-theme** (glass 8px, console 6px, warmth 5px) → thêm downstream. Thêm token *hình thức theo theme*: `--elevation` (bóng/none/glow), `--glow-run`, `--panel-fill`, `--glass-blur`, `--focus`.
- Xử lý `@custom-variant dark`: map "dark" → console (đổi selector sang `[data-theme="console"]`), thêm variant `glass`/`warmth` nếu cần; ưu tiên chuyển các chỗ `dark:` sang token.
- `chartTokens.ts`: 3 bộ, chọn theo theme.
- **Bộ chọn theme:** nhóm 3 lựa chọn trong Settings (có thumbnail/xem trước mỗi theme) + chuyển nhanh trên topbar. Áp ngay, không reload. Bền vững.
- **Bảng màu (tinh từ mock `hmi-directions.html`, map lên token trên):**
  - **Glass:** bg cool off-white, surface xếp lớp, text `#1b2233`, muted `#66708a`, border `#d6dce7`, accent navy `#1e3a8a`→azure `#2f6bff`; elevation = bóng mềm; radius 8px. Status run `#1f9d57`/warn `#c68717`/fault `#d84437`/idle grey.
  - **Console:** bg `#12171f`, surface `#161d27`, text `#e9f1fb`, muted `#7f8ca4`, border `#26303f`, accent `#38d6ff` (glow); elevation = quầng sáng+bóng sâu; radius 6px. Status run `#2ee88f`/warn `#ffb63a`/fault `#ff5c52`.
  - **Warmth:** bg `#f4f1ea`, surface `#ebe7dd`, text `#26221b`, muted `#6f695c`, border `#d3ccbd`, accent navy + amber `#b0691a`; elevation = bóng vật chất; radius 5px. Status run `#3f8c4f`/warn `#bd851b`/fault `#bb3b2e`.
  - **Thang trạng thái**: tinh chỉnh để AA trên từng nền, KHÔNG đổi ý nghĩa.

**Deliverable:** app compile+build sạch; đổi được giữa 3 theme; mọi màn hiện có tự đổi theo token (chưa cần hoàn hảo signature); Glass mặc định. tsc+build sạch. `npm run test:e2e` xanh (ép 1 theme cố định cho các spec hiện có nếu cần). axe AA Dashboard+Machines trên cả 3 theme.

**Verify (controller):** tự chụp `/` và `/hmi/SCRW-01` ở cả 3 theme 1280×800, Read, xác nhận không vỡ.

## Task 2 — Signature per-theme + quét phủ 11 route
**Files:** components industrial (Sheet/Readout/StatusLamp/ControlButton…), shell, và bất cứ chỗ nào còn hex thô / hardcode light-only.

**Nội dung:** áp *chữ ký* mỗi theme (Glass: panel kính mờ + bóng mềm + bàn-sáng schematic; Console: glow phần live; Warmth: chiều sâu vật chất nút bấm). Quét từng route trong 11 route ở cả 3 theme, sửa mọi chỗ vỡ (hex thô, tương phản, `dark:` sót). Nút vật lý E-STOP đúng chất mỗi theme mà vẫn giữ bất biến an toàn.

**Deliverable:** 11 route sạch ở cả 3 theme; grep hex = 0; axe AA cả 3 theme các màn chính.

**Verify (controller):** chụp mẫu các route (dashboard, machines, detail, onboarding, product-points+BoardCanvas, HMI panel) × 3 theme, Read, xác nhận từng theme có bản sắc riêng chứ không chỉ đổi màu.

## Task 3 — Kiểm chứng + baseline đa theme
**Files:** `web/tests/` (spec + snapshots), `12-hmi-safety-rail` mở rộng.

**Nội dung:** dựng lại/ mở rộng baseline thị giác cho tập màn đại diện × 3 theme (không nhân 3 mù quáng; chọn màn rủi ro tương phản + HMI panel + BoardCanvas). Mở rộng safety-rail spec để chạy qua từng theme. axe AA 3 theme. Full e2e xanh. Ngưỡng giữ 0.00002.

**Deliverable:** e2e xanh (report pass/total); baseline 3 theme; safety-rail xanh mọi theme; axe 0 serious/critical × 3 theme.
