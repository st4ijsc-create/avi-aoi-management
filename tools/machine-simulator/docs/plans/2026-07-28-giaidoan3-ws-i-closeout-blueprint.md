# GĐ3 sub-5 — Đóng dứt WS-I (Join) + trả nợ kỹ thuật

| | |
|---|---|
| Ngày | 28/07/2026 |
| Nhánh | `feat/machine-simulator` — BASE là commit blueprint này |
| Mục tiêu | Đưa **WS-I Join** của §6 lên 100%: máy **tự quảng bá** qua mDNS, bridge có **seq + backfill bền qua restart**, chứng thư **xoay vòng được**. Kèm trả các món nợ vặt đã ghi ở §0-bis.4. |
| Tiền đề | GĐ1 + GĐ2 xong; GĐ3 đã có EC (danh tính + bridge mTLS), mDNS browse-only, OPC-UA, Alarm+Line (`669eba86`) |

## Quyết định đã chốt (28/07/2026)

| # | Quyết định | Hệ quả |
|---|---|---|
| 1 | **mDNS advertise BẬT mặc định khi UNS bật** | Đây là **ngoại lệ có chủ ý** với nguyên tắc "additive/default-off" của dự án. Máy sẽ phát multicast trên LAN ngay sau khi nâng cấp. Bắt buộc: tắt được bằng `ST4I_MDNS_ADVERTISE=0`, và **phải ghi rõ trong README §17 + phần release-note** rằng đây là hành vi mạng mới. |
| 2 | **Backfill spool xuống ĐĨA (bền qua restart)** | Không tái dùng WAL hiện có — WAL gắn chặt vào SDK `St4iDeviceClient` (`FlushQueueAsync` + `.jsonl` theo machineCode), không dính gì tới `ForwardItem` của bridge. Phải dựng store riêng. Đạt mục tiêu "đệm ≥24h" của §3.2. |
| 3 | Spool dùng **SQLite** | Đúng khuôn mẫu store sẵn có (AssetRegistryStore/AlarmStore/HistorianStore): thang migration `PRAGMA user_version`, `%ProgramData%\ST4I\sim\<leaf>`, override bằng env, WAL, kết nối ngắn, **không bao giờ ném lỗi**. Thứ tự phát lại có sẵn nhờ khoá chính tự tăng. |

## Ràng buộc toàn cục (áp cho MỌI task)

- .NET/C# + React/TS như hiện tại. **KHÔNG thêm NuGet mới** (Makaretu chỉ *chuyển chỗ*; `Microsoft.Data.Sqlite` đã có sẵn — implementer tự xác minh trước khi dùng).
- **TUYỆT ĐỐI không sửa SDK dùng chung** `examples/device-client/csharp/St4iDeviceClient.cs`.
- **Không bao giờ ném lỗi vào đường nóng**: spool/advertise/rotation hỏng ⇒ log + đi tiếp, không được làm chết pipeline, bridge hay startup.
- Mọi route mới **phải** thêm vào `RbacPolicyTests.ExpectedRoutes` (bộ quét khớp số lượng chính xác cả hai chiều).
- Lệnh mutate phải qua `PolicyEngine` + `AuditRecorder` theo đúng khuôn `/v1/fleet` & `/v1/line`.
- Store SQLite mới ⇒ **phải cô lập biến môi trường thư mục trong toàn bộ ~11 lớp test WAF** (bài học lặp lại 3 lần: identity, sitelink, alarms). Sau khi chạy full suite, `%ProgramData%\ST4I\sim\` phải **không đổi một byte**.
- Build `dotnet build St4iMachineSimulator.sln -c Debug`; full `St4i.EngineApi.Tests` + `St4i.EdgeCore.Tests` + `St4i.EdgeService.Tests` xanh. Web: `cd web && npm run build` sạch 0 lỗi TS.
- Commit kèm `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Chỉ `git add` file thuộc task của mình.

---

## WI-1 — Chuyển `SiteDiscovery` sang EngineApi + `SiteAdvertiser`

**Mục tiêu:** gọn binary (EdgeService & WPF hết bị kéo theo Makaretu) rồi bổ sung chiều **advertise** để Site tự thấy máy.

