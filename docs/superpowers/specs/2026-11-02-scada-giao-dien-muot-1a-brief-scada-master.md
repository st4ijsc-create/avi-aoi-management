# Brief 1a cho scada-master — vá hợp đồng kênh `scada:subscribe`

- **Từ:** scada-ui · **Tới:** scada-master · **Ngày:** 2026-11-02 · **Duyệt:** chủ dự án đã duyệt đặc tả v2 ([§3](2026-11-02-scada-giao-dien-muot-design.md))
- **Thời điểm làm:** SAU hàng an toàn A2 đang chạy (dieu-phoi chốt). Không làm xen.
- **Phạm vi:** CHỈ server kênh đẩy SCADA hiện có `server/services/scada/scadaSocket.ts` (+ một getter nhỏ ở `boDemHienTai.ts` nếu cần). **Không** đụng: `commandDispatcher`, OT driver, `lenhHmi`, `troLaiKenh`, `rateLimitConfig`, `context`, `trpc`, `.env`. Không bật cờ.
- **Chủ sở hữu client:** scada-ui (hook `useTagSong`, pha 1b) — viết SAU khi brief này lên main.

## 1. Vì sao (một đoạn)
Kênh hiện chỉ đẩy khi giá trị ĐỔI (`khiBoDemDoi` → `cho` → `dayKhung`, `scadaSocket.ts:145-173`). Client không phân biệt "im vì không đổi" (deadband có thể im tới 70 s) với "im vì đường chết". Không có tín hiệu thì màn hình không thể đúng khi hiển thị "dữ liệu cũ ⇒ dừng + xám" (yêu cầu an toàn cốt lõi). Ba lỗ cần vá: **A** nhịp tim + ngưỡng cũ theo tag, **B** nhịp khung tuỳ chọn, **C** số thứ tự khung.

## 2. Hợp đồng (TypeScript — thêm trường, KHÔNG đổi tuple `GiaTriGoi`)

```ts
// vào: scada:subscribe — thêm 2 trường TUỲ CHỌN
type SubscribeV2 = {
  subId?: string;
  tags: { adapterId: number; tagKey: string }[];
  capMs?: 50 | 100 | 250 | 1000;   // B. Vắng ⇒ 250 (hành vi hôm nay). Giá trị khác tập ⇒ BAD_REQUEST.
  nguon?: "that";                  // DỰ PHÒNG cho pha 2B ("mo_phong"). Hiện: có mặt và khác "that" ⇒ BAD_REQUEST (không im lặng bỏ qua).
};

// ra: scada:snapshot — thêm trường
type SnapshotV2 = {
  subId: string;
  seq: number;                     // C. Số thứ tự TĂNG DẦN theo (socket, subId), bắt đầu 0 ở snapshot; delta kế = +1
  serverTs: number;                // ms epoch, lúc phát
  values: GiaTriGoi[];             // như cũ
  staleAfterMs: Record<`${number}:${string}`, number>;   // A. Ngưỡng cũ của TỪNG tag được phép (khoá = `${adapterId}:${tagKey}`)
  denied: { adapterId: number; tagKey: string }[];       // như cũ
};

// ra: scada:delta — thêm trường
type DeltaV2 = { subId: string; seq: number; serverTs: number; values: GiaTriGoi[] };

// ra: MỚI scada:tick — nhịp tim, KHÔNG mang giá trị tag
type Tick = {
  subId: string; seq: number;      // seq dùng CHUNG dãy với delta (để phát hiện mất khung cả tick)
  serverTs: number;
  adapters: {
    adapterId: number;             // chỉ adapter có ≥ 1 tag ĐÃ ĐƯỢC PHÉP trong đăng ký này
    trangThai: "connected" | "connecting" | "lost" | "disabled";
    tuoiMauMoiNhatMs: number | null;   // tuổi mẫu mới nhất của adapter (null = chưa có mẫu)
  }[];
};
```
`GiaTriGoi = [adapterId, tagKey, v, q, ts, ageMs, stale, reason]` GIỮ NGUYÊN (client cũ nếu có không vỡ). Xác nhận bên dùng: scada-master kiểm repo không còn nơi nhận `scada:snapshot/delta` nào khác ngoài test (scada-ui đã grep: client 0 nơi dùng).

