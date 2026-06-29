# 10 — Frontend Role & UX Audit (theo cấp độ người dùng)

| | |
|---|---|
| **Mã doc** | 10_FRONTEND_ROLE_UX_AUDIT |
| **Ngày** | 2026-06-29 |
| **Trạng thái** | 🟡 **AUDIT — CHỜ DUYỆT remediation.** Chưa sửa UI. |
| **Phạm vi** | Đánh giá frontend (`client/src/`) theo 7 vai trò: admin, supervisor, quality_inspector, operator, maintenance, viewer, user. Mức tương thích · linh hoạt · trải nghiệm. |

---

## 1. Tóm tắt điều hành

Kiến trúc phân-quyền **nền tảng rất chắc**: role-landing, lọc nav theo role+permission, RouteGuard cho deep-link, permission fine-grained (canView/Create/Edit/Delete/Export), admin bypass nhất quán. **Nhưng độ hoàn thiện UX KHÔNG đều giữa các vai trò**:
- ✅ **Xuất sắc:** `operator` (kiosk big-button), `maintenance` (Technician Copilot RCA).
- ✅ **Tốt:** `quality_inspector` (QualityHome).
- ⚠️ **Yếu:** `supervisor` (chưa có home riêng đúng nghĩa), `viewer`/`user` (rơi về trang marketing, read-only không hiển thị trực quan), `admin` (đủ quyền nhưng thiếu trang tổng quan quản trị).

**Điểm trừ xuyên suốt:** read-only chưa được *enforce trực quan* (nút Edit/Delete vẫn hiện rồi mới bị backend chặn); gating nút write chưa nhất quán; chưa cảnh báo permission sắp hết hạn; tablet bị ép dùng nav mobile.

---

## 2. Bảng đánh giá theo vai trò

| Vai trò | Landing | Phạm vi nav | Home riêng | Mô hình gác | Mức phù hợp | Khoảng trống lớn nhất |
|---|---|---|---|---|---|---|
| **admin** | `/dashboard` | Toàn bộ 10 nhóm | Dashboard chung | Admin bypass | ✅ Tốt | Thiếu **admin briefing** (sức khoẻ hệ thống, hoạt động user, audit, license) |
| **operator** | `/operator` | AI + Production + Monitoring (một phần) | ✅ OperatorHome (kiosk) | Permission + RouteGuard | ✅ Xuất sắc | Thiếu hướng dẫn xử lý sự cố tại chỗ; spinner khi AI phân loại |
| **maintenance** | `/technician-copilot` | AI + Monitoring + Alerts | ✅ TechnicianCopilot | Permission + RouteGuard | ✅ Xuất sắc | RCA Copilot **chôn** trong nhóm AI; work-orders nằm ở Monitoring → cần **nhóm Maintenance riêng** |
| **quality_inspector** | `/quality-home` | Quality + Analytics + Production (một phần) | ✅ QualityHome | Permission | ✅ Tốt | Thiếu workflow **duyệt/từ chối NG**; thiếu cài ngưỡng auto |
| **supervisor** | `/management-insight` | Corporate + Production + Dashboard/Analytics (một phần) | ⚠️ Mới (NL Q&A) / rơi về Dashboard | Permission (`dashboard_corporate` read) | ⚠️ Trung bình | **Chưa có supervisor briefing** (team status, hàng đợi escalation, KPI rollup) |
| **viewer** | `/` → `/dashboard` | Dashboard + Reports (read) | ❌ Trang marketing | Permission; read-only do backend | ⚠️ Yếu | **Chưa có home read-only**; chưa có badge "Chỉ xem"; nút write vẫn hiện |
| **user** | `/` | Tối thiểu (Settings) | ❌ Trang marketing | Permission fallback | ⚠️ Tối thiểu | Không có lối **xin nâng quyền**; không gợi ý làm được gì |

---

## 3. Phát hiện xuyên suốt (cross-cutting)