### Phần A — chuyển chỗ (làm TRƯỚC, commit riêng)
- Chuyển `src/St4i.EdgeCore/Site/SiteDiscovery.cs` → `src/St4i.EngineApi/Site/SiteDiscovery.cs`, đổi namespace `St4i.EdgeCore.Site` → `St4i.EngineApi.Site`.
- Chuyển `<PackageReference Include="Makaretu.Dns.Multicast.New" Version="0.38.0" />` từ `St4i.EdgeCore.csproj:22` sang `St4i.EngineApi.csproj`.
- **CHỈ chuyển `SiteDiscovery`.** `UnsBridge`, `SiteBridgeManager`, `SiteTrustPin`, `SiteLinkStore`, `BridgeStatus` **ở lại EdgeCore** (EdgeService dùng). Xác minh bằng grep trước khi động tay.
- Chuyển test tương ứng từ `St4i.EdgeCore.Tests` → `St4i.EngineApi.Tests` (nhớ `InternalsVisibleTo` cho `CollectFromMessages`).
- Cập nhật DI ở `Program.cs:498-500` theo namespace mới.
- **Test nghiệm thu bắt buộc:** một test khẳng định thư mục build output của `St4i.EdgeService` và `St4iMachineSimulator` **không còn** `Makaretu.*.dll` / `Common.Logging.dll` (hoặc, nếu khó, một test khẳng định assembly `St4i.EdgeCore` không còn tham chiếu Makaretu). Đây chính là lý do tồn tại của phần A — phải chứng minh, không được nói suông.

### Phần B — `SiteAdvertiser`
`src/St4i.EngineApi/Site/SiteAdvertiser.cs`:
```csharp
public interface ISiteAdvertiser : IAsyncDisposable
{
    bool IsAdvertising { get; }
    void Start();   // không chặn, không bao giờ ném
    Task StopAsync();
}
```
- Kiểu dịch vụ: `_st4i-machine._tcp` (hằng số + env `ST4I_MDNS_SERVICE_TYPE`). **Khác** với `_synapse-site._tcp` mà `SiteDiscovery` đang duyệt — máy quảng bá kiểu của *máy*, Site quảng bá kiểu của *Site*.
- Instance name = `NodeId` đã làm sạch. Cổng = cổng HTTP EngineApi đang lắng nghe (lấy từ cấu hình, không hard-code 5199).
- TXT records: `node=<NodeId>`, `fp=<Fingerprint>`, `site=`, `area=`, `line=`, `cell=` (từ `UnsOptions`), `v=<version assembly>`.
- Dùng `ServiceProfile` + `ServiceDiscovery.Advertise(...)` của Makaretu; giữ `MulticastService` sống suốt vòng đời (khác `DiscoverAsync` vốn dựng/huỷ theo từng lần gọi).
- **Bật/tắt:** mặc định BẬT khi `unsOptions.Enabled`; `ST4I_MDNS_ADVERTISE=0` để tắt. Chạy như `IHostedService` (cái thứ hai trong EngineApi, sau `AlarmEvaluatorService`).
- Hỏng khi khởi động (không có NIC multicast, cổng bị chiếm…) ⇒ log warning, `IsAdvertising=false`, **host vẫn lên bình thường**.

### Test
`SiteAdvertiserTests`: TXT dựng đúng từ `UnsOptions` + identity; env `=0` ⇒ không advertise; `Start()` hai lần vô hại; dispose sạch; hỏng multicast ⇒ không ném. Round-trip thật (advertise rồi tự `SiteDiscovery` duyệt thấy) nếu môi trường cho phép — nếu loopback multicast không ổn định thì đánh dấu và bỏ qua, ghi rõ trong report.

---

## WI-2 — `BridgeSpool` (store SQLite bền, không bao giờ ném)

**Mục tiêu:** hàng đợi bền cho `UnsBridge`, sống qua restart, có seq đơn điệu. Task này **thuần store**, chưa đụng `UnsBridge` (WI-3 mới nối).

