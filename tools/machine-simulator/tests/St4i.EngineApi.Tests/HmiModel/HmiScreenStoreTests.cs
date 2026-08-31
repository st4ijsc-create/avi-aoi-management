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
/// <c>ContractInvariants</c> thi hành; (2) không đo tranh chấp ghi đồng thời — kho này nối tiếp theo
/// kết nối SQLite và bài test chạy một luồng; (3) không đo phân quyền — đó là tầng auth và
/// <c>HmiScreenEndpointsTests</c>.</para>
///
/// <para><b><see cref="SecurityEnvVarTests.CollectionName"/> membership:</b> every test here opens a real
/// <c>Microsoft.Data.Sqlite</c> connection through <see cref="HmiScreenStore"/>, and seven classes in this
/// assembly call the process-global <c>SqliteConnection.ClearAllPools()</c> — same reason
/// <c>TagNamespaceStoreTests</c>/<c>ComponentModelStoreTests</c> carry this attribute; without it this
/// class risks <c>ObjectDisposedException: SQLitePCL.sqlite3</c> if one of those seven fires while a
/// connection here is open, and nothing here would go red to say so.</para>
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

    static HmiScreenDocument Screen(string id, string title) => new(
        1, id, title, null, "isa101",
        new ScreenLayout(12, 8, "panel"),
        new[] { new ScreenWidget("w1", "label", Rect()) });

    static WidgetRect Rect() => new(0, 0, 2, 1);
}