**Tốt:**
- Login → `landingPathForRole()` đưa thẳng về trang theo role; floor-role (operator/maintenance) tự redirect khỏi marketing (có `?stay=1`).
- `usePermissions` cache 60s, admin skip query, lookup O(1).
- i18n vi/en/zh phủ rộng (nav, lỗi, tour, RouteGuard). Theme light/dark + persist. DashboardLayoutEditor (widget kéo-thả). AdvancedSection (progressive disclosure). FirstRunTour theo role.
- Kiosk: `useKioskMode()` `?kiosk=1` ẩn sidebar/header, fullscreen; touch target operator ≥96px.

**Cần cải thiện:**
- **Read-only không trực quan:** dựa hoàn toàn vào permission đúng cấu hình; nếu set sai (canEdit=true cho viewer) thì không có lớp chặn UI. Nút write không bị disable đồng bộ.
- **Gating nút write không nhất quán** giữa các trang CRUD.
- **Permission hết hạn**: có check `expiresAt` nhưng **không cảnh báo** trên UI.
- **Thu hồi quyền realtime**: trễ tới 60s (cache).
- **Tablet**: breakpoint 768px → iPad bị ép hamburger dù đủ chỗ cho sidebar.
- **Admin truy cập trang role thấp** không được audit ở UI.
- **Marketing Home** là fallback cho viewer/user — không có chủ đích.

---

## 4. Kế hoạch remediation (đề xuất, theo ưu tiên)

### Tier 1 — Rõ vai trò (ROI cao)
- [ ] **U1. Supervisor briefing** `/supervisor-home`: team status + hàng đợi escalation + KPI rollup (theo khuôn OperatorHome/QualityHome). Cập nhật `roleLanding` cho supervisor/manager.
- [ ] **U2. Read-only enforce trực quan**: hook/HOC `useReadOnly()` + component `<PermissionGate action>` tự disable/ẩn nút + badge "Chỉ xem" khi thiếu canEdit/canDelete. Áp cho corporate + các trang CRUD.
- [ ] **U3. Viewer home** `/viewer-home`: dashboard read-only gọn (KPI + báo cáo), thay vì rơi về marketing.
- [ ] **U4. Nhóm "Maintenance Workspace"** trong nav: gom Technician Copilot + Work Orders + Alerts (tương tự nhóm "AI Assistant" của operator).

### Tier 2 — Khả dụng & truy cập
- [ ] **U5. Admin dashboard** `/admin-home`: sức khoẻ hệ thống, đăng nhập gần đây, cấp quyền, license, uptime.
- [ ] **U6. Cảnh báo permission sắp hết hạn** (banner header).
- [ ] **U7. Sidebar mặc định theo role** (operator hẹp/đơn giản, analyst đầy đủ).
- [ ] **U8. Cài đặt thông báo theo role** (snooze cho operator trong ca, high-priority-only).

### Tier 3 — Nâng cao
- [ ] **U9. Tablet breakpoint** 1024px / "tablet mode" (giữ sidebar trên iPad).
- [ ] **U10. Quality: workflow duyệt/từ chối NG** + cài ngưỡng auto-accept/reject; nổi annotation lên QualityHome.
- [ ] **U11. "Bắt đầu với mẫu dashboard theo role"** (dialog gợi ý layout, bỏ qua được).
- [ ] **U12. Lối xin nâng quyền** trong Settings (gửi admin).
- [ ] **U13. Gating nút write nhất quán** — audit toàn bộ trang CRUD, chặn trước khi render.

### Tier 4 — Nhất quán & edge case
- [ ] **U14. AdvancedSection** áp cho trang dày (SPC/Reports/Correlation).
- [ ] **U15. Audit chuỗi i18n** — flag key chưa dịch trong CI.
- [ ] **U16. Offline degrade** cho operator khi mất MQTT/backend (hàng đợi + sync).
- [ ] **U17. FirstRunTour** kích hoạt lại khi đổi role / sau phiên dài.

---

## 5. Cách dùng
Khi bạn duyệt, ưu tiên Tier 1 (U1–U4) — tác động rõ nhất tới sự rõ ràng vai trò + giảm rủi ro read-only. Mỗi mục là 1 commit nhỏ (flag/route/nav/i18n như chuẩn dự án). Tick checklist + ghi commit khi làm.

## 6. Changelog
| Ngày | Mục | Commit | Ghi chú |
|---|---|---|---|
| 2026-06-29 | — | — | Tạo doc 10 (audit, chờ duyệt remediation) |