`src/St4i.EdgeCore/Site/BridgeSpool.cs` + `BridgeSpoolOptions.cs`:
```csharp
public sealed record SpooledItem(long Seq, string Topic, byte[] Payload, bool Retain, DateTimeOffset EnqueuedUtc);

public interface IBridgeSpool
{
    Task<long> EnqueueAsync(string topic, byte[] payload, bool retain, CancellationToken ct = default);
    Task<IReadOnlyList<SpooledItem>> PeekBatchAsync(int max, CancellationToken ct = default);   // theo seq tăng dần
    Task AckThroughAsync(long seq, CancellationToken ct = default);                              // xoá seq <= mốc
    Task<BridgeSpoolStats> StatsAsync(CancellationToken ct = default);                           // Depth, MinSeq, MaxSeq, DroppedTotal, OldestUtc
    Task<int> TrimAsync(CancellationToken ct = default);                                         // ép trần dung lượng/tuổi, trả về số bản ghi đã bỏ
}
```
- DB riêng `bridge-spool.db` tại `%ProgramData%\ST4I\sim\bridge-spool`, env **`ST4I_BRIDGE_SPOOL_DIR`**.
- Migration v1: `spool(seq INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT NOT NULL, payload BLOB NOT NULL, retain INTEGER NOT NULL, enqueued_at TEXT NOT NULL)` + index trên `enqueued_at`; bảng `meta(key TEXT PRIMARY KEY, value TEXT)` giữ `dropped_total` (đếm luỹ kế, **phải sống qua restart** để bản ghi resync trung thực).
- `BridgeSpoolOptions.FromEnvironment()`: `ST4I_BRIDGE_SPOOL_ENABLED` (mặc định `true`), `ST4I_BRIDGE_SPOOL_DIR`, `ST4I_BRIDGE_SPOOL_MAX_BYTES` (mặc định 64 MB), `ST4I_BRIDGE_SPOOL_MAX_AGE_HOURS` (mặc định **48** — thoả "≥24h" của §3.2). Giá trị không parse được ⇒ dùng mặc định (khuôn `WalOptions.FromEnvironment`).
- `TrimAsync`: quá tuổi HOẶC quá dung lượng ⇒ **bỏ bản ghi CŨ NHẤT trước** (drop-oldest, giống `WalMaintenance`), cộng dồn `dropped_total`.
- **Không bao giờ ném**: mọi phương thức bọc try/catch → `logError` → trả về giá trị an toàn (`EnqueueAsync` trả `-1`, `PeekBatchAsync` trả rỗng…). Đĩa đầy / DB khoá / thư mục hỏng đều không được nổi lên tới bridge.

### Test — `tests/St4i.EdgeCore.Tests/Site/BridgeSpoolTests.cs`
enqueue→peek đúng thứ tự seq; ack cắt đúng tiền tố, phần sau còn nguyên; **bền qua restart** (dựng store mới trên cùng thư mục ⇒ vẫn thấy bản ghi + seq tiếp tục tăng, không quay về 0); trim theo dung lượng và theo tuổi đều bỏ cũ trước và cộng `dropped_total`; `dropped_total` sống qua restart; payload nhị phân (protobuf Sparkplug) đi về nguyên vẹn byte-for-byte; thư mục hỏng ⇒ không ném; đồng thời enqueue nhiều luồng ⇒ seq không trùng.

---

## WI-3 — Nối spool vào `UnsBridge` + seq + bản ghi resync

**Mục tiêu:** bridge không còn vứt dữ liệu khi Site sập; Site phát hiện được lỗ hổng.

Hiện trạng phải sửa — [`UnsBridge.cs:255-257`](../../src/St4i.EdgeCore/Site/UnsBridge.cs): vòng forward dequeue rồi **drop** nếu `_remoteClient.IsConnected == false`.

