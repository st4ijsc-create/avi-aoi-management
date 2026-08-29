using System.Text.Json;

namespace St4i.Hmi.Contracts;

/// <summary>Bản sao C# của <c>contracts/hmi-screen.schema.json</c> v1 — một màn hình HMI do builder tạo
/// ra, do runtime đọc. Ghim hai chiều bởi <c>HmiScreenSchemaPinTests</c>.</summary>
public sealed record HmiScreenDocument(
    int SchemaVersion,
    string ScreenId,
    string Title,
    string? TitleEn,
    string Theme,
    ScreenLayout Layout,
    IReadOnlyList<ScreenWidget> Widgets);

/// <summary>Lưới đặt widget. Lưới cố định theo breakpoint chứ không toạ độ pixel tự do — đây là quyết định
/// có chủ ý: toạ độ tự do làm màn hình vỡ khi đổi kích thước, và ISA-101 nói về khả năng đọc được của
/// người vận hành, không về tự do đồ hoạ của người thiết kế.</summary>
public sealed record ScreenLayout(int Cols, int Rows, string Breakpoint);

/// <summary>Một widget. <paramref name="Component"/> khác null bật indirect binding: mọi chuỗi
/// <c>{component}</c> trong <paramref name="Bindings"/> được thay bằng <c>TagPrefix</c> của linh kiện đó
/// lúc chạy, nên MỘT faceplate phục vụ N instance.
///
/// <para><paramref name="PolicyAction"/> là bất biến §5: schema BẮT BUỘC nó khác null với
/// <c>kind == "setpoint-input"</c> hoặc <c>"command-button"</c>. Kiểu C# không tự thi hành được ràng buộc
/// ấy — schema thi hành, và fixture <c>invalid/screen-write-widget-without-policy-action.json</c> là bằng
/// chứng luật ấy thật sự chặn. Đừng đọc "biên dịch được" thành "gác được".</para></summary>
public sealed record ScreenWidget(
    string Id,
    string Kind,
    WidgetRect Rect,
    string? Component = null,
    IReadOnlyDictionary<string, string>? Bindings = null,
    IReadOnlyDictionary<string, JsonElement>? Props = null,
    string? PolicyAction = null);

/// <summary>Ô trên lưới của <see cref="ScreenLayout"/>. Gốc toạ độ (0,0) ở góc trên-trái.</summary>
public sealed record WidgetRect(int Col, int Row, int ColSpan, int RowSpan);
