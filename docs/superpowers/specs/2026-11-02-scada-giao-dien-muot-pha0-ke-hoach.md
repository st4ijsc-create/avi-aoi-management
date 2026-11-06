# Pha 0 — Kế hoạch đo mốc "SCADA mượt" (CHỜ dieu-phoi duyệt; chưa chạy gì)

- **Thuộc:** [đặc tả v3](2026-11-02-scada-giao-dien-muot-design.md) §2 (SLO) · §9 (pha 0). **Tác giả:** scada-ui · **Ngày:** 2026-11-02
- **Nguyên tắc:** đo MỐC HIỆN TẠI trước mọi sửa; p50/p95/p99 (không trung bình, **không fps**); cùng kịch bản trước/sau; mỗi con số kèm bản dựng + lệnh tái lập.
- **Ràng buộc cứng:** không đụng `.env` (kể cả không `source`), :3000, :8091, GPU, DB DEV `aoi_management`; chỉ chạy **sau B-T12**, **ngoài cửa sổ GPU 20:30–~23:45** (tránh 21:00–00:00 như quy ước); báo dieu-phoi TRƯỚC khi chạy.

## 1. Cái cần đo (rút từ §2)

| Mã | Đo | Pha 0 làm được? | Ghi chú |
|---|---|---|---|
| L-A | bộ đệm → pixel | **Có** (hai chế độ) | (i) hỏi vòng hiện tại (Faceplate 2 s); (ii) kênh `scada:subscribe` sẵn có, KHÔNG sửa (mốc 250 ms khung) |
| L-B | thiết bị → bộ đệm theo giao thức | **Có** (Modbus poll, OPC UA) | dùng simulator chạy giao thức thật |
| L-C | thiết bị → màn | **Có** = tổng đầu-cuối | đo trực tiếp, không cộng suy |
| F-1 | khung p95/p99 màn quá trình 2D | **Không** (chưa có màn) | để pha 1d; pha 0 chỉ chuẩn bị bộ đo |
| F-2 | khung p95/p99 `/twin` có dữ liệu sống | **Có** nhưng cần GPU trình duyệt | **ngoài phạm vi kế hoạch này**: phiên twin đo (cùng kịch bản); tôi chỉ cấp bộ thu `PerformanceObserver` |
| O-1 | bấm "Đổi…" → kết quả điều kiện / hộp xác nhận | **Có** | chỉ đường ĐỌC/chạy khô (`dieuKienChoPhep`); KHÔNG bấm Xác nhận |
| O-2 | gửi lệnh → trạng thái đọc lại | **Không** | cần lệnh thật; đặt vào pha sau trên mô phỏng |
| S-1 | số khung "tươi giả" khi nguồn chết | **Có** (đo mốc = kỳ vọng > 0 hiện nay) | ngắt nguồn bằng simulator, đếm khung có số không-gạch sau ngưỡng cũ |

## 2. Dựng bản dev riêng (không đụng :3000)

**Cái cần từ dieu-phoi / chủ dự án (tôi không tự lấy):**
1. Khối biến môi trường cho một tiến trình **riêng** — tôi KHÔNG đọc `.env`. Gồm: `DATABASE_URL` trỏ **`aoi_management_sim`** (tên chứa `sim`, theo guard D10 của `scripts/sim-factory/README.md`), các khoá bắt buộc khởi động (JWT, v.v.), `PORT=3071`. Hai cờ SCADA bật **bằng biến tiến trình**, không sửa tệp: `SCADA_LIVE_CACHE_ENABLED=true`; `SCADA_SOCKET_ENABLED=false` (lượt A) / `true` (lượt B) (cả hai cờ đều cần cho kênh — `.env.example:3338-3342`).
2. Xác nhận DB `aoi_management_sim` đã tạo + migrate + seed (`npm run sim:factory`). Nếu chưa: ai chạy (việc ghi DB — dieu-phoi quyết).
3. Xác nhận :3000 chạy từ thư mục khác worktree của tôi (nhớ cảnh báo memory: `npm run build` giết server đang chạy **trong cùng thư mục**). Nếu :3000 chạy từ `dist/` của repo chính, build ở `_scada_ui_wt` an toàn; tôi sẽ không build trong repo chính.

