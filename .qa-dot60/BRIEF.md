# Đợt 60 — KHẢO SÁT (không sửa, không xoá): mọi trang dùng canvas 3D và mọi trang trùng vai trò với Twin 3D

Bạn là agent KHẢO SÁT — worktree `D:/SOURCES/_twin_wt`, nhánh `feat/twin-3d-trung-tam`. KHÔNG làm trong `D:/SOURCES/avi-aoi-management` (phiên khác).

★★★ **ĐỢT NÀY KHÔNG XOÁ, KHÔNG SỬA MỘT DÒNG MÃ SẢN PHẨM NÀO.** Chủ sở hữu muốn *xem xét* bỏ bớt; việc xoá cần họ duyệt từng món sau khi đọc bảng của bạn. Bạn chỉ **đo và đề xuất**. Ghi vào `.qa-dot60/`, commit đúng thư mục đó bằng pathspec.

## 0. Cây
- HEAD kỳ vọng `af7460a0` hoặc + N commit `docs(...)` (G121); khác ⇒ `.qa-dot60/00-head-XONG.txt` + DỪNG.
- Cổng riêng **3060** nếu cần chạy (cấm 3000/3001/3008/5173/8080/3047…3059). **3001 (PID 14228) / 3008 (PID 29676) là server chủ dự án đang xem — KHÔNG kill, KHÔNG rebuild `dist/`.**
- DB dev chỉ ĐỌC; hàng tạm `trap` nếu bắt buộc. 5 ảnh `test-results/` giữ md5. `.qa-dot47/` 103 tệp 0 byte — không đụng. Không `cmd > "$f"` (G130). Mỗi bước `.qa-dot60/<bước>-XONG.txt`; không im lặng > 10′.

## 1. Kiểm kê — mọi nơi có canvas 3D trong `client/`
Ứng viên đã grep sơ bộ (xác minh lại, đừng tin danh sách này — G83): `components/Factory3DScene.tsx` · `components/FactoryFloor3D.tsx` · `components/factory-scene/{FactoryScene3D,machineMesh}.tsx` · `components/twin/ArticulatedRobot.tsx` · `components/measurement-point-canvas/MeasurementPointCanvas.tsx` · `components/orchestration/WorkflowGraphCanvas.tsx` · `components/programming/{IrGraphCanvas,PouCanvas}.tsx` · các trang `CommandCenter` · `DigitalTwinCenter` · `MachineCockpit` · `RobotCockpit` · `ProductModels` · `CorporateLayout` · `FactoryCommandView` · `FactoryFloorEditor` · `FactoryLiveMap3D` · và 4 trang Twin mới (`TwinVanHanh`, `TwinLine`, `TwinMay`, `TwinStudio`).

**Phân biệt rõ: canvas 3D (three.js/WebGL) vs canvas 2D/đồ thị** — `WorkflowGraphCanvas`, `IrGraphCanvas`, `PouCanvas`, `MeasurementPointCanvas` có thể chỉ là canvas 2D; đo bằng import thật (`from "three"`, `@react-three/*`, `getContext("webgl")`), đừng đoán theo tên.

## 2. Với MỖI trang/thành phần, đo và ghi thành một hàng bảng
| cột | cách đo |
|---|---|
| route thật | `client/src/App.tsx` (hoặc nơi khai route) — đường dẫn, có `lazy` không |
| **lối vào của người dùng** | nav/menu (`lib/apps.ts`, `navHref`, sidebar), link trong trang khác, redirect trỏ tới; **0 lối vào = trang chết** |
| quyền cổng | `requirePermission`/`hasAccessToItem` nào |
| ai import | `grep -rn "<TênComponent"` + import; đếm **số chỗ gọi sống** (không tính test) |
| test phụ thuộc | unit/e2e nào tham chiếu (tên tệp + số ca) |
| dữ liệu/tính năng **riêng** | thứ trang đó làm được mà 3 màn Twin + Studio **không** làm được (ví dụ `usdExport`, biên tập bố cục, telemetry robot khớp nối…) — nêu `file:line` của chỗ gọi duy nhất nếu có |
| trùng vai trò với | `/twin` · `/twin/line/:id` · `/twin/may/:id` · `/twin-studio` hay không; trùng ở mức nào |
| lần sửa cuối | `git log -1 --date=short` |

## 3. Phân loại + đề xuất (không thực thi)
- **(A) Trùng hẳn vai trò, 0 tính năng riêng** ⇒ đề xuất **xoá** hoặc **redirect 301 sang màn Twin tương ứng**; nêu rõ mất gì, ai đang link tới.
- **(B) Có tính năng riêng chưa có ở Twin** ⇒ đề xuất **di trú tính năng ấy vào Twin rồi mới bỏ**; ước lượng khối lượng.
- **(C) Trang chết (0 lối vào, 0 chỗ gọi sống)** ⇒ đề xuất xoá, kèm bằng chứng 0 tham chiếu.
- **(D) Giữ** — không phải 3D, hoặc phục vụ nghiệp vụ khác hẳn.
Với mỗi món ở (A)/(C): liệt kê **đủ danh sách tệp sẽ xoá** (trang, component chỉ nó dùng, test, i18n key, route, mục nav) để chủ sở hữu duyệt một lần là đủ.

## 4. Ràng buộc lịch sử cần kiểm lại chứ đừng kế thừa
Sổ dự án ghi "⛔ KHÔNG XOÁ: `MachineCockpit` (MachineWorkspace nhúng) · `RobotCockpit` (đích di trú, `nganXuLyLogic` trỏ vào) · `DigitalTwinCenter` (giữ chỗ gọi `usdExport` duy nhất) · `TwinHub` (0 tham chiếu twin3d)". **Đo lại từng câu ấy hôm nay** — chúng viết từ Đợt 5–20, có thể đã hết hạn (bài học "lý do hoãn có hạn sử dụng"). Nếu vẫn đúng, ghi bằng chứng; nếu sai, nói thẳng.

## 5. Rủi ro khi bỏ — đo, đừng đoán
Với mỗi đề xuất xoá: (a) route đó có trong **26 redirect cũ** đang được lưới D-1 kiểm không? (b) có e2e/unit nào sẽ đỏ? (c) `lib/apps.ts`/nav có mục nào thành href chết (G67: href lạ ⇒ `hasAccessToItem` false ⇒ chặn im lặng **mọi người**)? (d) có i18n key nào thành mồ côi?

## 6. Báo cáo `.qa-dot60/BAO-CAO.md`
1 bảng kiểm kê đầy đủ (mục 2) · 2 phân loại A/B/C/D với danh sách tệp · 3 kiểm lại 4 câu "⛔ không xoá" · 4 rủi ro từng món · 5 **thứ tự đề xuất thực hiện** (an toàn trước, rẻ trước) · 6 brief này sai ở đâu (đếm) · 7 những gì bạn KHÔNG đo được và vì sao.
Kết thúc bằng **một danh sách ngắn để chủ sở hữu tick**: mỗi dòng = một món + hành động đề xuất (xoá / redirect / di trú / giữ) + một câu lý do có số.
