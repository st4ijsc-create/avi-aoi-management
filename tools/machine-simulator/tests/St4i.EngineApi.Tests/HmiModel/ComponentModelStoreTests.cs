using St4i.EngineApi.HmiModel;
using St4i.EngineApi.Tests.Auth;
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.EngineApi.Tests.HmiModel;

/// <summary>
/// <c>ComponentModelStore</c> trên SQLite thô, cùng khuôn <c>AssetRegistryStore</c>.
///
/// <para><b>KHÔNG đo cái gì:</b> (1) không kiểm tài liệu hợp lệ theo JSON Schema — store chỉ thi hành ba
/// luật §5 qua <see cref="ContractInvariants"/>, phần còn lại của schema do phía web đo; (2) không kiểm
/// toàn vẹn tham chiếu sang tag namespace — đó là <c>ModelIntegrityTests</c>; (3) không đo hành vi đồng
/// thời nhiều tiến trình — WAL được bật nhưng bài này chạy một tiến trình.</para>
///
/// <para><b><see cref="SecurityEnvVarTests.CollectionName"/> membership:</b> every test here opens a real
/// <c>Microsoft.Data.Sqlite</c> connection through <see cref="ComponentModelStore"/>, and seven classes in
/// this assembly call the process-global <c>SqliteConnection.ClearAllPools()</c> — see that collection's own
/// doc comment for the full membership rule. Without <c>[Collection]</c> this class risks
/// <c>ObjectDisposedException: SQLitePCL.sqlite3</c> if one of those seven fires while a connection here is
/// open; nothing here would go red to say so, it would just flake in CI.</para>
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public class ComponentModelStoreTests : IDisposable
{
    readonly string _dir = Path.Combine(Path.GetTempPath(), "st4i-hmi-model-" + Guid.NewGuid().ToString("N"));

    void IDisposable.Dispose() { try { Directory.Delete(_dir, true); } catch { } }

    ComponentModelStore NewStore() => new(_dir);

    static ComponentModelDocument Doc(string code) => new(
        1, code,
        new[] { new ComponentNode("spindle", "st4i.motor.spindle", "Trục vít", null, $"{code}/spindle") },
        new[] { new ComponentTypeDef(
            "st4i.motor.spindle", "Spindle",
            new[] { new ComponentTagDef("running", "in", "bool", null, null, null, null, null) },
            new[] { new ComponentStateDef("running", "running == true", "run") },
            "fp.motor.spindle") });

    [Fact]
    public async Task A_document_round_trips_through_the_database()
    {
        var store = NewStore();
        await store.PutAsync(Doc("SCRW-01"));

        var back = await store.GetAsync("SCRW-01");

        Assert.NotNull(back);
        Assert.Equal("SCRW-01", back!.MachineCode);
        Assert.Single(back.Components);
        Assert.Equal("spindle", back.Components[0].Id);
        Assert.Equal("fp.motor.spindle", back.Types[0].DefaultFaceplate);
    }

    [Fact]
    public async Task An_unknown_machine_reads_back_null_not_an_error()
    {
        // §5-bis: một máy chưa khai linh kiện là trạng thái HỢP LỆ, không phải lỗi.
        Assert.Null(await NewStore().GetAsync("NOPE-01"));
    }

    [Fact]
    public async Task Putting_the_same_machine_twice_replaces_rather_than_duplicates()
    {
        var store = NewStore();
        await store.PutAsync(Doc("SCRW-01"));
        await store.PutAsync(Doc("SCRW-01"));

        Assert.Single(await store.ListMachineCodesAsync());
    }

    [Fact]
    public async Task Data_survives_a_new_store_instance_over_the_same_directory()
    {
        await NewStore().PutAsync(Doc("SCRW-01"));
        Assert.NotNull(await NewStore().GetAsync("SCRW-01"));
    }

    [Fact]
    public async Task A_document_violating_the_safety_invariant_is_refused_and_nothing_is_written()
    {
        var store = NewStore();
        var bad = new ComponentModelDocument(
            1, "SCRW-01", Array.Empty<ComponentNode>(),
            new[] { new ComponentTypeDef(
                "st4i.motor.spindle", "Spindle",
                new[] { new ComponentTagDef("target", "setpoint", "float", null, "Nm", null, null, null) },
                Array.Empty<ComponentStateDef>(), "fp.motor.spindle") });

        await Assert.ThrowsAsync<ContractViolationException>(() => store.PutAsync(bad));

        // Cửa ghi từ chối, VÀ không để lại nửa bản ghi — đây mới là phần đáng ghim.
        Assert.Null(await store.GetAsync("SCRW-01"));
    }
}