**Dựng:**
```
# trong D:\SOURCES\_scada_ui_wt (nhánh pha 0 riêng, không phải feat/scada-r1b2b2-ui)
npm run build                                   # dist riêng của worktree này
set PORT=3071 & set NODE_ENV=production & ...   # khối biến do dieu-phoi cấp, KHÔNG ghi vào tệp
node dist/index.js                              # kiểm log "listening ... 3071" (findAvailablePort có thể nhảy cổng nếu bận)
node scripts/sim-factory/simulator.mjs          # Modbus 5020, OPC-UA 4840-4842, control 4899 (cổng thật của simulator)
```
Kiểm trước khi đo: `Get-NetTCPConnection` các cổng 3071/5020/4840/4899 rỗng trước và đúng tiến trình sau; **không** trùng 3000/8091. Phiên bản dựng ghi vào tệp kết quả = `git rev-parse HEAD` + `git diff --stat` rỗng.

**Thu hồi:** kết thúc đo = dừng đúng PID tôi khởi động (xác minh bằng chuỗi lệnh + PID mới, không `TaskStop` đoán — bài học G139/G152), báo dieu-phoi.

## 3. Bộ thu số đo (đặt trong `e2e/pha0/`, KHÔNG sửa mã sản phẩm)

- **Đồng hồ thống nhất:** mọi mốc dùng một đồng hồ duy nhất trên máy kiểm: kịch bản Node ghi `t0 = performance.timeOrigin + performance.now()` ngay trước khi gọi simulator; trong trang, mốc commit DOM lấy bằng `performance.timeOrigin + performance.now()` trong `MutationObserver` (cùng máy ⇒ cùng nguồn thời gian, không cần hiệu chỉnh lệch đồng hồ; `ageMs` server chỉ dùng đối chiếu).
- **Mẫu dò:** giá trị **sentinel** duy nhất mỗi lần (vd. `1000 + n + 0.5`), không trùng giá trị thật của simulator ⇒ khớp mẫu→DOM không nhầm.
- **L-C:** `POST http://127.0.0.1:4899/control {action:"tag.set", line, addr, value:sentinel}` tại `t0`; trang mở Faceplate của đúng tag; `MutationObserver` bắt lần đầu text chứa sentinel ⇒ `t1`; **L-C = t1 − t0** (gồm cả chu kỳ poll của driver — đây đúng là cái cần biết).
  ⚠ **Rủi ro của phép đo:** simulator có vòng cập nhật riêng (tag `speed` random walk) có thể **ghi đè** sentinel trước khi driver đọc. Bước 0 của pha 0 = chọn tag mà vòng simulator KHÔNG ghi (hoặc kiểm bằng `GET /state` rằng sentinel giữ) — nếu không có, thêm tag dò vào cấu hình simulator ở nhánh pha 0 (tệp trong `scripts/sim-factory/`, không sản phẩm). Đo thử 20 lần "tag.set → đọc `/state`" để chắc sentinel giữ ≥ 10 s **trước** khi đo thật; nếu không giữ ⇒ báo, không đo bừa.
- **L-B:** đặt lịch lệnh `tag.set` ở pha ngẫu nhiên trong chu kỳ poll (tránh đồng bộ với poll) ⇒ phân bố đúng ≈ U(0, poll); đọc cache phía server bằng route chẩn đoán **sẵn có** (`scadaDiag.tagCuaAdapter`) dò 20 ms/lần ⇒ `tL-B`. L-A = L-C − L-B. Mốc 20 ms dò chỉ ảnh hưởng độ phân giải (ghi vào báo cáo), không đo trên đường sản xuất.
- **O-1:** `performance.mark` quanh `scadaCommands.dieuKienChoPhep` từ gõ → dòng "Được phép/Không được phép" hiện; 30 lần.
- **S-1:** `POST control opcua.kill` tại `t0`; đếm mọi khung quan sát được từ `t0` mà ô số **không** ở trạng thái cũ **sau** ngưỡng cũ của adapter (theo `stale` server) — kỳ vọng hiện nay: hỏi vòng 2 s ⇒ số "tươi" kéo dài tới khi server báo `stale` (≥ `3·poll`); đo thật, không đoán.
- **F (chuẩn bị):** mô-đun `PerformanceObserver({type:"long-animation-frame"})` + `requestAnimationFrame` delta, xuất p50/p95/p99; thử trên một trang tĩnh để kiểm chính bộ đo (đo hai lần cùng kịch bản, độ lệch p95 giữa hai lần < 10 % mới được dùng — **kiểm thiết bị đo trước khi tin số**).

