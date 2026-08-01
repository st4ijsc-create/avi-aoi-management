# Giai đoạn 1 — "Máy độc lập bán được" — Kế hoạch tổng (Master Plan)

> **For agentic workers:** REQUIRED SUB-SKILL — mỗi workstream (WS) dưới đây được dựng thành 1 kế hoạch TDD chi tiết riêng ngay trước khi thực thi (đọc mã nguồn thật để viết test-code chính xác), rồi thực thi bằng `superpowers:subagent-driven-development` (fresh subagent mỗi task + review giữa các task). Đây là kế hoạch **tổng** để chủ đầu tư duyệt trước.

**Goal:** Biến St4i Machine Simulator thành một sản phẩm máy **chạy độc lập hoàn chỉnh** — khách mua 1 máy, không hệ sinh thái, vẫn giữ được dữ liệu sản xuất bền, có OEE + báo cáo, có đăng nhập/phân quyền/audit, và cài đặt như một sản phẩm thật.

**Architecture:** Giữ .NET/C# (quyết định #1). Thêm một **tầng lưu trữ bền trừu tượng hoá** (`IHistorianStore`, hiện thực SQLite — quyết định #5) mà EdgeCore/EngineApi ghi vào; thêm **auth/RBAC/audit** cho EngineApi; đóng gói **MSI/MSIX + Windows Service**. Không đụng seam `IDeviceDriver/Normalizer/ITransport` (bảo toàn ~360 test). Giữ nguyên `capabilities`/feature-flag seam để Giai đoạn 3 gắn license không phải sửa kiến trúc.

**Tech Stack:** .NET 10, C#, ASP.NET minimal-API, `Microsoft.Data.Sqlite` (+ Dapper hoặc EF Core — chốt ở blueprint WS-A), React 19/Vite (UI hiện có), xUnit + Playwright. Installer: WiX v4 (MSI) hoặc MSIX; Service: `Microsoft.Extensions.Hosting.WindowsServices`.