Kiến trúc mới (giữ nguyên nguyên tắc "không bao giờ chặn phía local"):
```
local MQTT ──► Channel<ForwardItem> (bounded 10k, DropOldest — GIỮ NGUYÊN)
                    │
                    ▼  writer ghi lùi (batch), khuôn HistorianWriter
              BridgeSpool (SQLite, bền)
                    │
                    ▼  vòng forward: chỉ chạy KHI đã nối
              PeekBatch → PublishAsync → AckThrough
```
- `OnLocalMessageReceivedAsync` **giữ nguyên** hành vi enqueue-vào-channel (không được ghi SQLite trên đường nhận MQTT).
- Task ghi lùi drain channel → `EnqueueAsync` theo lô. Channel tràn vẫn DropOldest (đã có) — đó là van an toàn cuối.
- Vòng forward: khi `_remoteClient.IsConnected`, `PeekBatchAsync(N)` → publish lần lượt (QoS `AtLeastOnce`, retain giữ quy tắc `topic.StartsWith("syn/")` hiện có) → `AckThroughAsync(seq cuối publish thành công)`. **Publish lỗi giữa chừng ⇒ chỉ ack tới bản ghi cuối THÀNH CÔNG**, phần còn lại ở nguyên trong spool cho vòng sau.
- Khi mất kết nối: vòng forward **ngủ**, không peek, không ack. Dữ liệu dồn vào spool. `TrimAsync` chạy định kỳ ép trần.
- **Bản ghi resync**: ngay sau khi kết nối lại thành công và TRƯỚC khi phát lại, publish **retained** lên `syn/{site}/{area}/{line}/{cell}/_bridge/resync`:
  `{ resumedAtUtc, backlogDepth, oldestUtc, firstSeq, lastAckedSeq, droppedTotal }`.
  Site nhìn `droppedTotal` tăng ⇒ biết chắc có lỗ hổng và mất bao nhiêu. Dùng đúng bộ serializer JSON của semantic mirror.
- `BridgeStatus` bổ sung `SpoolDepth`, `LastAckedSeq`, `DroppedTotal` để `/v1/site` và web hiển thị.
- **Tương thích ngược:** `ST4I_BRIDGE_SPOOL_ENABLED=0` ⇒ quay về đúng hành vi hôm nay (giữ channel, vứt khi mất kết nối). Phải có test cho nhánh này.

### Test — `tests/St4i.EdgeCore.Tests/Site/UnsBridgeSpoolTests.cs`
Dùng fake spool + fake MQTT client (xem khuôn fake sẵn có trong `UnsBridge` test hiện tại): mất kết nối ⇒ item **không mất**, nằm trong spool; nối lại ⇒ phát lại **đúng thứ tự seq** rồi mới tới item mới; publish lỗi giữa lô ⇒ chỉ ack phần thành công, phần sau phát lại ở vòng kế; bản ghi resync phát **retained, trước** khi phát lại, với `droppedTotal` đúng; spool tắt ⇒ hành vi cũ y nguyên; spool ném lỗi ⇒ bridge vẫn sống.

---

## WI-4 — Xoay vòng chứng thư thiết bị

**Mục tiêu:** chứng thư hiện **mint một lần, hạn 10 năm, không chỗ nào đọc `NotAfter`**. Bổ sung: lộ hạn, xoay vòng theo yêu cầu, cảnh báo sắp hết hạn.

- `DeviceIdentityStore` thêm `public DeviceIdentity Rotate(string nodeId)` — mint mới + `Persist` nguyên tử + trả về identity mới (giữ nguyên khuôn `Create`, **giữ `PersistKeySet`** — đây là bản vá đã kiểm chứng thực nghiệm cho mTLS/schannel, tuyệt đối không đổi sang `EphemeralKeySet`).
- **Vấn đề DI:** `DeviceIdentity` đang đăng ký singleton bất biến ở `Program.cs:484-487`, và `SiteBridgeManager` nhận thẳng `X509Certificate2`. Thêm `DeviceIdentityProvider` (singleton, thread-safe: `Current` + `Rotate()`); `SiteBridgeManager` + `SiteEndpoints` đọc qua provider. Sau khi xoay vòng **phải nạp lại bridge** bằng chứng thư mới (`ApplyAsync` lại link hiện tại) — nếu không, bridge vẫn cầm chứng thư cũ.
- `SiteIdentityDto` thêm `NotAfterUtc`, `DaysToExpiry`.
- `POST /v1/site/identity/rotate` — **Admin**, policy-gated + audited (`site.identity.rotate`), trả về `SiteIdentityDto` mới. Thêm vào `RbacPolicyTests.ExpectedRoutes`.
- **Nối vào AlarmEngine (tận dụng sub-4):** `AlarmEvaluator` thêm nguồn thứ tư — `DaysToExpiry < 30` ⇒ `RaiseAsync(Identity, "EXPIRING", High, …, ClearOnAck:false)`; `< 7` ⇒ `Critical`; xoay vòng xong ⇒ tự `ClearAsync`. Ngưỡng qua `ST4I_IDENTITY_EXPIRY_WARN_DAYS` (mặc định 30). **Lưu ý:** Critical sẽ chặn `line.start`/`line.unhold` qua cổng alarm→hold của LC-3 — đó là hệ quả thật, **phải cân nhắc và ghi rõ**; nếu thấy quá gắt thì để mức cao nhất là `High` và nói rõ lý do trong report.
- **Cảnh báo bảo mật:** xoay vòng làm **đứt tin cậy phía Site** — Site đang pin fingerprint cũ. Endpoint phải trả kèm fingerprint mới và README phải mô tả đúng quy trình 2 bước (xoay vòng ⇒ dán lại fingerprint ở Site). Không được để người dùng tự sập kết nối mà không biết vì sao.

