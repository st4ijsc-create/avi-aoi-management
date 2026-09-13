# Đợt 61 — XOÁ 6 trang 3D đã chết + mục nav `/digital-twin` + tab 3D của CommandCenter (CHỦ SỞ HỮU ĐÃ DUYỆT — QĐ-31)

Bạn là agent XÂY — worktree `D:/SOURCES/_twin_wt`, nhánh `feat/twin-3d-trung-tam`. KHÔNG làm trong `D:/SOURCES/avi-aoi-management` (phiên khác).

**Cơ sở:** khảo sát Đợt 60 (`.qa-dot60/BAO-CAO.md`). Chủ sở hữu duyệt **QĐ-31**: xoá cả 6 món chết, bỏ riêng tab 3D của `CommandCenter`, **giữ nguyên `/factory-command`**, và i18n mồ côi để **Đợt 62** dọn một lượt (sau khi `DigitalTwinCenter` được di trú rồi xoá).

## 0. Cây + an toàn khi xoá
- HEAD kỳ vọng `518434af` hoặc + N commit `docs(...)` (G121); khác ⇒ `.qa-dot61/00-head-XONG.txt` + DỪNG.
- Cổng riêng **3061** (cấm 3000/3001/3008/5173/8080/3047…3060). **3001 (PID 14228) / 3008 (PID 29676) là server chủ dự án đang xem — KHÔNG kill; KHÔNG rebuild `dist/` trừ khi mục 4 yêu cầu (khi đó chỉ build vào outDir riêng).**
- **Xoá bằng `git rm`** (tệp tracked) để còn trong lịch sử; **ghi trước** `.qa-dot61/TRUOC-KHI-XOA.txt`: đường dẫn + số dòng + md5 từng tệp. KHÔNG `rm -rf`, không đụng `.qa-*`, không `reset/checkout -f/stash`.
- DB dev chỉ đọc. 5 ảnh `test-results/` giữ md5. `.qa-dot47/` 103 tệp 0 byte — không đụng. Không `cmd > "$f"` (G130).
- Commit **theo từng nhóm** bằng pathspec; mỗi bước `.qa-dot61/<bước>-XONG.txt`; không im lặng > 10′.

## 1. Xoá 6 món chết (đo lại "đã chết" TRƯỚC KHI XOÁ từng món — G83)
Với **mỗi** món: `grep -rn "<TênComponent\|from .*TênTệp"` trên `client/ server/ e2e/` (trừ chính nó và trừ `.qa-*`) phải ra **0 chỗ gọi sống**; nếu ra > 0 ⇒ **DỪNG món đó**, ghi lại, báo tôi.
1. `client/src/components/factory-scene/FactoryScene3D.tsx` + `machineMesh.tsx` (~675 dòng, 0 chỗ dựng) — kiểm cả barrel `factory-scene/index.ts`: nếu barrel chỉ còn export tệp đã xoá thì xử lý luôn (nói rõ).
2. `client/src/pages/TwinHub.tsx` (~140 dòng) — 1 ca unit test `twinHubTabBoTriXuong §2` sẽ đỏ: **xoá đúng ca đó** (không xoá cả tệp test nếu tệp còn ca khác sống), giải thích trong commit.
3. `client/src/pages/DigitalTwinDashboard.tsx` (~606 dòng).
4. `client/src/pages/CellTwinPlayer.tsx` (~770 dòng).
5. `client/src/pages/FactoryLiveMap3D.tsx` + `client/src/components/FactoryFloor3D.tsx` (~449 dòng).
6. `client/src/pages/FactoryFloorEditor.tsx` (~604 dòng) — **trước khi xoá**, đo lại trên DB dev bằng **hai cách rời nhau** (BG-127): `factory_zones`, `safety_zones` đếm hàng; và `machines` có bao nhiêu hàng `layoutPositionX/Y` khác NULL. Nếu **khác 0** ⇒ DỪNG, báo tôi.
- **Giữ nguyên 6 `<Redirect>`** trong `App.tsx` (bookmark cũ). Nếu một redirect trỏ tới trang vừa xoá ⇒ đổi đích sang màn Twin tương ứng và ghi rõ; **đừng để redirect chết**.
- Sau mỗi món: `npm run check` phải 0 lỗi trước khi sang món kế.

## 2. Mục nav `/digital-twin` (`client/src/lib/navigation.tsx:439` — xác minh lại số dòng)
Xoá mục nav; **giữ `<Redirect>`**. Kiểm G67: `grep -rn 'navHref="/digital-twin"'` = 0 và không `RouteGuard`/`hasAccessToItem` nào tra href đó; nếu có ⇒ DỪNG. Đo sau: menu không còn mục ấy, `/digital-twin` gõ tay vẫn tới `/twin` (e2e hoặc đo bằng server 3061).

## 3. Tab 3D của `CommandCenter` (bỏ RIÊNG tab 3D, giữ trang)
Bỏ `<Canvas>` drei đời cũ (`CommandCenter.tsx:863` — xác minh lại) + bản sao `twin.sceneGraph` chỉ phục vụ tab ấy. **Giữ nguyên** 4 thủ tục `commandCenter.*`, 10 link đang trỏ tới trang, và các tab còn lại. Đo: trang vẫn mở được, tab list giảm đúng 1, `__soCanvas` trên trang = **0**, 10 link vẫn sống; nếu tab 3D là tab mặc định ⇒ đổi mặc định sang tab hợp lý và nói rõ.

## 4. Cổng ra sau khi xoá (đây là phần quan trọng nhất)
- `npm run check` **0** · `npm run check:tests` **≤ 27** (0 trong twin3d, 0 trong e2e) · `npm run i18n:check` **0** (nếu khoá mồ côi làm nó đỏ ⇒ **đừng xoá khoá ở đợt này**, ghi lại để Đợt 62; nếu buộc phải xử lý mới qua cổng thì báo tôi) · `lint:tokens` Δ0 · `kiem-vo` ĐẠT.
- `npx vitest run client/src/components/twin3d` ≥ **108/2 530** · 4 lưới phạm vi **180/180** · `npx vitest run client` (hoặc phạm vi chứa test của các trang vừa xoá) — liệt kê test nào đỏ/biến mất và vì sao.
- **Build thành công** vào outDir riêng `.qa-dot61/dist-61` (`NODE_ENV=production`, đường tuyệt đối ngoài `client/`); ghi số tệp + md5 lặp khớp (G120). **KHÔNG chạm `dist/` gốc.**
- Trên server 3061 từ bản dựng ấy: **13 redirect** vẫn đúng đích (đo, đừng đoán) · `/twin`, `/twin/line/2`, `/twin/may/14`, `/twin-studio`, `/command-center`, `/factory-command` đều **mở được, `__soCanvas` đúng như trước** · e2e bấm cảnh **16/16 (`--workers=1`)**.
- D-1 bằng **`do59.mjs`** (thước fail-closed) — kỳ vọng **0 ô đổi**; nếu đổi, giải thích từng ô.

## 5. Báo cáo `.qa-dot61/BAO-CAO.md` (8 mục)
1 cây · 2 bảng "trước khi xoá": mỗi món + bằng chứng 0 chỗ gọi sống + số dòng + md5 · 3 những gì đã xoá (danh sách tệp, tổng dòng) · 4 nav + tab 3D · 5 cổng ra đầy đủ mục 4 · 6 test đỏ/biến mất + lý do · 7 brief này SAI ở đâu (đếm) + lỗi của chính bạn · 8 **món nào bạn DỪNG không xoá và vì sao** + còn mở cho Đợt 62 (di trú `DigitalTwinCenter`, i18n mồ côi).
