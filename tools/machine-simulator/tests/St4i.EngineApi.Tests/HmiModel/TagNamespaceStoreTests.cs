using St4i.EngineApi.HmiModel;
using St4i.EngineApi.Tests.Auth;
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.EngineApi.Tests.HmiModel;

/// <summary>
/// <c>TagNamespaceStore</c>: tài liệu lưu nguyên dạng JSON, cộng một bảng chỉ mục phẳng chỉ cho
/// <c>path</c> — thứ duy nhất cần tra nhanh.
///
/// <para>🔴 <b>`[Collection]` ở trên KHÔNG phải trang trí.</b> Bảy lớp trong assembly này gọi
/// <c>SqliteConnection.ClearAllPools()</c> — một lời gọi ở phạm vi TIẾN TRÌNH. Một lớp test không nằm
/// trong collection ấy mà đang giữ một kết nối SQLite mở đúng lúc đó sẽ dính
/// <c>ObjectDisposedException: SQLitePCL.sqlite3</c>, và kho này ghi nhận triệu chứng đó đã xảy ra
/// thật. 50 lớp test hiện có mang thuộc tính này, gồm cả <c>AssetRegistryStoreTests</c>. Tài liệu của
/// chính quy ước ấy (<c>Auth/SecurityEnvVarTests.cs</c>) nói thẳng rằng <b>không có test nào ép được tư
/// cách thành viên</b> — nên thiếu nó là im lặng cho tới khi thành CI flake, chứ không đỏ ngay.</para>
///
/// <para><b>KHÔNG đo cái gì:</b> (1) không đo giá trị sống hay <c>quality</c> — store này giữ KHAI BÁO,
/// còn giá trị thuộc hợp đồng live mà WS-HMI-0c sẽ định nghĩa; (2) không đo <c>isBackedByDriver</c> có
/// đúng sự thật hay không — nó là một trường dữ liệu ở tầng này, và việc nó khớp driver thật là phép đo
/// của WS-HMI-0c; (3) không kiểm schema đầy đủ, chỉ ba luật §5.</para>
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public class TagNamespaceStoreTests : IDisposable
{
    readonly string _dir = Path.Combine(Path.GetTempPath(), "st4i-hmi-tags-" + Guid.NewGuid().ToString("N"));

    void IDisposable.Dispose() { try { Directory.Delete(_dir, true); } catch { } }

    TagNamespaceStore NewStore() => new(_dir);

    static TagDescriptor Tag(string path, string access = "r", string? policy = null) =>
        new(path, "float", "Nm", 0, 20, null, access, policy, new TagSource("simulated"), false);

    [Fact]
    public async Task A_namespace_round_trips()
    {
        var store = NewStore();
        await store.PutAsync(new TagNamespaceDocument(1, "SCRW-01", new[] { Tag("SCRW-01/spindle/torque") }));

        var back = await store.GetAsync("SCRW-01");

        Assert.NotNull(back);
        Assert.Single(back!.Tags);
        Assert.Equal("SCRW-01/spindle/torque", back.Tags[0].Path);
        Assert.Equal(20, back.Tags[0].EngMax);
    }

    [Fact]
    public async Task A_tag_is_findable_by_path_without_reading_the_whole_document()
    {
        var store = NewStore();
        await store.PutAsync(new TagNamespaceDocument(1, "SCRW-01", new[]
        {
            Tag("SCRW-01/spindle/torque"),
            Tag("SCRW-01/ambient/temp"),
        }));

        var t = await store.FindTagAsync("SCRW-01/ambient/temp");

        Assert.NotNull(t);
        Assert.Equal("SCRW-01/ambient/temp", t!.Path);
    }

    [Fact]
    public async Task An_unknown_path_reads_back_null()
    {
        Assert.Null(await NewStore().FindTagAsync("NOPE/x/y"));
    }

    [Fact]
    public async Task Re_putting_a_machine_removes_tags_that_are_no_longer_declared()
    {
        // 🔴 Bài quan trọng nhất của lớp này. Một connector nạp lại namespace sau khi kỹ sư xoá một tag
        // phải làm tag ấy BIẾN MẤT khỏi chỉ mục. Nếu chỉ mục chỉ được thêm vào, `FindTagAsync` sẽ tiếp
        // tục trả về một tag không còn tồn tại trong tài liệu — hai nguồn sự thật lệch nhau âm thầm,
        // đúng lớp khuyết tật mà cả Mốc 0 dựng lên để chặn.
        var store = NewStore();
        await store.PutAsync(new TagNamespaceDocument(1, "SCRW-01", new[]
        {
            Tag("SCRW-01/spindle/torque"),
            Tag("SCRW-01/ambient/temp"),
        }));
        await store.PutAsync(new TagNamespaceDocument(1, "SCRW-01", new[] { Tag("SCRW-01/spindle/torque") }));

        Assert.NotNull(await store.FindTagAsync("SCRW-01/spindle/torque"));
        Assert.Null(await store.FindTagAsync("SCRW-01/ambient/temp"));
    }

    [Fact]
    public async Task A_writable_tag_without_a_policy_action_is_refused_and_nothing_is_written()
    {
        var store = NewStore();
        var bad = new TagNamespaceDocument(1, "SCRW-01", new[] { Tag("SCRW-01/spindle/sp", "rw", null) });

        await Assert.ThrowsAsync<ContractViolationException>(() => store.PutAsync(bad));

        Assert.Null(await store.GetAsync("SCRW-01"));
        Assert.Null(await store.FindTagAsync("SCRW-01/spindle/sp"));
    }

    [Fact]
    public async Task Data_survives_a_new_store_instance()
    {
        await NewStore().PutAsync(new TagNamespaceDocument(1, "SCRW-01", new[] { Tag("SCRW-01/a/b") }));
        Assert.NotNull(await NewStore().FindTagAsync("SCRW-01/a/b"));
    }
}