### Test
`Rotate` sinh chứng thư khác (fingerprint đổi) và nạp lại được từ đĩa; provider trả bản mới sau xoay vòng; endpoint 403 với non-Admin, 200 + audit row với Admin; `DaysToExpiry` tính đúng; evaluator raise/clear đúng ngưỡng; bridge dùng chứng thư mới sau xoay vòng.

---

## WI-5 — Verb `--reset-admin-password` (khôi phục khi bị khoá ngoài)

**Mục tiêu:** hôm nay **mọi** đường đổi mật khẩu đều sau cổng Admin đã đăng nhập (`UserEndpoints.cs:70`) ⇒ mất hết tài khoản Admin là hết đường vào. Cách chữa đang ghi trong README chỉ là "tạo sẵn ≥2 Admin".

- File mới `src/St4i.EngineApi/ServiceHost/AdminRecoveryVerbs.cs` (KHÔNG nhét vào `ServiceInstallVerbs` — file đó thuộc về dịch vụ Windows). Gọi từ cùng chỗ chặn ở `Program.cs:28`, **trước** `WebApplication.CreateBuilder` — verb không được đụng Kestrel/DataProtection.
- Cú pháp: `--reset-admin-password <username> [--password <pw>]`. Thiếu `--password` ⇒ sinh mật khẩu mạnh ngẫu nhiên và in ra stdout.
- Hành vi: user tồn tại ⇒ `SetPasswordHashAsync(id, hash, bumpStamp: true)` (huỷ mọi phiên đang mở) **và** nâng role lên `Roles.Admin` nếu chưa phải; không tồn tại ⇒ `CreateAsync(..., Roles.Admin, createdBy: "console-recovery")`.
- Băm bằng đúng `PasswordHasher<AppUser>` như `AuthEndpoints.cs:76-77` — **không tự chế thuật toán băm**.
- Ghi một dòng audit (actor `console-recovery`) vào chuỗi hash cùng `security.db`.
- Đọc thư mục DB qua `SecurityDb.ResolveRoot()` (tôn trọng `ST4I_SECURITY_DIR`).
- **Mô hình đe doạ phải nói thật trong README §14.7:** ai chạy được exe trên máy này thì chiếm được ứng dụng. Đó là **đúng chủ ý** (chính là mục đích khôi phục), và ranh giới thật là ACL của `%ProgramData%\ST4I\sim\security` + quyền đăng nhập Windows — **không phải** lớp auth của ứng dụng. Viết thẳng, không tô hồng.

### Test
Verb đổi được mật khẩu (đăng nhập bằng mật khẩu mới qua WAF thành công, mật khẩu cũ thất bại); `bumpStamp` làm cookie cũ hết hiệu lực; user chưa có ⇒ tạo mới với role Admin; sinh mật khẩu ngẫu nhiên đủ mạnh; thiếu tham số ⇒ thoát với mã lỗi + hướng dẫn; **không** dựng web host. Cô lập `ST4I_SECURITY_DIR`.

---

## WI-6 — Trả nợ vặt (cơ khí, gộp một task)

