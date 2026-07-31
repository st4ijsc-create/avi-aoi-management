# Đợt C — Cảnh báo ra ngoài (Outbound Alarm Notification)

**Trạng thái:** 🔴 **ĐÃ GIAO ĐỦ — C-1 đến C-8, 2026-07-31/08-01.** (Trước đó: đã duyệt · chủ sở hữu chốt
4 kênh · backlog kế tiếp = thêm giao thức máy)
**Ngày:** 2026-07-30
**Base:** `16ab36cd` (Đợt B merge-ready)

> 🔴 **Đính chính của C-8 (review round 1, M-2) — đọc trước phần §1 bên dưới.**
>
> **Toàn bộ phần "Vấn đề" của tài liệu này viết ở thì HIỆN TẠI và nay đã SAI.** Bốn kênh đã được xây và
> xuất xưởng: webhook ký HMAC (C-3), email qua SMTP (C-4), báo tại chỗ qua SSE (C-5), relay/đèn báo vật lý
> (C-6), cộng với seam + bộ dò cạnh (C-1), kho cấu hình và bí mật DPAPI (C-2), 12 endpoint + RBAC + bộ giới
> hạn tốc độ đầu tiên của sản phẩm (C-7), và màn hình + census (C-8). Câu trích dẫn README ở §1 được **giữ
> nguyên có chủ ý** — nó là *phát biểu vấn đề* mà đợt này sinh ra để giải, không phải một khẳng định còn
> hiệu lực; README §20.5 nay đã tự đính chính, và bản thân §12/§22 của README ghi rõ điều gì đã giao.
>
> Hai blueprint anh em (`2026-07-29-dotA-…`, `2026-07-29-dotB-…`) đã được C-8 đánh dấu tương tự; ghi chú
> này tồn tại để `docs/plans/` không mâu thuẫn nội bộ — một người đọc mở đúng tài liệu này trước sẽ không
> tin rằng sản phẩm vẫn chưa có kênh báo ra ngoài.
>
> Giới hạn thật của năng lực đã giao (KHÔNG có SMS/syslog, không có toast Windows, không dùng được TLS
> ngầm cổng 465, một bài gửi thử email xanh không chứng minh mật khẩu đúng, relay **không phải thiết bị an
> toàn** và **không sáng khi HALT gài**, không có bài gửi thử relay, không có bảo đảm gửi tới nơi): xem
> **README §22.7**.

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

### 4.1 Đính chính / bổ sung sau khi C-6 xây xong (2026-07-31)

Mọi điều ở §4 vẫn đúng. **Tám điểm** C-6 phải **quyết** mà kế hoạch chưa nói, ghi lại ở đây để người đọc kế hoạch không phải suy diễn:

1. 🔴 **Lệnh ghi của relay dùng ĐÚNG hai `action id` của Đợt B** — `machine.setpoint.write` (point) và `machine.command.invoke` (command) — chạy qua **cùng một** `PolicyEngine` singleton mà endpoint HTTP dùng. Không có action id riêng: `EstopGuardRule` so khớp **ordinal**, nên một id riêng sẽ **đi lọt** qua chốt HALT. Hai hằng số nay nằm ở `MachineWriteGate` (một chỗ duy nhất), và `MachineWriteEndpoints` gọi cùng chỗ đó.

2. 🔴 **Ngoại lệ DUY NHẤT, và nó không phải ngoại lệ trong luật mà là một *fact do caller giải*.** `PolicyRequest.CriticalAlarmActive` theo thiết kế Đợt B là do **caller** giải trước khi engine chạy (B-6 tự nó đã loại `AlarmSource.Policy` ra vì lý do self-latch). Relay giải fact đó là `false`, và đây là suy dẫn:
   `AlarmPriority` khai theo thứ tự nặng-trước (`Critical = 0`), `MeetsThreshold` là `priority <= min` ⇒ **alarm Critical thoả MỌI ngưỡng relay**. Vậy mọi alarm Critical đều là alarm mà chính relay đang báo — nó là **đầu vào** của lệnh ghi, không phải lý do độc lập để từ chối. Nếu giải là `true`, một relay cấu hình ở ngưỡng `Critical` — chính là cấu hình chủ đạo — **vĩnh viễn không bao giờ sáng được**: đúng cái alarm đáng lẽ bật đèn lại là cái chặn lệnh ghi. Đèn chắc chắn tối đúng lúc nhà máy tệ nhất còn tệ hơn không có đèn.
   Tiền đề này **được test ghim** (`ACriticalAlarmMeetsEveryRelayThreshold_…`); thêm một mức ưu tiên trên Critical là test đỏ và phải suy dẫn lại. `CriticalAlarmGuardRule` **không bị sửa** và vẫn áp dụng đầy đủ cho mọi lệnh ghi HTTP. Đây cũng là chỗ **duy nhất** đường tự động rộng hơn đường con người, và nói thẳng ra ở đây.

