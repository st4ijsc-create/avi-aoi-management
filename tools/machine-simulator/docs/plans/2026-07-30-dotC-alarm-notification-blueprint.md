# Đợt C — Cảnh báo ra ngoài (Outbound Alarm Notification)

**Trạng thái:** đã duyệt · chủ sở hữu chốt 4 kênh · backlog kế tiếp = thêm giao thức máy
**Ngày:** 2026-07-30
**Base:** `16ab36cd` (Đợt B merge-ready)

---

## 1. Vấn đề, nói thẳng

README §20.5 dòng 3654 tự khai:

> **Alarms cannot reach anyone who is not looking at the screen.** … An alarm is visible on `/alarms` and in the `alarms.db` history the moment someone opens that screen, **and not one moment before, to anyone who wasn't already looking.**

Đó là một sản phẩm giám sát máy mà cảnh báo chỉ tồn tại nếu có người đang nhìn. Với deployment mục tiêu của Đợt A — **một máy, đứng riêng, trong xưởng** — điều này gần như xoá sạch giá trị của cả tầng alarm ISA-18.2 đã xây.

## 2. Quyết định của chủ sở hữu

**Cả bốn kênh.** Backlog sau C: thêm giao thức máy (Serial/RS-485, S7, EtherNet/IP).

| Kênh | Offline? | Ghi chú |
|---|---|---|
| Webhook POST | ⚠️ LAN | Đòn bẩy lớn nhất — Slack/Teams/MES/Zabbix đều nuốt được |
| SMTP | ⚠️ LAN/Internet | `System.Net.Mail` trong BCL, không thêm NuGet |
| Báo tại chỗ (chuông + banner trong trang) | ✅ | Chỉ tới người đang mở UI. **Không có toast Windows** — C-5 chứng minh không khả thi, xem §5.1 |
| Relay còi/đèn | ✅ | **Rủi ro cao nhất đợt này** — xem §4 |

## 3. Ràng buộc kế thừa, không thương lượng

Đợt A và B để lại các bất biến sau. Đợt C **không được** làm mềm cái nào:

1. **Phần mềm không bao giờ là đường an toàn.** ISO 13849 Cat 3/4 = mạch cứng. HALT không dừng máy, và relay báo động của đợt này **không phải** tín hiệu an toàn.
2. **`EstopGuardRule` phủ mọi lệnh ghi và lệnh gọi.** Không có ngoại lệ — kể cả cái đợt này thêm vào (§4).
3. **Không có gì được I/O hay dispose khi đang giữ `FleetHost._gate`.**
4. **Bí mật không bao giờ vào response GET, dòng log, hay bản ghi audit.** Mẫu chuẩn: `ConnectorConfigStore` **loại hẳn cột khỏi câu `SELECT`** của truy vấn công khai (`SummaryColumns` vs `FullColumns`), không phải che sau khi lấy.
5. **`Indeterminate` sống sót như chính nó** qua mọi chặng.
6. Không thêm NuGet. Không sửa SDK vendored. Không đụng tài khoản `demo-admin`.

## 4. 🔴 Relay báo động — căng thẳng thật, và cách giải

**Vấn đề:** Đợt B dựng bất biến "mọi lệnh ghi đều có người xác thực, được uỷ quyền, được ghi audit, do người khởi xướng". Một relay báo động tự động **không có người trong vòng lặp**.

**Điều hệ thống không biết được:** cái coil khai là `annunciator` có thật sự là đèn báo không, hay là băng tải. Register map **chính là** ranh giới an toàn (Đợt B chốt vậy), và giờ ta cho một tiến trình tự động ghi xuyên qua nó.

**Quyết định — giữ đúng MỘT luật:**

- Relay báo động là **một lệnh ghi máy như mọi lệnh khác**, đi qua **nguyên vẹn** `EstopGuardRule`. **HALT gài ⇒ đèn không sáng.**
- Tài liệu nói thẳng: *ai cần đèn/còi hoạt động cả khi HALT thì phải đi dây cứng, không đi qua sản phẩm này.*
- **Mặc định TẮT.** Chỉ chạy khi vận hành khai đích danh một điểm `annunciator`.
- **Theo cạnh, không theo tick.** Bật khi alarm đầu tiên vào active; tắt khi cái cuối cùng clear. Không ghi lại mỗi 5 giây.
- **Bắt buộc rate limit.** Bão alarm không được nện coil.
- Audit dưới danh tính hệ thống riêng, phân biệt được với người thật.
- Nếu ghi trả `Indeterminate`, **không thử lại** — đúng hợp đồng B-1.

## 5. 🔴 Chống bão — điều kiện sống của cả đợt

`AlarmEvaluator` tick mỗi **5 giây**. `DriverHealth` và `NgRate` **raise lại vô điều kiện mỗi tick** trong suốt thời gian điều kiện còn đúng (đã biết, đã tài liệu hoá). `Identity` thì dedup theo ngày.

Một hook ngây thơ gắn vào `RaiseAsync` sẽ gửi **720 email/giờ cho một alarm duy nhất**. Chuyện này đã xảy ra một lần trong repo: `Identity` từng raise mỗi tick cho tới khi bị dedup, và bản vá đó ghi rõ nó thay thế vấn đề **~518 nghìn dòng/cửa sổ**.

**Vì vậy tầng thông báo phải phát hiện CẠNH, không phải trạng thái.** Đây là hạng mục đầu tiên của đợt (C-1) và mọi kênh đều ngồi sau nó.

## 6. Hình dạng kiến trúc

