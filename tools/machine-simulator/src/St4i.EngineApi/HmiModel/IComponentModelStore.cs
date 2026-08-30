using St4i.Hmi.Contracts;

namespace St4i.EngineApi.HmiModel;

/// <summary>Seam đọc/ghi cây linh kiện của một máy. Khác <see cref="St4i.EngineApi.AssetRegistry.IAssetRegistry"/>
/// ở một điểm có chủ ý: <see cref="PutAsync"/> ĐƯỢC PHÉP ném. Nó chỉ chạy từ một hành động người dùng
/// chủ động, và nuốt lỗi ở đó nghĩa là kỹ sư tưởng đã lưu trong khi chưa.</summary>
public interface IComponentModelStore
{
    Task PutAsync(ComponentModelDocument doc, CancellationToken ct = default);

    Task<ComponentModelDocument?> GetAsync(string machineCode, CancellationToken ct = default);

    Task<IReadOnlyList<string>> ListMachineCodesAsync(CancellationToken ct = default);
}