3. **Giá trị đóng/mở (schema v3).** Target `Point` **bắt buộc** cả hai giá trị (lưu dạng JSON scalar thô, đọc qua đúng converter mà `MachineWriteEndpoints` dùng); **không có mặc định**, vì mặc định là sản phẩm tự chọn giá trị ghi vào một coil nó không chứng minh được là đèn. Target `Command` **không được** có giá trị nào. Store **từ chối lưu** cả hai vi phạm — đúng nguyên tắc C-2 đã dùng để từ chối `ImplicitTls`.

4. **`Command` chốt được nhưng KHÔNG nhả được.** Command là xung không tham số, không có "un-pulse". Kênh đếm `ReleaseUnsupported` và cảnh báo, chứ không giả vờ đã tắt. Cần đèn chốt/nhả thì phải dùng target `Point`.

5. **`Acked` KHÔNG nhả chốt.** ISA-18.2 "ack = tắt còi" và C-5 tôn trọng điều đó vì C-5 **biết** nó đang phát ra tiếng. Kênh này không biết nó đang lái cái gì; tắt một cái **đèn** vì có người đã ack sẽ giấu đi điều kiện vẫn đang tồn tại. (Ack của alarm `ClearOnAck` — mọi denial Policy — vẫn nhả, vì C-1 báo nó là `Cleared`: hàng thật sự đã biến mất.)

6. 🔴 **Chết máy khi đèn đang sáng ⇒ đèn ở nguyên.** Với thiết bị báo động, **tối giả** tệ hơn **sáng giả**: đèn tối bị đọc là "không có sự cố". Và tắt-khi-thoát chỉ chạy được ở lối thoát êm; mất điện thì coil ở nguyên — một bảo đảm chỉ đúng ở ca dễ thì không phải bảo đảm. Khi khởi động lại, chốt được dựng lại từ `Restored` và trạng thái tin-tưởng bắt đầu ở **UNKNOWN**, nên mức đầu tiên suy ra luôn được ghi.

7. 🔴 **HALT gài trong lúc đèn đang sáng ⇒ lệnh ghi TẮT cũng bị từ chối.** Không mở ngoại lệ. Hệ quả trung thực: đếm `Refused`, và **`Energised` giữ nguyên `true`** — sản phẩm không bao giờ tin là đèn đã tắt trong khi nó đang sáng. Cảnh báo nói thẳng "STILL ENERGISED". Reset HALT xong, cạnh kế tiếp thấy bất đồng và ghi tắt.

8.1 🔴 **Sửa sau review vòng 1 (Critical):** trạng thái phải tách làm **hai** — mức đã **RA LỆNH** (`Commanded`) và mức **TIN LÀ ĐÃ ÁP DỤNG** (`Energised`). Cổng ghi hỏi `Commanded`; `Energised` chỉ để báo cáo. Sau một lệnh ghi `Indeterminate`, `Energised` là UNKNOWN — đúng và cần thiết — nhưng nếu cổng ghi hỏi `Energised` thì **mọi** alarm tiếp theo trong cùng một đợt lại ghi tiếp (đo được: 20 alarm ⇒ 20 lần, và với target `Command` mỗi lần là một cú actuate thật). `Commanded` dịch chuyển khi `Applied` **và** khi `Indeterminate` (đã phát lệnh cho mức đó thì không phát lại — đó chính là nghĩa của "không thử lại"), và **không** dịch chuyển khi `Failed`/`Rejected`/bị từ chối/không phân giải được driver (không có gì tới thiết bị, nên cạnh sau phải thử lại).

8.2 🔴 **Cũng từ review vòng 1 (I-1):** trong ba luật, **chỉ `EstopGuardRule` mới có thể từ chối** lệnh ghi của relay. `CriticalAlarmGuardRule` luôn trả `null` (fact được giải là `false`), còn `RoleObligationRule` **không bao giờ** từ chối được vì relay luôn trình đúng vai mà chính action của nó đòi. Nói ra để không ai đọc "cả ba luật đều chạy" thành phòng-thủ-nhiều-lớp mà thực ra không có.

8.3 🔴 **(I-2, ràng buộc cứng cho C-7):** lưu một dòng relay với `TargetKind = Command` khiến sản phẩm **tự động và lâu dài** thực hiện một hành động mà người thật cần quyền Admin. Đường ghi cấu hình relay **phải gác ở mức Admin**, ít nhất cho target `Command`.