```
AlarmStore.RaiseAsync/ClearAsync/AckAsync   (4 điểm chuyển trạng thái, đã kiểm đủ)
        │  gọi sau khi ghi DB thành công, never-throws, chỉ enqueue
        ▼
  IAlarmNotifier  ──► bộ phát hiện cạnh (khử trùng lặp raise-lại)
        │
        ▼  Channel<NotificationJob> bounded, DropOldest  (mẫu HistorianWriter)
        │
   vòng drain nền  ──► rate limiter  ──► fan-out kênh
                                            ├─ Webhook   (HttpClient trần, backoff)
                                            ├─ SMTP      (System.Net.Mail)
                                            ├─ Tại chỗ   (SSE → web; KHÔNG có toast WPF — §5.1)
                                            └─ Relay     (⟶ B-2 resolution ⟶ EstopGuardRule ⟶ ghi)
```

**Chỉ chạy trong tiến trình `St4i.EngineApi`.** `EdgeService` và cả hai app WPF không host alarm engine (đã xác minh: mọi tham chiếu `IAlarmStore` đều nằm trong EngineApi). `DesktopShell` spawn EngineApi làm tiến trình con và trỏ WebView2 vào đó — nên toast Windows phải đi qua ranh giới tiến trình.

### 5.1 🔴 Đính chính của C-5 — KHÔNG có toast Windows (2026-07-31)

Bản kế hoạch này được viết trước khi kênh tồn tại và giả định toast Windows là làm được. **C-5 đã điều tra và kết luận là không**, với ba lý do độc lập, mỗi lý do tự nó đã đủ:

1. **Không có IPC nào để mang nó.** `DesktopShell` không tham chiếu `St4i.EngineApi` như một thư viện; hai kênh duy nhất nó có tới tiến trình engine là probe HTTP ẩn danh (`/v1/health`, `/`) và stdout/stderr của tiến trình con đổ ra file log. `/v1/alarms*` yêu cầu `Policies.Operator` còn shell không bao giờ đăng nhập — nên nó 401 ở bản triển khai thật nhưng lại chạy được ở bản Demo (`DemoAutoLoginMiddleware`); và đường stdout **không tồn tại** khi shell *attach* vào engine đang chạy sẵn thay vì tự spawn. Cả hai đường đều chạy ở một chế độ khởi động được hỗ trợ và im lặng ở chế độ kia.
2. **API không có ở TFM của shell.** `Windows.UI.Notifications` không phân giải được ở `net10.0-windows` (đo được: CS0103); phải nâng lên `net10.0-windows10.0.19041.0`, tức đổi build và sàn OS tối thiểu của gói desktop đang phát hành. `CommunityToolkit`/`Microsoft.Toolkit.Uwp.Notifications` là NuGet mới — đợt này cấm.
3. **Và API đó không cho biết nó có báo được hay không.** Đo trên chính máy này ở TFM đã nâng: một exe **unpackaged** với AppUserModelID không đăng ký ở đâu (đúng hình dạng của DesktopShell — một exe self-contained, không installer, không shortcut Start Menu) — `ToastNotifier.Show()` trả về bình thường và `NotificationSetting` báo `Enabled`, trong khi kho thông báo của chính Windows giữ **0** handler và **0** notification cho AUMID đó. Một kênh dựng trên đó sẽ **báo thành công trong khi không có gì phát ra**, và không có cách nào từ bên trong API để biết.

Cái C-5 giao thay vào đó **vẫn tới được desktop shell** bất cứ khi nào cửa sổ shell đang mở, vì WebView2 chính là web UI và nó phát âm thanh. Khoảng trống thật — nói thẳng thay vì giấu — là khi shell bị thu nhỏ hoặc bị cửa sổ khác che. Lấp nó cần một seam IPC mà sản phẩm này chưa có, và dựng seam đó không thuộc phạm vi C-5.

## 7. Phân rã công việc

| # | Nhiệm vụ | Rủi ro |
|---|---|---|
| **C-1** | Seam `IAlarmNotifier` + phát hiện cạnh + bounded channel + vòng drain never-throws | 🔴 Xương sống. Sai ở đây thì mọi kênh spam. |
| **C-2** | `NotificationConfigStore` (SQLite + user_version) + kho bí mật DPAPI+ACL + kỷ luật projection | 🔴 Bí mật |
| **C-3** | Kênh webhook — timeout có biên, backoff, ký HMAC, never-throws | |
| **C-4** | Kênh SMTP — BCL, TLS, credential từ C-2 | |
| **C-5** | Báo tại chỗ — âm thanh web + banner trong trang qua SSE. **Toast Windows: không khả thi — §5.1** | |
| **C-6** | 🔴 **Relay báo động** — qua trọn cổng Đợt B, mặc định tắt, theo cạnh, rate-limited | 🔴🔴 Cao nhất đợt |
| **C-7** | Endpoint + RBAC + audit + "gửi thử" + **rate limiting** (trả nợ số 1 của Đợt B) | |
| **C-8** | Web UI + census tài liệu (README:3654 và bản VI) | |

## 8. Census cần sửa khi xong

Đợt B dạy: **census của tôi sai hai lần**. Lần này liệt kê là điểm khởi đầu, không phải đáp án — C-8 phải tự quét.

Đã biết: `README.md:3654-3658` (EN) và bản VI đối ứng (~:3678), §12 roadmap, §20.5. Cộng mọi chỗ khác khẳng định sản phẩm không có kênh báo ra ngoài.

## 9. Giới hạn phải nói thẳng khi xong

- SMS không có. Sparkplug NCMD vào vẫn không có.
- Relay báo động **không phải thiết bị an toàn**, và **không sáng khi HALT gài**.
- Webhook/SMTP cần mạng — ở deployment offline thật sự chỉ còn relay và báo tại chỗ.
- Không có bảo đảm gửi tới nơi. Kênh hỏng thì thông báo mất, và phải nói rõ nó mất ở đâu.
