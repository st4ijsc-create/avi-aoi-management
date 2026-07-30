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
| Chuông + toast tại chỗ | ✅ | Chỉ tới người đã ở gần máy |
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
                                            ├─ Tại chỗ   (SSE/poll → web + toast WPF)
                                            └─ Relay     (⟶ B-2 resolution ⟶ EstopGuardRule ⟶ ghi)
```

**Chỉ chạy trong tiến trình `St4i.EngineApi`.** `EdgeService` và cả hai app WPF không host alarm engine (đã xác minh: mọi tham chiếu `IAlarmStore` đều nằm trong EngineApi). `DesktopShell` spawn EngineApi làm tiến trình con và trỏ WebView2 vào đó — nên toast Windows phải đi qua ranh giới tiến trình.

## 7. Phân rã công việc

| # | Nhiệm vụ | Rủi ro |
|---|---|---|
| **C-1** | Seam `IAlarmNotifier` + phát hiện cạnh + bounded channel + vòng drain never-throws | 🔴 Xương sống. Sai ở đây thì mọi kênh spam. |
| **C-2** | `NotificationConfigStore` (SQLite + user_version) + kho bí mật DPAPI+ACL + kỷ luật projection | 🔴 Bí mật |
| **C-3** | Kênh webhook — timeout có biên, backoff, ký HMAC, never-throws | |
| **C-4** | Kênh SMTP — BCL, TLS, credential từ C-2 | |
| **C-5** | Báo tại chỗ — âm thanh web + toast Windows qua ranh giới tiến trình | |
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