9. **Rate limit: 2 giây tối thiểu giữa hai lần THỬ ghi trên một instance** — **hoãn, không bao giờ bỏ** (bỏ một lệnh nhả là để đèn sáng mãi). Bão *raise* đã bị chính chốt hấp thụ (100 alarm = 1 lệnh ghi); limiter chỉ ăn vào trường hợp **flap**. 2 s nằm dưới mọi tốc độ cạnh hợp lệ (`AlarmEvaluator` tick 5 s) nên vận hành bình thường không bị hoãn gì.

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

### 7.1 🔴 Bổ sung sau khi C-7 xây xong (2026-07-31)

Bốn quyết định của C-7 mà C-8 và người vận hành phải biết, vì không quyết định nào trong số này suy ra được từ code:

1. **`PUT`/`DELETE /v1/notifications/relay` là ADMIN; mười route còn lại là Engineer.** Lưu một hàng relay với
   `targetKind = Command` khiến sản phẩm tự động thực hiện — và thực hiện suốt thời gian hàng đó tồn tại — một
   hành động mà con người cần quyền Admin (`MachineWriteGate.RoleFor`). Đó là **hành vi cấp quyền**, không phải
   một thay đổi cấu hình thông thường. Cổng đặt ở **ROUTE**, không phải ở thân request: một `if` trong handler
   nằm ngoài tầm nhìn của `RbacPolicyTests`' metadata sweep — thứ duy nhất trong bộ test thấy được một
   `.RequireAuthorization` bị quên. Hạ vai trò ở `RoleFor` **không phải** giải pháp thay thế: nó sẽ khiến mọi
   relay kiểu Command bị từ chối vĩnh viễn, tức là một cấu hình store nhận nhưng kênh không bao giờ thi hành
   được — đúng lỗi mà C-2 đã từ chối `ImplicitTls` vì nó.

2. **"Gửi thử" chỉ có cho Webhook và SMTP.** Local annunciation bị từ chối (400 có lý do): một bài thử sẽ đẩy
   một **thẻ báo động giả** kèm tiếng chuông lên mọi trang đang mở, cho một điều kiện không hề xảy ra — điều mà
   `ready` frame của SSE và `localAnnunciation.listeners` đã trả lời rồi. Relay cũng bị từ chối: nó là một lệnh
   ghi máy ở tầng Admin, giành quyền điều khiển coil khỏi latch của chính kênh đó, và có thể **để đèn sáng** nếu
   lệnh nhả sau đó bị HALT latch chặn. Đây là **món nợ có chủ ý** — xem `task-7-report.md` §7.

3. 🔴 **Một bài gửi thử SMTP xanh KHÔNG chứng minh mật khẩu đúng, và API nói thẳng điều đó**
   (`NotificationTestOutcome.DoesNotProve`, và lặp lại trong chính thân thư). C-4 đã đo: `SmtpClient` đi tiếp
   **không xác thực** khi relay từ chối, không hỏi, hoặc không hề quảng cáo `AUTH` — và không phơi bày kết quả
   xác thực nào. Với relay chấp nhận thư nặc danh, kết quả xanh và mật khẩu chưa từng được dùng.

4. **Rate limiting: đúng MỘT route bị giới hạn** — `POST /v1/notifications/test`, 5 giây/lần, một bucket toàn
   cục, từ chối bằng 429 chứ không trì hoãn. Đó là route duy nhất khiến sản phẩm phát ra thứ gì đó tới **bên thứ
   ba**. Các route ghi cấu hình **cố ý không bị giới hạn**: chúng là ghi SQLite cục bộ, idempotent, và lúc người
   vận hành cần sửa cấu hình gấp nhất chính là lúc đang có sự cố — một lệnh ghi cấu hình bị từ chối giữa bão báo
   động tệ hơn cơn bão nó ngăn. `GET /v1/alarms/annunciations` được chặn bằng **giới hạn số kết nối đồng thời**
   (32) chứ không phải rate limit, vì chi phí của nó nằm ở mỗi kết nối SỐNG chứ không ở mỗi lần kết nối.

## 8. Census cần sửa khi xong

Đợt B dạy: **census của tôi sai hai lần**. Lần này liệt kê là điểm khởi đầu, không phải đáp án — C-8 phải tự quét.

Đã biết: `README.md:3654-3658` (EN) và bản VI đối ứng (~:3678), §12 roadmap, §20.5. Cộng mọi chỗ khác khẳng định sản phẩm không có kênh báo ra ngoài.

## 9. Giới hạn phải nói thẳng khi xong

- SMS không có. Sparkplug NCMD vào vẫn không có.
- Relay báo động **không phải thiết bị an toàn**, và **không sáng khi HALT gài**.
- Webhook/SMTP cần mạng — ở deployment offline thật sự chỉ còn relay và báo tại chỗ.
- Không có bảo đảm gửi tới nơi. Kênh hỏng thì thông báo mất, và phải nói rõ nó mất ở đâu.
