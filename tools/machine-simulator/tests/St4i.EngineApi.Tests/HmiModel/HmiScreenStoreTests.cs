using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using St4i.EngineApi.HmiModel;
using St4i.EngineApi.Tests.Auth;
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.EngineApi.Tests.HmiModel;

/// <summary>
/// Kho màn hình có phiên bản.
///
/// <para><b>KHÔNG đo cái gì:</b> (1) không đo tính hợp lệ theo JSON Schema — đó là
/// <c>check-contracts.mjs</c> và các bài Mốc 0; ở đây chỉ đo bất biến do
/// <c>ContractInvariants</c> thi hành; (2) không đo phân quyền — đó là tầng auth và
/// <c>HmiScreenEndpointsTests</c>.</para>
///
/// <para>📎 🔴 <b>Fix round 1's paragraph — RÚT, fix round 2, giữ nguyên văn — SAI cả ba chỗ, đo bằng
/// một probe khác cho ra kết quả ngược lại.</b> Đoạn ngay trên (bản round-1) đọc: <i>"</i>
/// <see cref="HmiScreenStore.PutAsync"/><i> mở một kết nối MỚI mỗi lần gọi và đọc <c>MAX(version)</c>
/// trước khi ghi — nó không nối tiếp gì cả. Đo bằng một probe hai luồng thật (<c>Task.Run</c> +
/// <c>Barrier</c>, 30 lần lặp, không giữ trong repo) không bắt được va chạm ở mức tranh chấp đó —
/// SQLite/lịch trình hệ điều hành làm cửa sổ đọc-rồi-ghi hẹp trong thực tế. Nhưng cửa sổ đó vẫn có
/// thật khi đọc mã: hai lời gọi </i><see cref="HmiScreenStore.PutAsync"/><i> đồng thời CÓ THỂ cùng
/// đọc một <c>MAX(version)</c>. Cái chúng KHÔNG THỂ làm là cùng ghi thành công cùng một hàng
/// <c>(screen_id, version)</c>: <c>PRIMARY KEY(screen_id, version)</c> trên bảng <c>screens</c> được
/// SQLite đối chiếu với trạng thái ĐÃ COMMIT thật tại thời điểm INSERT chạy, không phải với bản đọc
/// cũ của bên thua — nên bên thua nhận <c>SqliteException</c> (constraint) và toàn bộ transaction
/// của nó cuộn lại, không ghi gì, không mất phiên bản nào, không có con trỏ treo."</i> Sai ba câu, đo
/// từng câu bên dưới — kể cả câu quan sát "0/30 không va chạm" cũng đúng SỰ KIỆN nhưng sai LÝ DO nó
/// đưa ra: cửa sổ không "hẹp trong thực tế", nó BỊ ĐÓNG bởi <c>BEGIN IMMEDIATE</c>, nên 30 lần lặp
/// không thấy gì vì không có gì để thấy.</para>
///
/// <para>🔴 <b>Cơ chế THẬT, đo bằng kết nối thô và một race ép mở, không đọc mã suông.</b>
/// <c>connection.BeginTransaction()</c> gọi không tham số trong <c>Microsoft.Data.Sqlite</c> phân
/// giải thành <c>BeginTransaction(IsolationLevel.Serializable, deferred: false)</c> — tức
/// <c>BEGIN IMMEDIATE</c>, không phải <c>deferred</c> như hai bản trước (round-0 và round-1) cùng
/// giả định. Đo trực tiếp: một kết nối B gọi <c>BeginTransaction()</c> trong lúc kết nối A đang giữ
/// một transaction ném ngay <c>SqliteException | SqliteErrorCode=5</c> ("database is locked") —
/// nghĩa là A giữ khoá GHI ngay tại <c>BEGIN</c>, TRƯỚC khi <c>SELECT MAX(version)</c>
/// (<see cref="HmiScreenStore.PutAsync"/>) từng chạy. <b>Hai lời gọi <c>PutAsync</c> đồng thời KHÔNG
/// THỂ cùng đọc một <c>MAX(version)</c></b> — bên thứ hai chặn ngay tại <c>BEGIN</c> tới khi bên thứ
/// nhất commit, rồi mới đọc <c>MAX</c> đã cập nhật. Đo trên tranh chấp thật: 8 luồng × 30 lần
/// <c>PutAsync</c> trên CÙNG một <c>screenId</c> → 240 lần trả về, <b>0 lần ném</b>, dãy phiên bản
/// liên tục 1..240 không trùng không thiếu, đúng MỘT <c>IsCurrent</c>. Kho THẬT SỰ nối tiếp — nhưng
/// bởi khoá ghi <c>BEGIN IMMEDIATE</c> của SQLite cộng <c>PRAGMA busy_timeout=5000</c>, không phải
/// "không nối tiếp gì" (câu SAI của round-1) và không phải <c>PRIMARY KEY</c> (câu SAI THỨ HAI của
/// round-1). <c>PRIMARY KEY(screen_id, version)</c> KHÔNG BAO GIỜ nổ trên đường này: ép mở race bằng
/// một transaction <c>deferred: true</c> tường minh trên CẢ HAI kết nối (thế giới mà câu round-1 MÔ
/// TẢ, không phải thế giới <c>PutAsync</c> thật tạo ra) cho bên thua
/// <c>SqliteException | SqliteErrorCode=5 Extended=517</c> (<c>SQLITE_BUSY_SNAPSHOT</c> — WAL từ
/// chối nâng một read-transaction lên write-transaction sau khi một kết nối khác đã commit dưới nó),
/// KHÔNG PHẢI lỗi 19/1555 mà một vi phạm khoá chính sẽ ném. Trong tranh chấp THẬT (không ép mở),
/// <c>PutAsync</c> nhận <c>SqliteErrorCode=5 Extended=5</c> (<c>SQLITE_BUSY</c> trần) từ chính
/// <c>BEGIN</c>, không phải từ <c>INSERT</c>. Cả ba trường hợp: không phiên bản nào mất hay hỏng —
/// lịch sử nguyên vẹn, con trỏ đúng và duy nhất, <c>GetAsync(id, 1)</c> vẫn phục vụ tài liệu cũ, và
/// lần <c>PutAsync</c> tiếp theo tiếp tục đúng dãy số.</para>
///
/// <para>🔴 <b>Cái store KHÔNG làm, đo bằng cách giữ khoá ghi 34 giây — dành cho ai đọc trước Task
/// 3.</b> Giữ khoá ghi trên một kết nối ngoài lâu hơn <c>busy_timeout</c> rồi gọi <c>PutAsync</c>
/// THẬT: sau <b>~34 giây</b> (34,4 s và 34,1 s ở hai lần đo, ~gấp bảy <c>busy_timeout=5000</c>ms cấu
/// hình), <c>PutAsync</c> ném <c>SqliteException(SqliteErrorCode=5)</c> — từ <c>BeginTransaction()</c>,
/// TRƯỚC bất kỳ lần đọc nào. <c>src/</c> không có <c>UseExceptionHandler</c>, không
/// <c>IExceptionHandler</c>, không ánh xạ <c>ProblemDetails</c> nào (không khớp cả ba khi grep) — nên
/// một handler Task 3 lấy <see cref="HmiScreenStore"/> mà không tự bắt lỗi này để lộ
/// <c>SqliteException</c> ra ngoài pipeline mặc định của ASP.NET Core thành <b>HTTP 500 thân rỗng,
/// sau khi giữ luồng request ~34 giây</b>. <b>Một
/// <c>catch (SqliteException ex) when (…khoá chính…)</c> ánh xạ sang 409 — đúng khuôn
/// <c>HmiTagEndpoints.cs:161</c> đã dùng cho một ràng buộc khoá thật — sẽ là CATCH CHẾT ở đây</b>: lỗi
/// khoá chính không bao giờ tới; lỗi tranh chấp thật là <c>SQLITE_BUSY</c>. Task 3 cần bắt
/// <c>SqliteErrorCode == 5</c> (BUSY) riêng, và cần QUYẾT ĐỊNH người vận hành thấy gì thay vì một màn
/// hình trắng 34 giây rồi 500 — câu này ghi lại làm một GHI CHÚ cho việc đó, không phải một lời hứa
/// rằng nó đã được xử lý.</para>
///
/// <para><b><see cref="SecurityEnvVarTests.CollectionName"/> membership:</b> every test here opens a real
/// <c>Microsoft.Data.Sqlite</c> connection through <see cref="HmiScreenStore"/>. 🔴 <b>Fix round 1 —
/// "seven classes... call" was imprecise and is now stated as two measured numbers, not one guessed
/// one.</b> A plain-text scan for the literal <c>SqliteConnection.ClearAllPools</c> across
/// <c>St4i.EngineApi.Tests</c> finds it in <b>28 files</b> (a mix of the classes that actually invoke it
/// and classes, like this one, whose own <c>[Collection]</c> justification names the mechanism in
/// prose); of those, <b>7 files invoke it as a statement</b> (17 call sites) —
/// <c>AssetRegistryStoreTests</c>, <c>AlarmStoreTests</c>, <c>LocalAnnunciationChannelTests</c>,
/// <c>NotificationConfigStoreTests</c>, <c>NotificationEndpointsTests</c>,
/// <c>WebhookNotificationChannelTests</c>, <c>SmtpNotificationChannelTests</c>. Those seven are the
/// ones this attribute actually guards against: without <c>[Collection]</c> this class risks
/// <c>ObjectDisposedException: SQLitePCL.sqlite3</c> if one of THEM disposes the process-wide pool
/// while a connection here is open, and nothing here would go red to say so.</para>
///
/// <para><b>Isolation.</b> Same pattern as <c>TagNamespaceStoreTests</c>: a per-test-class temp directory
/// under <see cref="Path.GetTempPath"/> (already redirected away from the real <c>%TEMP%</c> by
/// <c>TestRunTempRoot</c>'s module initializer), passed explicitly to the store's constructor and removed
/// by this class's own <c>IDisposable.Dispose</c>.</para>
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public class HmiScreenStoreTests : IDisposable
{
    readonly string _dir = Path.Combine(Path.GetTempPath(), "st4i-hmi-screens-" + Guid.NewGuid().ToString("N"));

    void IDisposable.Dispose() { try { Directory.Delete(_dir, true); } catch { } }

    HmiScreenStore NewStore() => new(_dir);

    [Fact]
    public async Task PutAsync_ReturnsIncrementingVersions_AndGetWithoutVersionServesTheLatest()
    {
        var store = NewStore();

        var v1 = await store.PutAsync(Screen("line-overview", "Tổng quan"));
        var v2 = await store.PutAsync(Screen("line-overview", "Tổng quan sửa"));

        Assert.Equal(1, v1);
        Assert.Equal(2, v2);
        var current = await store.GetAsync("line-overview");
        Assert.Equal("Tổng quan sửa", current!.Title);
    }

    [Fact]
    public async Task GetAsync_WithAnExplicitVersion_ServesThatVersion_NotTheLatest()
    {
        var store = NewStore();
        await store.PutAsync(Screen("line-overview", "một"));
        await store.PutAsync(Screen("line-overview", "hai"));

        var old = await store.GetAsync("line-overview", version: 1);
        Assert.Equal("một", old!.Title);
    }

    [Fact]
    public async Task RollbackAsync_MakesTheOldVersionCurrent_ByAppendingIt_NeverByDeletingHistory()
    {
        var store = NewStore();
        await store.PutAsync(Screen("line-overview", "một"));
        await store.PutAsync(Screen("line-overview", "hai"));

        var v3 = await store.RollbackAsync("line-overview", toVersion: 1);

        Assert.Equal(3, v3);
        Assert.Equal("một", (await store.GetAsync("line-overview"))!.Title);
        // Lịch sử không bị xoá: cả ba phiên bản vẫn liệt kê được.
        var versions = await store.ListVersionsAsync("line-overview");
        Assert.Equal(new[] { 1, 2, 3 }, versions.Select(v => v.Version).ToArray());
    }

    [Fact]
    public async Task PutAsync_WithAScreenViolatingSection5_ThrowsAndWritesNothing()
    {
        var store = NewStore();
        var bad = Screen("bad-screen", "x") with { Widgets = new[] { new ScreenWidget(null!, "readout", Rect()) } };

        await Assert.ThrowsAsync<ContractViolationException>(() => store.PutAsync(bad));

        Assert.Empty(await store.ListScreenIdsAsync());
    }

    [Fact]
    public async Task GetAsync_ForAScreenNobodyDeclared_ReturnsNull_NotAnError()
    {
        var store = NewStore();
        Assert.Null(await store.GetAsync("never-declared"));
    }

    [Fact]
    public async Task ListVersionsAsync_MarksExactlyOneVersionAsCurrent_AndItIsTheOneJustWritten()
    {
        var store = NewStore();
        await store.PutAsync(Screen("line-overview", "một"));
        await store.PutAsync(Screen("line-overview", "hai"));
        await store.PutAsync(Screen("line-overview", "ba"));

        var versions = await store.ListVersionsAsync("line-overview");

        // Đúng MỘT phần tử IsCurrent=true, và đó là phiên bản 3 (vừa ghi) — không phải phiên bản 1.
        // Một bản IsCurrent bị đảo (currentVersion == version -> !=) sẽ đánh dấu SAI hai phiên bản
        // cũ và bỏ sót phiên bản thật đang hiện hành, nhưng đi qua im lặng nếu không có bài nào đọc
        // cột này — đây là bài đọc nó.
        var current = Assert.Single(versions, v => v.IsCurrent);
        Assert.Equal(3, current.Version);
        Assert.All(versions.Where(v => v.Version != 3), v => Assert.False(v.IsCurrent));
    }

    [Fact]
    public async Task ListVersionsAsync_SavedAtUtc_IsARealRecentIsoTimestamp_PerVersion()
    {
        var store = NewStore();
        var before = DateTimeOffset.UtcNow.AddSeconds(-5);
        await store.PutAsync(Screen("line-overview", "một"));
        await store.PutAsync(Screen("line-overview", "hai"));
        var after = DateTimeOffset.UtcNow.AddSeconds(5);

        var versions = await store.ListVersionsAsync("line-overview");

        Assert.Equal(2, versions.Count);
        foreach (var v in versions)
        {
            // Một chuỗi hằng (vd. "") hay sai định dạng làm Parse ném — bài này đỏ ngay ở đó. Một
            // mốc giờ không nằm trong khoảng [before, after] báo rằng saved_at không phải giờ ghi
            // thật, dù vẫn parse được.
            var parsed = DateTimeOffset.Parse(v.SavedAtUtc, System.Globalization.CultureInfo.InvariantCulture);
            Assert.InRange(parsed, before, after);
        }
    }

    [Fact]
    public async Task ListScreenIdsAsync_ReturnsEveryDeclaredId_InAscendingOrdinalOrder()
    {
        var store = NewStore();
        // Cố ý ghi KHÔNG theo thứ tự chữ cái, để một ORDER BY bị đảo (DESC) hay bị bỏ (thứ tự chèn)
        // đều làm bài này đỏ.
        await store.PutAsync(Screen("zebra-line", "z"));
        await store.PutAsync(Screen("alpha-line", "a"));
        await store.PutAsync(Screen("mango-line", "m"));

        var ids = await store.ListScreenIdsAsync();

        Assert.Equal(new[] { "alpha-line", "mango-line", "zebra-line" }, ids);
    }

    [Fact]
    public async Task RollbackAsync_ToAVersionThatNeverExisted_ThrowsNamingTheRealVersionNumbers()
    {
        var store = NewStore();
        await store.PutAsync(Screen("line-overview", "một"));
        await store.PutAsync(Screen("line-overview", "hai"));

        var ex = await Assert.ThrowsAsync<ArgumentOutOfRangeException>(
            () => store.RollbackAsync("line-overview", toVersion: 99));

        // Bước 4 của brief: thông điệp phải NÊU số phiên bản có thật, không chỉ nói "không hợp lệ".
        // 🔴 Fix round 2 — Assert.Contains("99", ...) bị RÚT: ArgumentOutOfRangeException tự nối thêm
        // "Actual value was 99." vào cuối message, nên "99" luôn có mặt BẤT KỂ store nói gì — assertion
        // ấy không thể đỏ. Hai dòng dưới khớp đúng CỤM CHỮ store tự viết (bao gồm cả số phiên bản có
        // thật), không phải một chữ số rời có thể trùng ngẫu nhiên với đuôi message của framework.
        Assert.Contains("không có phiên bản 99", ex.Message);
        Assert.Contains("Phiên bản có thật: 1, 2", ex.Message);
    }

    [Fact]
    public async Task RollbackAsync_OnAScreenNobodyDeclared_ThrowsSayingNoVersionExists()
    {
        var store = NewStore();

        var ex = await Assert.ThrowsAsync<ArgumentOutOfRangeException>(
            () => store.RollbackAsync("never-declared", toVersion: 1));

        Assert.Contains("never-declared", ex.Message);
        // 🔴 Fix round 2 — tên bài hứa "SayingNoVersionExists" nhưng bài cũ chỉ đo screenId, nên một
        // message bị tước sạch cụm "Phiên bản có thật: không có phiên bản nào" vẫn qua (đo được:
        // stripping đúng cụm đó để lại bài này XANH). Khớp đúng cụm chữ store tự viết cho trường hợp
        // rỗng, không chỉ tên màn hình.
        Assert.Contains("Phiên bản có thật: không có phiên bản nào", ex.Message);
    }

    static HmiScreenDocument Screen(string id, string title) => new(
        1, id, title, null, "isa101",
        new ScreenLayout(12, 8, "panel"),
        new[] { new ScreenWidget("w1", "label", Rect()) });

    static WidgetRect Rect() => new(0, 0, 2, 1);
}

