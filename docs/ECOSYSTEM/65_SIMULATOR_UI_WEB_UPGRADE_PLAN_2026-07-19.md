# Doc 65 — Kế hoạch Audit + Nâng cấp UI Simulator lên Web chuyên nghiệp (trắng/navy)

> **Bản kế hoạch (CHỜ DUYỆT)** cho việc đại tu giao diện của ST4I Machine Simulator (doc 62) từ
> WPF dark hand-styled → **web app chuyên nghiệp trên đúng design-system của hệ sinh thái**
> (React 19 + Vite + Tailwind 4 + shadcn/ui + framer-motion + Recharts), **hệ màu trắng chủ đạo +
> navy phụ**, đóng gói **Tauri 2** thành desktop app chạy offline.
>
> Ngày: 2026-07-19 · Nối tiếp doc 62 (simulator/edge-middleware). **Hội tụ với doc 66** (kế hoạch
> middleware thương mại) — UI này CHÍNH LÀ shell của "Machine Edition".
>
> Cơ sở quyết định (người dùng chốt): (1) dựng lại bằng WEB stack SYNAPSE + Tauri; (2) hệ màu
> trắng/navy; (3) viết kế hoạch trước, chờ duyệt rồi build.

---

## 1. Audit UI hiện tại (WPF — đã kiểm chứng LIVE, có ảnh chụp thật)

Đánh giá từ 7 màn hình đã render thật (Dashboard, Machine-detail automation + AOI, API Inspector,
Onboarding, Settings, Scenario) và bản chạy no-args.

**Điểm mạnh (GIỮ lại về mặt chức năng/IA):**
- Thông tin đầy đủ, luồng đúng: fleet tiles + KPI (ONLINE/TỔNG CHU KỲ/FPY), machine-detail có
  SPC/telemetry/board-bbox + config-sync + cycle log, **API Inspector stream request/response** (điểm
  nhấn), onboarding wizard, scenario presets, song ngữ vi/en, Live/Demo/Auto.
- Dữ liệu **thật** (đã bắn 201/202 vào server, doc "live-verify"). IA hợp lý.

**Điểm yếu (nguyên nhân "thô/lẫn lộn khó chịu"):**
| # | Vấn đề | Biểu hiện |
|---|---|---|
| A | **Hệ màu tối + tương phản lẫn lộn** | nền `#0B0F14`, panel phẳng gần cùng tông, accent cyan chói; thiếu tầng sáng/tối rõ ràng |
| B | **Phân cấp thị giác yếu** | tile/panel cùng độ nổi, tiêu đề–nội dung–meta không tách bằng type-scale/khoảng cách nhất quán |
| C | **Control WPF mặc định** | ComboBox/Button/DataGrid nguyên bản Windows, bo góc/không có state hover/focus tinh tế |
| D | **Bảng & tile generic** | DataGrid thô, tile chỉ text; không có empty-state, skeleton, badge chuẩn hoá |
| E | **Không chuyển động** | không transition/micro-interaction → cảm giác "tĩnh, thô" |
| F | **Chart chưa nhất quán** | LiveCharts đẹp nhưng màu/typography không đồng bộ design-system |
| G | **Không đồng bộ hệ sinh thái** | khác hoàn toàn design-system web SYNAPSE (mà bạn đã có sẵn, rất đẹp) |

**Kết luận audit:** đây là vấn đề **design-system + nền tảng**, không phải thiếu tính năng. Giải
pháp không phải "thêm màu" mà là **dựng lại trên một design-system web hoàn chỉnh** — thứ Playwright
audit được và đồng bộ hệ sinh thái.

> Ghi chú công cụ: WPF **không** Playwright-audit được (Playwright dành cho browser). Sau khi chuyển
> web, toàn bộ audit UX/a11y/visual-regression bằng Playwright + axe mới áp dụng được (§7) — đúng
> yêu cầu "dùng plugin design + Playwright để audit".

---

## 2. Ngôn ngữ thiết kế — TRẮNG chủ đạo + NAVY phụ (giải quyết #1)

**Nguyên tắc:** nền **trắng/xám rất nhạt** làm chủ đạo (không gian thở, sạch, "chuyên nghiệp"),
**navy** làm màu thương hiệu + primary action + biểu đồ, một **accent** cho nhấn, và bộ **status**
bán dẫn. Hỗ trợ light (mặc định) + dark (tùy chọn) qua CSS variables.