## Global Constraints (áp dụng cho MỌI task)
- **Không viết lại Go/Rust** — tất cả bằng .NET/C# (QĐ #1).
- **CSDL = SQLite** sau một interface (`IHistorianStore`/`IAuditStore`…) để nâng PostgreSQL/Timescale sau (QĐ #5). Không hardcode SQLite ngoài lớp hiện thực.
- **Không phá tương thích ST4I hiện tại** (LiveTransport/config-sync giữ nguyên hành vi wire) (QĐ #3).
- **Ranh giới an toàn (XC-R40):** phần mềm là lớp giám sát; không đường ghi safety; mọi tính năng mới không được tạo đường lệnh vòng qua safety-PLC.
- **TDD bắt buộc** (`superpowers:test-driven-development`): test đỏ → code → test xanh → commit; commit nhỏ, thường xuyên.
- **Giữ i18n vi/en + 3 theme + design system** cho mọi màn UI mới.
- **Offline-first:** mọi tính năng Giai đoạn 1 phải chạy đúng khi không có mạng/không hệ sinh thái.
- **License/Edition KHÔNG làm ở giai đoạn này** (QĐ #4) — chỉ giữ seam `capabilities`.

---

## Phân rã & trình tự (dependency-ordered)

```
WS-A  Historian & Báo cáo & OEE      ── nền tảng (tầng lưu trữ bền dùng chung)
   └─► WS-D  Bảo mật cục bộ (auth/RBAC/audit)   (audit tái dùng tầng lưu trữ WS-A)
WS-C  Store-and-forward bền           ── độc lập, có thể song song WS-A
WS-F1 Đóng gói (MSI/MSIX + Service)   ── SAU CÙNG (đóng gói sản phẩm đã xong tính năng)
```

**Lý do trình tự:** WS-A dựng `IHistorianStore` (SQLite) — WS-D audit dùng lại nó, nên WS-A đi trước. WS-C nhỏ & gần như độc lập (chỉ chạm cấu hình transport/DI) → làm song song hoặc xen kẽ. WS-F1 đóng gói cuối cùng khi tính năng đã ổn định.

---

## WS-A — Historian, OEE & Báo cáo *(nền tảng, giá trị standalone lớn nhất)*

**Vấn đề giải quyết:** dữ liệu run hiện chỉ ở RAM (~200 chu kỳ/máy, mất khi restart) → không truy xuất, không OEE lịch sử, không báo cáo. *(GAP-A)*

**Phạm vi & file dự kiến** *(xác nhận chính xác ở blueprint)*:
- Create: `src/St4i.EdgeCore/Historian/IHistorianStore.cs` (interface: append result/inspection/telemetry/cycle; query theo máy/thời gian/serial; tính OEE).
- Create: `src/St4i.EdgeCore/Historian/SqliteHistorianStore.cs` (schema + migration + retention/tiering; write-behind hàng đợi để không chặn pipeline).
- Modify: nơi phát `EdgePipeline.Committed` / `MachineState` cập nhật → ghi vào historian (song song với ring-buffer RAM hiện có, không thay thế UI realtime).
- Create: `src/St4i.EngineApi/Endpoints/HistorianEndpoints.cs` (`GET /v1/historian/results?machine=&from=&to=`, `/oee`, `/serial/{id}`, `/export.csv`, `/report`).
- Create: `src/St4i.EdgeCore/Metrics/OeeCalculator.cs` (OEE = Availability × Performance × Quality + six-big-losses).
- Create (web): màn `web/src/routes/Historian.tsx`, `Reports.tsx` + nav + i18n keys; nút xuất CSV/PDF; tra cứu theo serial (genealogy cục bộ).
- Test: `tests/St4i.EdgeCore.Tests/Historian/*`, `tests/St4i.EngineApi.Tests/HistorianEndpoints*`, Playwright spec cho 2 màn mới.

**Phạm vi dữ liệu (QĐ #7):** GĐ1 lưu **automation results tổng quát** (cycle / result / telemetry) cho MỌI máy trong fleet ở mức generic envelope. **KHÔNG** dựng schema/màn inspection AOI chi tiết (per-point measurements) ở GĐ1 — để phase sau. Vẫn dùng `IHistorianStore` đủ tổng quát để mở rộng cho inspection AOI về sau không phải sửa kiến trúc.

**Deliverables:** historian SQLite bền; OEE lịch sử + FPY; API truy vấn; 2 màn web (Historian, Reports); xuất CSV/PDF; tra cứu theo serial/lô (automation) + retention cấu hình được.

**Tiêu chí nghiệm thu:** chạy 1 ca có dữ liệu → **restart app → dữ liệu + OEE vẫn còn**; truy vấn theo khoảng thời gian & serial trả đúng; xuất CSV/PDF mở được; toàn bộ chạy **offline**; ~360 test cũ vẫn xanh + test mới xanh.

**Ước lượng:** L (lớn — subsystem nền tảng).

---

## WS-C — Store-and-forward bền (đĩa) *(nhỏ, độc lập)*

**Vấn đề:** WAL bền của SDK tồn tại nhưng luôn được khởi tạo `queuePath: null` → chỉ đệm RAM, mất khi restart. *(GAP-B2)*

**Phạm vi & file:**
- Modify: `src/St4i.EngineApi/Program.cs` (~59–64), `TransportCoordinator.cs` (~88), `EdgeWorker.cs` — truyền `queuePath` thật (thư mục dưới `%ProgramData%\ST4I\...\wal`) khi khởi tạo `St4iDeviceClient`/LiveTransport.
- Create: cấu hình `WalOptions` (đường dẫn, dung lượng, TTL ≥24h) + expose trong Settings.
- Test: smoke "mất mạng → xếp hàng ra đĩa → restart → replay đúng thứ tự, không trùng (idempotency), cờ historical" (dùng fake HTTP handler như `LiveTransportTests`).

**Deliverables:** đệm ra đĩa ≥24h; replay theo thứ tự khi khôi phục; cờ historical cho dữ liệu trễ.

**Tiêu chí nghiệm thu:** kịch bản "Mất mạng demo" + restart → dữ liệu không mất, gửi lại đúng thứ tự khi có mạng; test smoke xanh.

**Ước lượng:** S (nhỏ — chủ yếu wiring + test).

---

## WS-D — Bảo mật cục bộ: Auth + RBAC + Audit *(độc lập; audit dùng lại WS-A)*

**Vấn đề:** EngineApi chạy HTTP không xác thực; không có quản lý người dùng/RBAC; trường `by` trong audit là free-text; chưa có nhật ký kiểm toán bền. *(GAP-D1–D3)*

**Phạm vi & file:**
- Create: `src/St4i.EngineApi/Auth/*` — đăng nhập cục bộ (user store trên SQLite, hash mật khẩu), phát hành phiên/token; middleware `UseAuthentication`/`UseAuthorization`.
- Create: RBAC roles (Operator/Engineer/Admin) + policy attribute cho endpoint nhạy cảm (đổi config, mode, onboarding).
- Create: `IAuditStore` + `SqliteAuditStore` (hash-chain, append-only, WORM-ish) — **tái dùng tầng lưu trữ WS-A**; ghi "ai/lúc nào/làm gì/giá trị cũ→mới" cho mọi hành động cấu hình/điều khiển.
- Modify: `Program.cs` — bật auth; **loopback-guard** (mặc định chỉ nghe localhost) + tuỳ chọn HTTPS khi mở LAN; đặt `verifyTls` **mặc định bật** (bỏ mặc định accept-any-cert).
- Create (web): màn Login, User management, Audit log viewer + i18n.
- Test: xUnit cho auth/authz/hash-chain toàn vẹn; Playwright cho login + phân quyền.

**Deliverables:** đăng nhập + RBAC + audit hash-chain bền; API không còn ẩn danh; verifyTls an toàn mặc định.

**Tiêu chí nghiệm thu:** không đăng nhập → 401; sai quyền → 403; mọi thay đổi config/điều khiển ghi audit truy vết được "ai làm gì"; chuỗi hash phát hiện sửa đổi; **`/security-review` pass**.

**Ước lượng:** M–L.

---

## WS-F1 — Đóng gói sản phẩm: Installer + Windows Service *(sau cùng)*

**Vấn đề:** cài = copy folder + double-click; EdgeService là console hardcode DemoTransport; không auto-start/service. *(GAP-F2–F3)*

**Phạm vi & file:**
- Create: `packaging/installer/` — WiX v4 MSI (hoặc MSIX) đóng gói `publish-desktop/` (shell + engine + wwwroot + fleet/mapping), tạo shortcut, auto-start tuỳ chọn, gỡ sạch.
- Modify: `src/St4i.EdgeService` — `UseWindowsService()`, cài/gỡ service, chọn transport qua cấu hình (không hardcode Demo), ghi log ra `%ProgramData%`.
- Create: script `sc create`/đăng ký service trong installer; nền cho auto-update (đặt cấu trúc, bản cập nhật đầy đủ để Giai đoạn 3).
- Test: cài trên máy sạch (VM) → chạy được, service khởi động, gỡ sạch; đo thời gian cài.

**Deliverables:** 1 file cài (MSI/MSIX) cài ≤30 phút; Windows Service chạy nền; gỡ sạch.

**Tiêu chí nghiệm thu:** cài trên máy Windows sạch **≤30 phút**, app chạy, service tự khởi động, offline; gỡ không để lại rác.

**Ước lượng:** M.

---

## Nghiệm thu tổng Giai đoạn 1
Khớp "nghiệm thu GĐ1" trong báo cáo: **cài ≤30 phút; chạy 1 ca không mạng, restart vẫn còn dữ liệu + OEE + báo cáo xuất được; đăng nhập phân quyền + audit "ai làm gì".** Toàn bộ test cũ + mới xanh; `/code-review` + `/security-review` pass.

## Phân công AI Agent (khi thực thi từng WS)
| Bước | Agent |
|---|---|
| Blueprint chi tiết mỗi WS (đọc code thật) | `feature-dev:code-architect` |
| Hiện thực .NET theo TDD | `general-purpose` + `superpowers:test-driven-development` (subagent-driven, review giữa task) |
| Màn web mới | `frontend-design` + `general-purpose` |
| Rà soát bảo mật (sau WS-D) | `/security-review` |
| Review trước merge mỗi WS | `/code-review` |

## Quyết định đã chốt (26/07/2026)
- **Q7 Vision/AOI:** GĐ1 tập trung **automation results tổng quát**; chi tiết inspection AOI để phase sau.
- **Trình tự:** WS-A → (WS-C ‖ WS-D) → WS-F1 — đã duyệt, bắt đầu WS-A.
- **Cách thực thi:** Subagent-driven + review giữa các task.