## 3. Yêu cầu hành vi

**A. Ngưỡng cũ + tick**
- A1. `staleAfterMs[k]` = ngưỡng cũ **hiện hành** của adapter của tag đó (`max(3·poll, coDeadband ? NGUONG_DEADBAND_MS : 0)`, `boDemHienTai.ts:172-176`). Dùng cùng hàm với phép tính `stale` ở bộ đệm — **một nguồn sự thật**, không sao chép công thức. Cần getter công khai (tên gợi ý `nguongCuCuaAdapter(adapterId)`); nếu đã có, dùng.
- A2. Cập nhật ngưỡng: nếu ngưỡng của một adapter ĐỔI giữa chừng (đổi poll / bật deadband), gửi lại `staleAfterMs` cho tag liên quan — đề xuất: **đính kèm một khoá `staleAfterMs` (thành phần phụ) trong `delta` khi khác lần gửi trước**; hoặc cho phép client đăng ký lại. scada-master chọn cách rẻ hơn, ghi lý do; không bỏ trống.
- A3. `scada:tick` mỗi **1000 ms** cho **mỗi đăng ký còn sống**, kể cả khi không có thay đổi. Dùng CÙNG vòng `setInterval` hiện có (không tạo bộ hẹn thứ hai); vòng vẫn chỉ tồn tại khi có ≥ 1 đăng ký.
- A4. Tick KHÔNG chứa `tagKey`, giá trị, hay thông tin về adapter ngoài đăng ký ⇒ không mở bề mặt rò dữ liệu. `adapters[]` chỉ gồm adapter có tag ĐƯỢC PHÉP.
- A5. Máy hiệu lực đổi (đã xử lý `"doiMay"` hôm nay): tag đó **vắng** khỏi `staleAfterMs` mới và khỏi delta — giữ nguyên hành vi; client sẽ thấy tag cũ.

**B. `capMs`**
- B1. Mặc định 250 (hôm nay). Chu kỳ đẩy của một socket = **min** `capMs` của các đăng ký đang sống của nó (một vòng, không một vòng/đăng ký). Server kẹp: tối thiểu 50.
- B2. Trần "nóng": số đăng ký có `capMs < 250` mỗi socket ≤ 2 và mỗi người dùng ≤ 3; vượt ⇒ `scada:error {code:"TOO_MANY_HOT"}` (mã MỚI, thêm vào `MaLoiScada`). Số cụ thể cho scada-master điều chỉnh sau đo pha 0; ghi hằng số trong `GIOI_HAN`.
- B3. Khi tải máy chủ cao (đo bằng độ trễ vòng đẩy), được nâng `capMs` hiệu lực lên 250 và báo bằng một cờ trong tick (`ganGiam: true`) — tuỳ chọn; nếu không làm, nêu rõ.

**C. `seq`**
- C1. `seq` tăng 1 cho MỖI khung phát (snapshot/delta/tick) thuộc một `subId`; đăng ký lại cùng `subId` ⇒ snapshot mới, `seq` bắt đầu lại 0.
- C2. Client thấy `seq` nhảy cách ⇒ tự đăng ký lại cùng `subId` (server đã hỗ trợ). Không cần làm gì thêm phía server, **nhưng** phải ghi test rằng đăng ký lại cùng `subId` không tạo vòng thứ hai / không rò đăng ký.