### 2.1 Bảng màu (token — Tailwind `@theme` / CSS vars)
```
/* Nền & bề mặt (trắng chủ đạo) */
--surface-base      #FFFFFF   (nền trang)
--surface-subtle    #F8FAFC   (nền phụ, section)
--surface-muted     #F1F5F9   (hover/zebra)
--surface-card      #FFFFFF   + border + shadow-sm
--border            #E2E8F0
--border-strong     #CBD5E1

/* Navy — thương hiệu + primary + phụ chủ đạo */
--navy-900 #0B1B34   --navy-800 #10254A   --navy-700 #163561
--navy-600 #1E3A8A   (primary)            --navy-500 #2749A8
--navy-100 #E8EEF9   (nền nhạt primary)   --navy-050 #F4F7FC

/* Text */
--text-strong  #0B1B34 (navy-900)  --text-body #334155  --text-muted #64748B

/* Accent (nhấn/CTA phụ) — chọn 1: teal đồng bộ) */
--accent-500 #0E9AA7   --accent-600 #0B7E89   --accent-100 #E2F5F6

/* Status (bán dẫn) */
--ok #16A34A  --warn #D97706  --danger #DC2626  --info #2563EB  --neutral #94A3B8
/* Chart series: navy-600, accent-500, #7C3AED, #16A34A, #D97706, #64748B */
```
> Đây là **placeholder palette** kiểu design-system-agnostic (theo skill dataviz/frontend-design):
> navy = brand, còn lại là scale trung tính + status. Có thể tinh chỉnh sắc navy theo nhận diện ST4I.

### 2.2 Token phi-màu
- **Typography:** Inter (hoặc font hệ sinh thái). Scale: 12/13/14(body)/16/18/20/24/30/36; weight
  400/500/600/700; line-height chuẩn; số liệu dùng `tabular-nums`.
- **Spacing:** thang 4px (2/4/8/12/16/24/32/48). **Radius:** 8px (card 12px, pill 999px).
- **Shadow:** `sm` (card), `md` (popover/dialog), `lg` (command palette). Viền 1px `--border`.
- **Motion (framer-motion):** enter 150–200ms ease-out; layout 200ms; list stagger 30ms; hover
  scale 1.01. Tôn trọng `prefers-reduced-motion`.

---

## 3. Nền tảng công nghệ (ĐỒNG BỘ hệ sinh thái)

Dùng **đúng stack `client/` của avi-aoi-management** (đã xác nhận): **React 19 · Vite 7 · Tailwind
CSS 4 · shadcn/ui (Radix) · lucide-react · Recharts · framer-motion · @tanstack/react-query · wouter
· CVA + tailwind-merge**. Đóng gói **Tauri 2** (desktop shell offline) — đúng ADR SYNAPSE.

**Tái dùng tối đa:** hệ sinh thái đã có `client/src/components/ui/*` (shadcn: accordion, alert,
avatar, badge, breadcrumb, button-group…). Simulator web dùng **cùng bộ primitive + cùng theme
tokens** ⇒ nhìn "một nhà", và có thể **trích thành package UI dùng chung** (`@st4i/ui`) cho cả
platform lẫn Machine-Edition.

**Cấu trúc đề xuất** (monorepo-friendly):
```
apps/machine-sim-web/        # Vite app (UI simulator/Machine-Edition)
  src/ shell/ views/ components/ lib/ theme/ (white-navy tokens)
  src-tauri/                 # Tauri 2 wrapper -> desktop EXE offline
packages/ui/                 # (tùy) shadcn primitives dùng chung platform + edition
```

---

## 4. Kiến trúc thông tin + màn hình (redesign 1-đối-1)

Giữ IA đã proven, nâng chất lượng thị giác. Mỗi màn có empty-state, skeleton loading, toast, motion.

| Màn | Nâng cấp web |
|---|---|
| **Shell** | sidebar trắng + active-state navy, top-bar mảnh (mode Live/Demo/Auto = segmented control, Start/Stop = primary navy, badge DEMO-FALLBACK), **⌘K command palette** (như platform), avatar/branding |
| **Dashboard** | lưới **card** máy (shadow-sm, status-dot, driver chip, pass-rate ring, **sparkline Recharts**), hàng KPI dạng stat-tile (ONLINE/FPY/throughput), skeleton khi load, motion stagger |
| **Machine detail** | tab (Overview/SPC/Telemetry/Board/Config/Log); **SPC I-MR** + histogram Recharts theo series navy/accent; **BoardView** vẽ bbox defect trên canvas responsive (đỏ NG/hổ phách NTF/xanh OK) + tooltip; config-sync panel; cycle-log = TanStack Table |
| **API Inspector** ★ | **live stream** đẹp: virtualized table, badge status (2xx xanh/4xx-5xx đỏ/queued hổ phách), chip Mode, filter (máy/loại/status), Pause/Clear/Export, đếm dòng theo filter, row mới trượt vào (motion) |
| **Onboarding** | wizard stepper (Radix) register→approve→claim/enroll; paste mk_; load fleet; trạng thái từng bước rõ ràng |
| **Settings** | form chuẩn (server URL/TLS/mode/probe cờ), quản lý khóa, ngôn ngữ, kiosk/attract; probe kết quả dạng badge |
| **Scenario** | slider (Radix) defect/fault/cycle + preset cards + Burst; **hiển thị hiệu ứng** (defect-rate ↑ thấy NG tăng trong Inspector) |

