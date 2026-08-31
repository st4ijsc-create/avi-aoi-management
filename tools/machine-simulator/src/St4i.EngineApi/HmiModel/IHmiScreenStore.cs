using St4i.Hmi.Contracts;

namespace St4i.EngineApi.HmiModel;

/// <summary>Seam đọc/ghi màn hình HMI. Khác <see cref="IComponentModelStore"/>/<see cref="ITagNamespaceStore"/>
/// ở đúng một điểm, và đó là lý do kho này tồn tại riêng: hai kho kia GHI ĐÈ một hàng theo khoá — lần ghi
/// sau thắng, không lịch sử. Kho màn hình THÊM MỘT PHIÊN BẢN MỖI LẦN GHI và giữ một con trỏ "hiện hành",
/// vì <c>rollback</c> (spec §7) đòi phiên bản cũ phải còn tồn tại để phục hồi tới.
///
/// <para><see cref="PutAsync"/> ĐƯỢC PHÉP ném — cùng lý do hai kho tiền nhiệm: nó chỉ chạy từ một hành
/// động người dùng chủ động (kỹ sư lưu một màn hình vừa sửa trong builder), không phải từ một vòng lặp
/// khởi động, nên nuốt lỗi ở đây nghĩa là người gọi tưởng đã lưu trong khi chưa.</para></summary>
public interface IHmiScreenStore
{
    /// <summary>Đọc một màn hình. <paramref name="version"/> là <see langword="null"/> ⇒ phiên bản HIỆN
    /// HÀNH (theo con trỏ, không nhất thiết là số lớn nhất — <see cref="RollbackAsync"/> có thể trỏ con
    /// trỏ về một phiên bản đã tồn tại từ trước qua một phiên bản MỚI nối thêm); khác <see langword="null"/>
    /// ⇒ đúng phiên bản đó. Trả <see langword="null"/> nếu màn hình (hoặc phiên bản) không tồn tại — một
    /// màn hình chưa khai là trạng thái hợp lệ, không phải lỗi.</summary>
    Task<HmiScreenDocument?> GetAsync(string screenId, int? version = null, CancellationToken ct = default);

    /// <summary>Thêm một phiên bản mới cho <c>doc.ScreenId</c> và trỏ con trỏ hiện hành về nó. KHÔNG BAO
    /// GIỜ ghi đè một phiên bản đã có. Trả về số phiên bản mới (1 cho lần ghi đầu tiên của một
    /// <c>screenId</c>, tăng dần sau đó).</summary>
    Task<int> PutAsync(HmiScreenDocument doc, CancellationToken ct = default);

    /// <summary>Mọi <c>screenId</c> đã từng được khai, sắp theo thứ tự chuỗi.</summary>
    Task<IReadOnlyList<string>> ListScreenIdsAsync(CancellationToken ct = default);

    /// <summary>Mọi phiên bản của một màn hình, sắp tăng dần theo <see cref="ScreenVersionInfo.Version"/>.
    /// Rỗng nếu màn hình chưa từng được khai — KHÔNG ném.</summary>
    Task<IReadOnlyList<ScreenVersionInfo>> ListVersionsAsync(string screenId, CancellationToken ct = default);

    /// <summary>Đưa phiên bản <paramref name="toVersion"/> trở thành hiện hành, bằng cách đọc tài liệu ở
    /// phiên bản đó rồi <see cref="PutAsync"/> nó — NỐI THÊM một phiên bản mới, KHÔNG BAO GIỜ xoá lịch sử.
    /// Trả về số phiên bản mới đó. Ném <see cref="ArgumentOutOfRangeException"/> nếu
    /// <paramref name="toVersion"/> không tồn tại cho <paramref name="screenId"/>; thông điệp nêu rõ các số
    /// phiên bản có thật.</summary>
    Task<int> RollbackAsync(string screenId, int toVersion, CancellationToken ct = default);
}

/// <summary>Một mục trong lịch sử phiên bản của một màn hình. <paramref name="SavedAtUtc"/> là chuỗi ISO-8601
/// UTC (cùng khuôn <c>updated_at</c> của <see cref="ComponentModelStore"/>/<see cref="TagNamespaceStore"/>).
/// <paramref name="IsCurrent"/> đúng cho ĐÚNG MỘT phần tử của danh sách <see cref="IHmiScreenStore.ListVersionsAsync"/>
/// trả về cho một màn hình đã tồn tại — phần tử mà con trỏ hiện hành đang trỏ tới, không nhất thiết là
/// phần tử có <see cref="Version"/> lớn nhất (xem <see cref="IHmiScreenStore.RollbackAsync"/>).</summary>
public sealed record ScreenVersionInfo(int Version, string SavedAtUtc, bool IsCurrent);