## 4. Bất biến an toàn / phạm vi (KHÔNG ĐƯỢC ĐỔI)
1. Không `socket.join`, không `io.emit`, không `io.to(...)` — chỉ `socket.emit` tới đúng socket (census phòng/phát giữ nguyên số). `scada:tick` cũng vậy.
2. Kiểm quyền + phạm vi TỪNG TAG lúc đăng ký giữ nguyên; `denied` vẫn cùng hình dạng cho "không tồn tại" và "ngoài phạm vi".
3. `staleAfterMs` chỉ chứa khoá tag ĐƯỢC PHÉP (không tiết lộ tag bị `denied`).
4. Giới hạn hiện có giữ nguyên (500 tag/đăng ký, 10 đăng ký/socket, `BUSY`).
5. Socket không phải người dùng (`clientType:"machine"`): giữ nguyên hành vi từ chối ngay (không tick).
6. Cờ `SCADA_SOCKET_ENABLED` / `SCADA_LIVE_CACHE_ENABLED` giữ nguyên; kênh vẫn `DISABLED` khi thiếu cờ. **scada-master KHÔNG bật cờ**; chủ dự án tự sửa `.env` sau khi 1a lên main và đã kiểm.

## 5. Kiểm thử bắt buộc (kèm đột biến — mỗi đột biến PHẢI làm ít nhất một ca đỏ)

| Ca | Đột biến phải đỏ |
|---|---|
| Có tick đều 1 Hz khi KHÔNG tag nào đổi (fake timer) | bỏ phát tick / chỉ phát khi có delta |
| `tick.adapters` chỉ gồm adapter có tag được phép (đăng ký hai adapter, một `denied`) | gộp mọi adapter vào tick |
| `staleAfterMs` đúng bằng hàm ngưỡng của bộ đệm cho adapter poll 5 s (15 000), có deadband (70 000) | sao chép công thức sai / hằng cố định |
| `staleAfterMs` không có khoá tag `denied` | liệt kê cả khoá bị từ chối |
| `seq` tăng đúng 1 theo từng khung, chung dãy delta+tick; đăng ký lại ⇒ 0 | seq theo kiểu khác / không reset |
| `capMs:100` ⇒ khung ≤ 100 ms; hai đăng ký 100 & 1000 ⇒ chu kỳ = 100; mặc định 250 | bỏ kẹp / dùng cố định 250 |
| `capMs` ngoài tập ⇒ BAD_REQUEST; `nguon:"mo_phong"` ⇒ BAD_REQUEST | chấp nhận im lặng |
| Vượt trần nóng ⇒ `TOO_MANY_HOT`, không cắt im lặng | bỏ kiểm |
| Không `socket.join`/`io.emit` (census hiện có vẫn xanh) | thêm `io.emit` |
| Không còn đăng ký ⇒ vòng + tick dừng (`__vongDangChay()` false) | để vòng chạy |
| Socket `machine` ⇒ không tick, mọi tag denied (như hôm nay) | gửi tick cho socket máy |

Bổ sung: chạy **đủ census** (`grep -i census`, `server/_core`, kiểm phạm vi ghi/socket) theo quy tắc gộp main — đừng chỉ test của commit.

## 6. Điều scada-ui cần scada-master trả lời trước khi viết mã client
1. Deadband của tag có được áp **trước** `dangKyThayDoi` (tức tag trong deadband không sinh khung) không? (Ảnh hưởng đúng tần suất khung và ngân sách byte — spec §3.5.)
2. A2: chọn cách báo ngưỡng đổi giữa chừng nào?
3. Tick 1 Hz × số socket: đo chi phí (đề xuất một ca bench trong `scripts/scada-r*-bench.ts` hoặc test hiệu năng nhỏ) — con số để chốt `capMs`/trần nóng.
4. Có bên dùng ngoài nào nhận `scada:snapshot/delta` (edge, công cụ) mà thêm trường sẽ ảnh hưởng không?
5. Phòng `robot:{id}` (`socket.ts:2390`) đã qua cổng phạm vi chưa — dieu-phoi đã chuyển cho scada-master kiểm (chặn gương robot 2A).
6. Tên vai trò tag theo census C-tag — bảng chốt khi nào (spec §5.2 đang ghi tạm "chờ C-tag").

## 7. Ngoài phạm vi brief này (đừng làm)
Trục "nóng" 20–50 Hz và nén khung bằng chỉ số tag (§7B.3, pha 2A) · kênh mô phỏng (`nguon:"mo_phong"`, pha 2B; quyền kỹ sư + admin) · đổi chu kỳ quét mặc định 5 s (chủ dự án KHÔNG đổi) · mọi thay đổi `.env`.