**Pattern hệ thống:** design tokens một nguồn; state (loading/empty/error) nhất quán; a11y (focus
ring, aria, contrast AA); dark-mode qua `data-theme`.

---

## 5. Ranh giới UI ↔ Engine

UI web **không** đụng phần cứng/transport. Engine (doc 66: Go/Rust; giai đoạn quá độ có thể là
EdgeCore C#) chạy **local**, expose **HTTP + WebSocket API** (`/v1/fleet`, `/v1/machines/:id`,
`/v1/inspector/stream` (WS), `/v1/scenario`, `/v1/settings`, `/v1/onboarding`). Trong Tauri: engine
là **sidecar process**; UI gọi qua `localhost` + WS. Điều này cũng cho phép **cùng UI** phục vụ
Machine/Line/Site (chỉ đổi endpoint engine).

---

## 6. Đóng gói — Tauri 2 (offline, đúng "cắm-chạy triển lãm")

- `tauri build` → **1 EXE desktop** (Windows) nhúng WebView2, nhẹ hơn Electron nhiều, chạy **offline**
  (giữ tính chất triển lãm của bản WPF). Engine sidecar đi kèm.
- Vẫn hỗ trợ **chạy trình duyệt** (dev/demo) trỏ vào engine local.
- Đây chính là **shell Machine-Edition** (doc 66 §Deploy) — một artifact, hai vai trò.

---

## 7. Audit & kiểm thử bằng Playwright (yêu cầu #2)

- **Playwright** (đã có MCP): kịch bản E2E mỗi màn (open→start fleet→assert tiles/inspector),
  **visual regression** (screenshot baseline mỗi màn, so pixel), điều hướng ⌘K, i18n vi↔en.
- **axe-core** (a11y): contrast AA, aria, focus order.
- **Design lint:** chỉ dùng token (không hex rời), kiểm consistency spacing/type.
- CI chạy Playwright + axe mỗi PR → "đẹp và đúng" có bằng chứng, không cảm tính.

---

## 8. Chiến lược chuyển đổi (không phá giá trị đã có)

- **Contracts + IA + 7 màn của bản WPF = ĐẶC TẢ ĐÃ PROVEN** (đã chạy live). Web rebuild = "port"
  từng màn theo spec đó ⇒ rủi ro thấp, biết chính xác cần gì.
- EdgeCore C# (94 test) tiếp tục là **oracle/hợp đồng tham chiếu** trong lúc engine Go/Rust hình
  thành (doc 66): web UI có thể trỏ tạm vào EdgeCore C# (bọc HTTP) để chạy sớm, rồi chuyển sang
  engine Go/Rust khi sẵn — UI không đổi.

---

## 9. Lộ trình & khối lượng (đề xuất)

| Giai đoạn | Nội dung | Kết quả |
|---|---|---|
| **U0 Design-system** | tokens trắng/navy + Tailwind theme + trích/nhận shadcn từ platform + Storybook cơ bản | bảng màu #1 xong, primitive sẵn |
| **U1 Shell + Dashboard** | Vite app + Tauri scaffold + shell + dashboard live (WS tới engine) | mở app thấy dashboard đẹp, chạy fleet |
| **U2 Inspector + Machine-detail** | API Inspector stream + machine-detail (SPC/telemetry/board) | 2 màn nặng nhất |
| **U3 Onboarding + Settings + Scenario** | 3 màn còn lại + i18n + dark-mode | đủ 7 màn |
| **U4 Tauri package + Playwright + a11y** | đóng EXE offline + bộ test Playwright/axe + visual baseline | deliverable + audit tự động |

Cờ/đổi mượt: mỗi giai đoạn có build + Playwright xanh; giữ bản WPF chạy song song đến khi web đạt
tương đương rồi thay.

---

## 10. Tiêu chí hoàn thành (DoD — Plan 1)
1. Hệ màu **trắng chủ đạo + navy** áp toàn app qua tokens (0 hex rời); light + dark.
2. 7 màn web đạt/hoặc vượt IA bản WPF, có empty/skeleton/toast/motion.
3. Đóng gói **Tauri EXE offline** chạy được máy sạch; vẫn chạy được trình duyệt.
4. **Playwright E2E + visual-regression + axe** xanh cho cả 7 màn.
5. Dùng chung primitive/tokens với platform (đồng bộ hệ sinh thái); sẵn sàng làm shell Machine-Edition (doc 66).

---

*Doc 65 · Kế hoạch UI web upgrade (trắng/navy, React/Tailwind/shadcn/Tauri) · CHỜ DUYỆT · hội tụ doc 66 · 2026-07-19.*