## 4. Kịch bản cố định (Playwright, 1 worker, 1 trình duyệt, chromium)

- Cấu hình riêng `e2e/pha0/playwright.pha0.config.ts` (**không sửa** `playwright.config.ts`); `workers: 1` (bài học Đợt 59: số worker là một phần của phép đo); `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3071`; `outputDir` riêng `.qa-pha0/` (không `test-results/` — Playwright dọn thư mục này, G65/G130); tài khoản thử riêng **không phải admin** (cần tên tài khoản — dieu-phoi cấp; tôi không xin mật khẩu admin).
- Mỗi lượt đo:
  1. Đăng nhập → `/scada/kenh` → mở Faceplate tag dò (adapter Modbus simulator).
  2. Làm nóng 10 s (bỏ).
  3. 60 lần L-C, cách nhau ngẫu nhiên 700–1300 ms (không đồng bộ chu kỳ poll 2 s).
  4. 30 lần O-1.
  5. 1 lần S-1.
- **Hai cấu hình đo**, mỗi cấu hình **3 lượt** chạy nối tiếp (sai lệch giữa lượt báo kèm):
  - **A — hiện trạng:** `SCADA_SOCKET_ENABLED=false`; Faceplate hỏi vòng 2 s (đúng sản phẩm hôm nay).
  - **B — kênh sẵn có, khi bật:** `SCADA_SOCKET_ENABLED=true` + một **trang dò tối thiểu** `e2e/pha0/trang-do-socket.html` mở socket.io tới :3071, đăng ký `scada:subscribe` rồi đo `scada:delta`→DOM. Mục đích: **mốc** của kênh chưa có client (không phải sản phẩm; không đưa vào `client/src`). Cho biết trần thực của khung 250 ms trước khi chọn `capMs`.
- Ghi: p50/p95/p99, n, min/max, histogram 10 thùng, bản dựng (hash), cấu hình cờ, PID, thời điểm. Kết quả vào `docs/superpowers/specs/2026-11-02-scada-giao-dien-muot-pha0-so-do.md` (tệp mới, commit nhánh pha 0).

## 5. Điều kiện dừng / không đo

- Cổng cần dùng đã bận bởi tiến trình lạ ⇒ dừng, báo.
- Thiếu khối biến môi trường / DB `_sim` chưa sẵn sàng ⇒ dừng, không tự dựng DB.
- Sentinel không giữ ở simulator (xem §3) ⇒ báo, đề xuất sửa simulator ở nhánh pha 0, không đo bừa.
- Bộ đo không ổn định (độ lệch p95 ≥ 10 % giữa hai lượt cùng cấu hình) ⇒ số bị loại, không dùng làm mốc.
- Bất kỳ lúc nào máy báo tải/bộ nhớ cao (nhớ sự cố bộ nhớ ảo WSL) hoặc đang trong cửa sổ GPU ⇒ hoãn.

## 6. Việc dieu-phoi cần trả lời để chạy
1. Duyệt kế hoạch (hoặc chỉ ra chỗ sai).
2. Khối biến môi trường cho bản dev (tôi không đọc `.env`) + xác nhận `aoi_management_sim` đã sẵn sàng/ai tạo.
3. Tên tài khoản thử (không admin) có quyền xem SCADA + faceplate trong DB `_sim`.
4. Xác nhận :3000 chạy từ thư mục khác worktree này (an toàn build).
5. Khung giờ (ngoài GPU), sau B-T12.
6. Nhánh pha 0: tôi tạo `chore/scada-pha0-do-moc` từ main mới nhất (tệp mới trong `e2e/pha0/` + một tệp số đo; **không** sửa mã sản phẩm); gộp sau.
