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
/// <para>🔴 <b>Fix round 1 — mục (2) cũ "không đo tranh chấp ghi đồng thời vì kho này nối tiếp theo
/// kết nối SQLite" bị RÚT, vì lý do nó nêu là SAI, được đo chứ không phải đọc.</b>
/// <see cref="HmiScreenStore.PutAsync"/> mở một kết nối MỚI mỗi lần gọi và đọc <c>MAX(version)</c>
/// trước khi ghi — nó không nối tiếp gì cả. Đo bằng một probe hai luồng thật (<c>Task.Run</c> +
/// <c>Barrier</c>, 30 lần lặp, không giữ trong repo) không bắt được va chạm ở mức tranh chấp đó —
/// SQLite/lịch trình hệ điều hành làm cửa sổ đọc-rồi-ghi hẹp trong thực tế. Nhưng cửa sổ đó vẫn có
/// thật khi đọc mã: hai lời gọi <see cref="HmiScreenStore.PutAsync"/> đồng thời CÓ THỂ cùng đọc một
/// <c>MAX(version)</c>. Cái chúng KHÔNG THỂ làm là cùng ghi thành công cùng một hàng
/// <c>(screen_id, version)</c>: <c>PRIMARY KEY(screen_id, version)</c> trên bảng <c>screens</c> được
/// SQLite đối chiếu với trạng thái ĐÃ COMMIT thật tại thời điểm INSERT chạy, không phải với bản đọc
/// cũ của bên thua — nên bên thua nhận <c>SqliteException</c> (constraint) và toàn bộ transaction
/// của nó cuộn lại, không ghi gì, không mất phiên bản nào, không có con trỏ treo. Lớp này vẫn KHÔNG
/// đo đường đi đó (không có bài test tranh chấp cố ý), vì bắt một cửa sổ đua hẹp một cách tin cậy
/// đòi một fixture định thời mà lớp này chưa có; câu ở đây chỉ nói ĐÚNG cái store làm, không còn nói
/// nó làm cái nó không làm.</para>
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
        // Một thông điệp bị tước hết số (vd. chỉ còn "khong co phien ban 99") vẫn là
        // ArgumentOutOfRangeException — chỉ Assert.ThrowsAsync thôi thì không bắt được lỗi ấy.
        Assert.Contains("1", ex.Message);
        Assert.Contains("2", ex.Message);
        Assert.Contains("99", ex.Message);
    }

    [Fact]
    public async Task RollbackAsync_OnAScreenNobodyDeclared_ThrowsSayingNoVersionExists()
    {
        var store = NewStore();

        var ex = await Assert.ThrowsAsync<ArgumentOutOfRangeException>(
            () => store.RollbackAsync("never-declared", toVersion: 1));

        Assert.Contains("never-declared", ex.Message);
    }

    static HmiScreenDocument Screen(string id, string title) => new(
        1, id, title, null, "isa101",
        new ScreenLayout(12, 8, "panel"),
        new[] { new ScreenWidget("w1", "label", Rect()) });

    static WidgetRect Rect() => new(0, 0, 2, 1);
}
