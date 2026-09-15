# ĐIỀU PHỐI THỰC THI KẾ HOẠCH HOÀN THIỆN (chủ đợt: phiên này)

Kế hoạch: `docs/superpowers/plans/2026-09-15-hoan-thien-twin-sau-qa11.md` (19 task, 7 giai đoạn).
Uỷ quyền của chủ dự án 2026-09-15: chủ đợt **tự phân việc, tự lập agent, tự quyết kỹ thuật**;
chỉ hỏi khi **đổi kế hoạch lớn** hoặc **xoá tệp** (xoá DỮ LIỆU thì được phép).

## Ràng buộc phân đợt: XUNG ĐỘT TỆP
`client/src/pages/TwinVanHanh.tsx` bị Task 5, 6, 10, 11, 12 chạm ⇒ **không bao giờ hai agent cùng lúc**.
`client/src/pages/TwinStudio.tsx` bị Task 3, 4 chạm ⇒ cùng một agent.
`nganXuLyLogic.ts` + `NganXuLy.tsx` bị Task 9, 10, 11 chạm ⇒ cùng một agent.

## Lịch đợt
| đợt | task | agent | tệp chính | song song được? |
|---|---|---|---|---|
| **A1** | 1, 2 | HẠ-TẦNG | `drizzle/schema/hierarchy.ts`, `scripts/`, `docs/DEPLOYMENT_GUIDE.md` | ✅ với A2 |
| **A2** | 3, 4 | STUDIO | `TwinStudio.tsx`, `napStudio.ts` | ✅ với A1 |
| **B1** | 7 | MÃ-NGẮN | `DanhSachMay.tsx` | ✅ với B2 |
| **B2** | 8 | CẢNH-BÁO | `daiCanhBaoLogic.ts`, `DaiCanhBao.tsx` | ✅ với B1 |
| **C1** | 5, 6 | KPI | `TwinVanHanh.tsx`, `kpiNoiLogic.ts` | ❌ độc quyền TwinVanHanh |
| **C2** | 9, 10, 11 | NGĂN-XỬ-LÝ | `nganXuLyLogic.ts`, `NganXuLy.tsx`, `TwinVanHanh.tsx` | ❌ sau C1 |
| **C3** | 12 | SỨC-KHOẺ | `KhungCanh.tsx`, `TwinVanHanh.tsx` | ❌ sau C2 |
| **D1** | 13 | RBAC | `hierarchyRouters.ts` | ✅ với D2, và với C |
| **D2** | 14 | KHOÁ-API | `client/public/` | ✅ với D1, và với C |
| **E** | 15, 16 | NGHIỆM-THU | không sửa mã; cần môi trường đo | ❌ sau tất cả |
| **F** | 17 | THIẾT-KẾ | `docs/superpowers/specs/` | ✅ bất cứ lúc nào |
| **G** | 18, 19 | MỞ-RỘNG | sau khi chủ dự án chốt thiết kế F | ❌ |

## Luật cho mọi agent
- Cấm `git commit/push/stash/checkout/reset`. Chủ đợt commit.
- Cấm sửa `.env`, cấm bật/tắt server (giai đoạn 0-4 không cần server).
- Cấm chạm tệp ngoài danh sách của task mình.
- **Cấm XOÁ TỆP** — nếu thấy cần xoá, DỪNG và báo chủ đợt (chủ dự án giữ quyền này).
- Lưới TRƯỚC khi vá; ablation sau khi xanh; đối chứng âm phải GIỮ NGUYÊN.
- Báo cáo cuối: tệp+dòng đã sửa, mốc lưới ĐỎ→XANH, kết quả ablation, cổng nền trước/sau, "ĐIỀU TÔI KHÔNG CHẮC".

## Nhật ký

### Đợt A1 (Task 1-2) — XONG 2026-09-15T17:47:57+07:00
commit `6825b906`. Agent bác kế hoạch 5 lần, cả 5 đúng: lưới tự thoả trên tập rỗng · mốc ĐỎ không thể ở bước biên dịch (tsconfig loại trừ tệp test) · import sai barrel · trích dẫn script không tồn tại · chú thích sai sẵn ở tài liệu triển khai. Phát hiện thêm 9 cột + 37 bảng vắng schema (ghi lại, không vá). SỰ CỐ chủ đợt: backtick trong `-m` chạy đúng hai lệnh vừa cấm, vô hại nhờ may.

### Đợt B (Task 7-8) — XONG 2026-09-15T20:28:50+07:00
commit `6cd8f3ea`. Task 7: lời giải màn Chuyền MỘT MÌNH không đủ (tiền tố chung chỉ 7/19 ký tự vì danh sách trải 3 tầng × 2 xưởng) ⇒ thêm cơ chế 2 chặn cột trạng thái. Task 8: buộc chạm TwinVanHanh vì state socket phải đổi hình dạng, nếu không bản không-danh-tính thắng bản có-danh-tính ở mọi lần nạp lại. Hai lỗi kế hoạch nữa bị bác đúng (jsdom không có layout engine; vị trí tham số nuốt mất tham số cũ). Cổng: 115 tệp/2.712 xanh.

### Quyết định chủ dự án giữa chừng 2026-09-15T20:28:50+07:00
1. Vá cổng phạm vi TRƯỚC (Task 17b mới), rồi mới gộp nhiều nhà máy. 2. Vá cả hai lỗi mới trong giai đoạn này (Task 17c mới).