/// <summary>
/// WS-HMI-2 Task 2 — <c>screenId</c> identity at the <see cref="IHmiScreenStore"/> seam:
/// <see cref="CanonicalizingHmiScreenStore"/> resolves from DI as the ONLY thing
/// <see cref="IHmiScreenStore"/> ever hands out, and every method that sees a <c>screenId</c>
/// canonicalises it before the inner (possibly raw) store ever sees it — the same law
/// <c>CanonicalMachineCodeStoresTests</c> pins for machine-code identity, applied here to a different
/// field with a different rule (see <c>CanonicalScreenStore.cs</c>'s own doc comment for the measurement
/// behind <b>Trim only, no case fold</b>).
///
/// <para><b>What this class does NOT measure:</b> (1) that <see cref="HmiScreenStore"/> itself round-trips
/// a document correctly — that is <see cref="HmiScreenStoreTests"/> above; (2) JSON Schema conformance of
/// <c>screenId</c>'s <c>^[a-z0-9-]+$</c> pattern — nothing in this repository's C# runtime enforces that
/// pattern today (measured in <c>CanonicalScreenStore.cs</c>'s doc comment: zero regex checks in
/// <c>ContractInvariants.Validate(HmiScreenDocument)</c>), and this class does not paper over that gap by
/// pretending the decorator folds case — it deliberately does not; (3) an HTTP surface for screens — none
/// exists yet, that is WS-HMI-2 Task 3's job.</para>
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class CanonicalizingHmiScreenStoreTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);

    /// <summary>Same "force Production, eager-build while the override is live" idiom
    /// <c>HmiModelWiringTests.CreateFactoryAsync</c> already uses, duplicated for the same reason that
    /// class duplicates it from <c>AuthPipelineTests</c>/<c>RbacPolicyTests</c>: each is private to its own
    /// class. This class does not isolate <c>ST4I_HMI_SCREENS_DIR</c> itself — <c>TestRunTempRoot</c>'s
    /// module initializer already redirects it (same as every other leaf).
    ///
    /// <para>🔴 <b>"NEVER TOUCHING THE DATABASE" — RETRACTED, WS-HMI-2 Task 2 fix round 1, kept verbatim
    /// above.</b> <c>GetRequiredService&lt;IHmiScreenStore&gt;()</c> below is the FIRST resolution of that
    /// singleton factory, and the factory's lambda runs <c>new HmiScreenStore(dir)</c>, whose constructor
    /// calls <c>EnsureSchema()</c> unconditionally — a real <c>SqliteConnection</c> opens and
    /// <c>hmi-screens.db</c>/<c>-shm</c>/<c>-wal</c> are created on disk. Measured, not assumed: they
    /// appear under <c>TestRunTempRoot</c>'s redirected temp directory the moment this test's
    /// <c>GetRequiredService</c> call runs. What the corrected sentence should have said: the database IS
    /// touched, but it is touched inside this run's ISOLATED temp directory (never real
    /// <c>%ProgramData%</c>), and this test asks only which CONCRETE TYPE was resolved, not what is inside
    /// the file that touch created.</para></summary>
    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync()
    {
        await EnvLock.WaitAsync().ConfigureAwait(false);
        var prevEnvironment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
        try
        {
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Production");
            var factory = new WebApplicationFactory<Program>();
            _ = factory.Server; // force the host to build NOW, while the override above is still live.
            return factory;
        }
        finally
        {
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", prevEnvironment);
            EnvLock.Release();
        }
    }

    [Fact]
    public async Task TheScreenStoreResolvedFromDi_IsTheCanonicalizingDecorator_NeverTheRawStore()
    {
        // Does NOT measure that the decorator canonicalises correctly when driven — that is every test
        // below, against the decorator directly. This measures only WHICH CONCRETE TYPE Program.cs's DI
        // container hands back for IHmiScreenStore, the same structural property
        // HmiModelWiringTests/HmiModelEndpointsTests pin for IComponentModelStore/ITagNamespaceStore.
        // 🔴 No .ConfigureAwait(false) on this line, deliberately — xUnit1030: a test method that calls
        // ConfigureAwait(false) can bypass xUnit's parallelization limits. CreateFactoryAsync's OWN body
        // still uses it (that method is not a test method), same as every other CreateFactoryAsync in this
        // assembly.
        await using var factory = await CreateFactoryAsync();
        var store = factory.Services.GetRequiredService<IHmiScreenStore>();
        Assert.IsType<CanonicalizingHmiScreenStore>(store);
    }

    // ─────────────────────────────────────────────────────────────────────
    // RecordingScreenStore — records what it received and decides nothing. WS-HMI-0b learned that a
    // double which re-implements the predicate under test (trimming, version bookkeeping, ...) ends up
    // certifying itself rather than the decorator in front of it: every method here just appends to
    // `Calls` and returns a fixed, uninteresting value.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>🔴 <b>WS-HMI-2 Task 2 fix round 1 (review MED-1) — gained a Dictionary, still decides
    /// nothing.</b> Testing the canonical-miss fallback (below) needs SOME way to reproduce "a row exists
    /// at a spelling the caller did not ask for", and a <c>Calls</c>-only double with no state cannot
    /// represent that at all. The dictionary is exact-match, Ordinal-keyed — the SAME shape
    /// <c>CanonicalMachineCodeStoresTests.RecordingComponentModelStore</c> already uses for the identical
    /// reason — and every method still does nothing but look itself up or insert itself: no trimming, no
    /// case folding, no resolution across spellings. THAT logic lives only in
    /// <see cref="CanonicalizingHmiScreenStore"/>, which is the whole point — a double that resolved
    /// spellings itself would certify itself instead of the decorator in front of it.</summary>
    private sealed class RecordingScreenStore : IHmiScreenStore
    {
        public List<string> Calls { get; } = new();

        private readonly Dictionary<string, HmiScreenDocument> _rows = new(StringComparer.Ordinal);

        /// <summary>Seeds a row at a VERBATIM (possibly non-canonical) key — the only way to reproduce a
        /// row written by a direct <c>new HmiScreenStore(dir)</c> caller bypassing
        /// <see cref="ContractInvariants"/> entirely, which is exactly how such a row can exist after this
        /// round's <c>ContractInvariants.Validate(HmiScreenDocument)</c> pattern check closes the
        /// write-door reproduction MED-1's own probe originally used.</summary>
        public void SeedRaw(string storedScreenId, HmiScreenDocument doc) => _rows[storedScreenId] = doc;

        public Task<HmiScreenDocument?> GetAsync(string screenId, int? version = null, CancellationToken ct = default)
        {
            Calls.Add($"Get:{screenId}:{(version.HasValue ? version.Value.ToString() : "null")}");
            return Task.FromResult(screenId is not null && _rows.TryGetValue(screenId, out var doc) ? doc : null);
        }

        public Task<int> PutAsync(HmiScreenDocument doc, CancellationToken ct = default)
        {
            Calls.Add($"Put:{doc.ScreenId}");
            _rows[doc.ScreenId] = doc;
            return Task.FromResult(1);
        }

        public Task<IReadOnlyList<string>> ListScreenIdsAsync(CancellationToken ct = default)
        {
            Calls.Add("List:");
            return Task.FromResult<IReadOnlyList<string>>(_rows.Keys.OrderBy(k => k, StringComparer.Ordinal).ToList());
        }

        public Task<IReadOnlyList<ScreenVersionInfo>> ListVersionsAsync(string screenId, CancellationToken ct = default)
        {
            Calls.Add($"ListVersions:{screenId}");
            IReadOnlyList<ScreenVersionInfo> result = screenId is not null && _rows.ContainsKey(screenId)
                ? new[] { new ScreenVersionInfo(1, "2026-01-01T00:00:00.0000000Z", true) }
                : Array.Empty<ScreenVersionInfo>();
            return Task.FromResult(result);
        }

        /// <summary>Throws exactly like the real <see cref="HmiScreenStore.RollbackAsync"/> does for a
        /// screen nobody declared under this spelling — required so
        /// <see cref="CanonicalizingHmiScreenStore.RollbackAsync"/>'s catch-and-retry fallback has
        /// something real to catch. Does NOT check <paramref name="toVersion"/> against real history (this
        /// double keeps none) — presence of the row is the only thing simulated.</summary>
        public Task<int> RollbackAsync(string screenId, int toVersion, CancellationToken ct = default)
        {
            Calls.Add($"Rollback:{screenId}:{toVersion}");
            if (screenId is null || !_rows.ContainsKey(screenId))
            {
                throw new ArgumentOutOfRangeException(nameof(toVersion), toVersion, $"no such screen '{screenId}'");
            }

            return Task.FromResult(2);
        }
    }

    static HmiScreenDocument Screen(string id, string title) => new(
        1, id, title, null, "isa101",
        new ScreenLayout(12, 8, "panel"),
        new[] { new ScreenWidget("w1", "label", Rect()) });

    static WidgetRect Rect() => new(0, 0, 2, 1);

    // ─────────────────────────────────────────────────────────────────────
    // Every method's disposition, measured against RecordingScreenStore — not merely declared.
    // ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("  line-overview  ")]
    [InlineData("line-overview")]
    public async Task EveryMethodOfTheDecorator_TrimsTheScreenId_SoOneScreenIsOneRow(string spelling)
    {
        // Does NOT measure GetAsync/ListVersionsAsync/RollbackAsync/ListScreenIdsAsync's own dispositions —
        // each has its own probe below. This is PutAsync's: doc.ScreenId IS the SQLite primary key
        // (screens/screen_current, both `screen_id TEXT` with no COLLATE NOCASE and no trimming of their
        // own — verified against HmiScreenStore's migration DDL), so writing it un-trimmed is how one
        // screen, saved twice with stray whitespace, becomes two rows.
        var inner = new RecordingScreenStore();
        var store = new CanonicalizingHmiScreenStore(inner);
        await store.PutAsync(Screen(spelling, "x"));
        Assert.Equal(new[] { "Put:line-overview" }, inner.Calls);
    }

    [Fact]
    public async Task GetAsync_TrimsTheScreenId_AndForwardsTheVersionUnchanged()
    {
        // Does NOT measure the `version` parameter's own handling beyond "unchanged" — version is not an
        // identity value this decorator has any opinion about, only screenId is. Does NOT measure the
        // canonical-miss fallback either — that needs a row seeded at a NON-canonical spelling, which is a
        // separate scenario covered below (MED-1). Seeded at the CANONICAL spelling here specifically so
        // the canonical lookup HITS on the first try and no fallback call muddies what this test is about.
        var inner = new RecordingScreenStore();
        inner.SeedRaw("line-overview", Screen("line-overview", "x"));
        var store = new CanonicalizingHmiScreenStore(inner);

        await store.GetAsync("  line-overview  ", version: 3);

        Assert.Equal(new[] { "Get:line-overview:3" }, inner.Calls);
    }

    [Fact]
    public async Task ListVersionsAsync_TrimsTheScreenId_BeforeAskingTheInnerStore()
    {
        // Seeded at the canonical spelling for the same reason GetAsync's trim test is — see that test's
        // comment. The canonical-miss fallback is measured separately below (MED-1).
        var inner = new RecordingScreenStore();
        inner.SeedRaw("line-overview", Screen("line-overview", "x"));
        var store = new CanonicalizingHmiScreenStore(inner);

        await store.ListVersionsAsync("  line-overview  ");

        Assert.Equal(new[] { "ListVersions:line-overview" }, inner.Calls);
    }

    [Fact]
    public async Task RollbackAsync_TrimsTheScreenId_AndForwardsToVersionUnchanged()
    {
        // Seeded at the canonical spelling so the first (canonical) RollbackAsync attempt succeeds and the
        // catch-and-retry fallback never engages — that fallback is measured separately below (MED-1).
        var inner = new RecordingScreenStore();
        inner.SeedRaw("line-overview", Screen("line-overview", "x"));
        var store = new CanonicalizingHmiScreenStore(inner);

        await store.RollbackAsync("  line-overview  ", toVersion: 2);

        Assert.Equal(new[] { "Rollback:line-overview:2" }, inner.Calls);
    }

    [Fact]
    public async Task ListScreenIdsAsync_ForwardsAnEmptyList_WhenNothingIsStored()
    {
        // 🔴 RENAMED, WS-HMI-2 Task 2 fix round 1 (review MED-3). This test used to be named
        // "...ForwardsVerbatim_NoScreenIdParameterToCanonicalise" and claimed ListScreenIdsAsync
        // "deliberately does NOT canonicalise-and-dedupe" — a claim this very test could not have caught
        // going false, because an EMPTY inner list canonicalises to an EMPTY list either way. Measured:
        // the old test stayed GREEN after MED-1 made the method canonicalise-and-dedupe for real. This
        // version measures only the trivial case (empty in, empty out, one call) that IS still true; the
        // canonicalise-and-dedupe property itself is
        // ListScreenIdsAsync_CanonicalisesAndDeduplicates_SoTheListNeverNamesAnIdentityGetAsyncCannotServe
        // below.
        var inner = new RecordingScreenStore();
        var store = new CanonicalizingHmiScreenStore(inner);

        var ids = await store.ListScreenIdsAsync();

        Assert.Empty(ids);
        Assert.Equal(new[] { "List:" }, inner.Calls);
    }

    // ─────────────────────────────────────────────────────────────────────
    // MED-1 (review round 1) — every identity the seam NAMES, the seam can SERVE. Before this round: a
    // row written directly (bypassing this round's own ContractInvariants pattern fix — see
    // CanonicalScreenStore.cs's own doc comment for why that closes the reproduction going forward but not
    // the PROPERTY) under a non-canonical (padded) spelling made the list name one identity while
    // GetAsync/ListVersionsAsync answered "never declared" for that exact name and RollbackAsync threw
    // naming a THIRD spelling matching neither. Reproduced and closed here.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ListScreenIdsAsync_CanonicalisesAndDeduplicates_SoTheListNeverNamesAnIdentityGetAsyncCannotServe()
    {
        // Does NOT measure GetAsync's own fallback — the next test does. This measures the OUTPUT half
        // only: a row seeded at a padded, non-canonical spelling is reported under its TRIMMED name, not
        // the raw stored one — mirroring CanonicalizingComponentModelStore.ListMachineCodesAsync's own
        // canonicalise-and-dedupe for the identical reason.
        var inner = new RecordingScreenStore();
        inner.SeedRaw("  padded-screen  ", Screen("padded-screen", "legacy"));
        var store = new CanonicalizingHmiScreenStore(inner);

        var ids = await store.ListScreenIdsAsync();

        Assert.Equal(new[] { "padded-screen" }, ids);
    }

    [Fact]
    public async Task GetAsync_ServesARowStoredUnderANonCanonicalSpelling_ViaTheCanonicalMissFallback()
    {
        // MED-1's own reproduction, reproduced clean: seed a row at a padded spelling directly (the only
        // way such a row can exist once this round's ContractInvariants pattern check closes the
        // write-door reproduction), then ask for it at the CANONICAL spelling — the exact spelling
        // ListScreenIdsAsync above proves the list would report.
        var inner = new RecordingScreenStore();
        inner.SeedRaw("  padded-screen  ", Screen("padded-screen", "legacy"));
        var store = new CanonicalizingHmiScreenStore(inner);

        var doc = await store.GetAsync("padded-screen");

        Assert.True(doc is not null, "the canonical-miss fallback did not serve a row stored under a non-canonical spelling");
        Assert.Equal("padded-screen", doc!.ScreenId);
        // Canonical miss, then the fallback's own resolve-and-retry — exact call trace, so the fallback
        // cannot be silently removed or short-circuited without this reddening.
        Assert.Equal(new[] { "Get:padded-screen:null", "List:", "Get:  padded-screen  :null" }, inner.Calls);
    }

    [Fact]
    public async Task ListVersionsAsync_ServesARowStoredUnderANonCanonicalSpelling_ViaTheCanonicalMissFallback()
    {
        var inner = new RecordingScreenStore();
        inner.SeedRaw("  padded-screen  ", Screen("padded-screen", "legacy"));
        var store = new CanonicalizingHmiScreenStore(inner);

        var versions = await store.ListVersionsAsync("padded-screen");

        Assert.NotEmpty(versions);
        Assert.Equal(new[] { "ListVersions:padded-screen", "List:", "ListVersions:  padded-screen  " }, inner.Calls);
    }

    [Fact]
    public async Task RollbackAsync_ServesARowStoredUnderANonCanonicalSpelling_InsteadOfThrowingNeverDeclared()
    {
        // Does NOT prove the new version is written under the CANONICAL spelling — it is not; see
        // CanonicalScreenStore.cs's own doc comment ("WHAT THE FALLBACK DOES NOT DO") for why not, and why
        // that is judged an acceptable residual rather than fixed here.
        var inner = new RecordingScreenStore();
        inner.SeedRaw("  padded-screen  ", Screen("padded-screen", "legacy"));
        var store = new CanonicalizingHmiScreenStore(inner);

        var newVersion = await store.RollbackAsync("padded-screen", toVersion: 1);

        Assert.True(newVersion > 0);
        Assert.Equal(new[] { "Rollback:padded-screen:1", "List:", "Rollback:  padded-screen  :1" }, inner.Calls);
    }

    [Fact]
    public async Task RollbackAsync_OnAGenuinelyUndeclaredScreen_StillThrowsTheOriginalException()
    {
        // 🔴 The negative control the fallback needs: a canonical miss with NOTHING seeded anywhere must
        // still throw — the fallback resolving to null must fall through to the ORIGINAL exception, not
        // swallow it or manufacture a success. Without this, the catch-and-retry in
        // CanonicalizingHmiScreenStore.RollbackAsync could be replaced by a bare `return 0;` on any
        // exception and every OTHER test in this file would stay green.
        var inner = new RecordingScreenStore();
        var store = new CanonicalizingHmiScreenStore(inner);

        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => store.RollbackAsync("never-declared", toVersion: 1));
    }

    [Fact]
    public async Task EveryMethodAgreesAboutOneRowsIdentity_TheExactPropertyMED1Requires()
    {
        // The property stated directly, as one scenario rather than four isolated probes: every identity
        // ListScreenIdsAsync NAMES, every other method can SERVE. Before this round's fix, measured: the
        // list named "  padded-screen  ", GetAsync/ListVersionsAsync both answered "never declared" for
        // that exact string, and RollbackAsync threw naming a THIRD spelling matching neither.
        var inner = new RecordingScreenStore();
        inner.SeedRaw("  padded-screen  ", Screen("padded-screen", "legacy"));
        var store = new CanonicalizingHmiScreenStore(inner);

        var listed = await store.ListScreenIdsAsync();
        var name = Assert.Single(listed);

        Assert.True(await store.GetAsync(name) is not null, $"GetAsync could not serve '{name}', which the list just reported");
        Assert.NotEmpty(await store.ListVersionsAsync(name));
        Assert.True(await store.RollbackAsync(name, toVersion: 1) > 0, $"RollbackAsync could not serve '{name}', which the list just reported");
    }

    [Fact]
    public async Task PutAsync_WithAWhitespaceOnlyScreenId_ForwardsItUnchanged_LeavingRejectionToContractInvariants()
    {
        // Does NOT measure that ContractInvariants actually rejects a blank screenId — that is
        // HmiScreenStoreTests.PutAsync_WithAScreenViolatingSection5_ThrowsAndWritesNothing (a different §5
        // violation) and ContractInvariantsTests. This measures only that ScreenIdentity.Canonicalize does
        // NOT coerce a whitespace-only screenId to "" or throw — mirroring MachineCodeIdentity's own
        // documented choice for the same reason: whether a blank identity is valid is ContractInvariants'
        // call, not this decorator's.
        var inner = new RecordingScreenStore();
        var store = new CanonicalizingHmiScreenStore(inner);

        await store.PutAsync(Screen("   ", "x"));

        Assert.Equal(new[] { "Put:   " }, inner.Calls);
    }

    [Fact]
    public async Task GetAsync_WithANullScreenId_DoesNotThrow_ForwardingItUnchanged()
    {
        // Does NOT measure what the inner store does with a null screenId (HmiScreenStore itself would
        // fail a NOT NULL SQL bind) — only that ScreenIdentity.Canonicalize's null guard is real and not
        // merely asserted in prose: `null!.Trim()` throws NullReferenceException, and the interface's
        // non-nullable `string screenId` is a compile-time promise a runtime caller (e.g. malformed JSON
        // binding) is not forced to keep.
        var inner = new RecordingScreenStore();
        var store = new CanonicalizingHmiScreenStore(inner);

        await store.GetAsync(null!);

        Assert.Equal(new[] { "Get::null" }, inner.Calls);
    }

    [Fact]
    public void EveryMethodOnTheSeam_HasAnIdentityDisposition_SoANewMethodCannotForwardUnhandled()
    {
        // Does NOT measure that a handled method canonicalises CORRECTLY — only that every method NAME on
        // IHmiScreenStore's surface (its own declared members AND every member inherited from a base
        // interface, walked via GetInterfaces() so a future "factor shared members into a base seam"
        // refactor cannot slip a method past this the way CanonicalMachineCodeStoresTests' re-review #4
        // measured GetMethods() alone could) has SOME declared disposition. Correctness of each disposition
        // is every test above.
        //
        // 🔴 WS-HMI-2 Task 2 fix round 1 (review MED-3) — made ACTUALLY bidirectional, not merely narrated
        // as such. CanonicalizingHmiScreenStore.HandledMethods' own doc comment says this test "fails if
        // either side names a method the other does not" — measured FALSE before this fix: seeding
        // HandledMethods with a stale extra name ("FrobnicateAsync", naming no real method) left this test
        // GREEN, because only the "missing" direction (declared-but-unhandled) was ever checked. Both
        // directions now run, combined into ONE failure so a run never reports only half a drift — same
        // reasoning CanonicalMachineCodeStoresTests.AssertDispositionsCoverExactly states for its own
        // two-directional check.
        var seam = typeof(IHmiScreenStore);
        var handled = CanonicalizingHmiScreenStore.HandledMethods;
        var declared = seam.GetMethods().Concat(seam.GetInterfaces().SelectMany(i => i.GetMethods()))
                           .Select(m => m.Name).Distinct().ToArray();
        var missing = declared.Except(handled).ToArray();
        var stale = handled.Except(declared).ToArray();

        var parts = new List<string>();
        if (missing.Length > 0)
        {
            parts.Add(
                $"IHmiScreenStore's surface — its own members AND every member inherited from a base interface — " +
                $"carries method(s) with NO identity disposition: {string.Join(", ", missing)}. Decide: does this " +
                $"method see a screen id? If yes, canonicalise it and add a probe measuring what the inner store " +
                $"received. If no, add a `false` entry NAMING the other identity. Do NOT delete this test to make " +
                $"it pass: forwarding an unhandled method is the exact defect it exists to catch (WS-HMI-0b, three " +
                $"consecutive rounds).");
        }
        if (stale.Length > 0)
        {
            parts.Add(
                $"HandledMethods names method(s) IHmiScreenStore's surface no longer carries: " +
                $"{string.Join(", ", stale)} — remove the stale entry.");
        }

        Assert.True(missing.Length == 0 && stale.Length == 0, string.Join(" | ", parts));
    }

    [Fact]
    public void TheSeamGuard_ActuallyRedensOnAStaleHandledMethodsEntry_NotJustOnAMissingOne()
    {
        // 🔴 The positive control MED-3 named directly: an instrument that cannot go red is not an
        // instrument. Reproduces the exact false-green the review measured (a stale "FrobnicateAsync" entry
        // survived undetected) against a HAND-BUILT set, so this control does not depend on
        // CanonicalizingHmiScreenStore.HandledMethods ever actually going stale to prove the CHECKER catches
        // it when it does.
        var seam = typeof(IHmiScreenStore);
        var declared = seam.GetMethods().Concat(seam.GetInterfaces().SelectMany(i => i.GetMethods()))
                           .Select(m => m.Name).Distinct().ToArray();

        var withStaleEntry = new HashSet<string>(declared, StringComparer.Ordinal) { "FrobnicateAsync" };
        var stale = withStaleEntry.Except(declared).ToArray();

        Assert.Equal(new[] { "FrobnicateAsync" }, stale);
    }
}
