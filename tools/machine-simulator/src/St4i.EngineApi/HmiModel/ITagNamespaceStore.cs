using St4i.Hmi.Contracts;

namespace St4i.EngineApi.HmiModel;

/// <summary>Seam đọc/ghi namespace tag của một máy. Cùng khuôn <see cref="IComponentModelStore"/> —
/// <see cref="PutAsync"/> ĐƯỢC PHÉP ném, vì nó chỉ chạy từ một hành động người dùng chủ động (kỹ sư /
/// connector nạp lại namespace), và nuốt lỗi ở đó nghĩa là người gọi tưởng đã lưu trong khi chưa.
///
/// <para><see cref="FindTagAsync"/> là điểm khác <see cref="IComponentModelStore"/>: một tag namespace
/// có thể có hàng trăm/nghìn tag phẳng, và một connector cần tra một <c>path</c> mà không phải deserialize
/// toàn bộ tài liệu mỗi lần — đó là lý do có bảng chỉ mục riêng bên dưới.</para></summary>
public interface ITagNamespaceStore
{
    Task PutAsync(TagNamespaceDocument doc, CancellationToken ct = default);

    Task<TagNamespaceDocument?> GetAsync(string machineCode, CancellationToken ct = default);

    /// <summary>Tra một tag theo <paramref name="path"/> qua chỉ mục, rồi trả đúng
    /// <see cref="TagDescriptor"/> đọc được TỪ TÀI LIỆU chứa nó — chỉ mục chỉ nói "path này nằm trong
    /// tài liệu nào", tài liệu vẫn là nguồn sự thật duy nhất.</summary>
    Task<TagDescriptor?> FindTagAsync(string path, CancellationToken ct = default);
}