1. **WPF `MachineViewModel`** — thay khuôn `is IConvertible` + `.ToDouble(null)` bằng `St4i.EdgeCore.Models.TelemetryNumeric.TryGet` tại **2 chỗ**: [`MachineViewModel.cs:260`](../../src/St4iMachineSimulator/ViewModels/MachineViewModel.cs#L260) và [`:323`](../../src/St4iMachineSimulator/ViewModels/MachineViewModel.cs#L323). Project đã tham chiếu EdgeCore sẵn, không cần thêm reference. Đây đúng là con bug đã giết slot OPC-UA ở OU-1 (`"RUNNING"` là `IConvertible` ⇒ `Convert.ToDouble` ném). Kèm test hồi quy: reading có telemetry chuỗi không-số ⇒ không ném, giá trị bị bỏ qua.
2. **xslt khớp chính xác** — [`exclude-shell-and-engine-exe.xslt:32-41`](../../packaging/installer/exclude-shell-and-engine-exe.xslt#L32-L41) đang dùng `contains(@Source, 'St4i.EngineApi.exe')`. Đổi sang khuôn "kết thúc bằng" của XSLT 1.0, có kèm dấu phân cách đường dẫn: `substring(@Source, string-length(@Source) - string-length('\St4i.EngineApi.exe') + 1) = '\St4i.EngineApi.exe'`. Áp cho cả hai exe, cả `Component` lẫn `ComponentRef`. **Bắt buộc build lại MSI thật** để chứng minh không hỏng harvest (WS-F1 đã dựng được MSI thật — làm lại đúng quy trình đó).
3. **Tiền-kiểm `--install`** — [`ServiceInstallVerbs.cs:89-120`](../../src/St4i.EngineApi/ServiceHost/ServiceInstallVerbs.cs#L89-L120) gọi thẳng `sc.exe create`; nếu MSI đã đăng ký `St4iEngineApi` thì lỗi thô "service already exists". Thêm truy vấn trước (`sc.exe query` hoặc `ServiceController`): đã tồn tại ⇒ in thông điệp rõ ("dịch vụ đã được đăng ký, có thể do tính năng MSI — chọn MỘT cơ chế") + mã thoát riêng, **không** gọi `create`. Hằng tên dịch vụ dùng `ServiceHostConstants.ServiceName`.
4. **Sửa đính chính trong báo cáo** — dòng nợ vặt ở `docs/SYNAPSE_GAP_AND_MIDDLEWARE_ROADMAP_2026-07-26.md` §0-bis.4 ghi nhầm "remove-data.ps1 khớp xslt mong manh"; `remove-data.ps1` không hề có xslt. Sửa thành `exclude-shell-and-engine-exe.xslt`.

---

## WI-7 — Web + tài liệu + baselines

- **Trang `/site`**: thẻ identity thêm hạn (`NotAfterUtc`, `DaysToExpiry`, đổi màu khi <30 ngày) + nút **Rotate** (chỉ Admin, có hộp xác nhận nêu rõ *"Site sẽ mất tin cậy cho tới khi bạn dán lại fingerprint mới"*); thẻ bridge thêm `SpoolDepth` / `LastAckedSeq` / `DroppedTotal`; hiển thị trạng thái advertise. i18n **vi + en** (parity ép bởi compiler qua `Dictionary = typeof vi`).
- **README**: mở rộng §17 — advertise (nêu **rõ đây là hành vi mạng mới, mặc định bật**, cách tắt), spool/reconciliation (env, trần dung lượng/tuổi, ý nghĩa bản ghi resync), xoay vòng chứng thư (quy trình 2 bước với Site). Cập nhật §14.7 (khôi phục khi bị khoá — mô hình đe doạ thật). Cập nhật §12 roadmap + §0-bis của báo cáo.
- Regen visual baselines nếu `/site` đổi bố cục (`npx playwright test <spec> --update-snapshots` — **lọc spec TRƯỚC, cờ ĐẶT SAU**; kill Vite cũ trên :5173 trước khi regen).

---

## Nghiệm thu cả đợt

1. `St4i.EdgeService` và `St4iMachineSimulator` build ra **không còn** Makaretu; máy tự quảng bá `_st4i-machine._tcp` và tắt được bằng env.
2. Rút cáp Site → bridge dồn vào spool trên đĩa; **khởi động lại tiến trình**; cắm lại → phát lại đúng thứ tự, không mất bản ghi trong hạn mức, và bản ghi resync nói đúng số đã mất.
3. Xoay vòng chứng thư từ web; bridge dùng chứng thư mới; alarm sắp-hết-hạn lên rồi tự tắt.
4. Khoá hết tài khoản Admin → `--reset-admin-password` lấy lại quyền vào.
5. Full .NET suite + web build + baselines xanh; `%ProgramData%\ST4I\sim\` không đổi byte nào sau khi chạy test.
