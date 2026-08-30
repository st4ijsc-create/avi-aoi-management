namespace St4i.EngineApi.Endpoints;

/// <summary>Kết quả một lần ghi cây linh kiện. <paramref name="Warnings"/> là mất TOÀN VẸN, không phải
/// lỗi: một `tagPrefix` chưa khớp tag nào có thể chỉ nghĩa là connector chưa nạp namespace. Vi phạm bất
/// biến AN TOÀN §5 không bao giờ đi đường này — nó là 400.</summary>
public sealed record PutModelResultDto(string MachineCode, int ComponentCount, IReadOnlyList<string> Warnings);

/// <summary><paramref name="NamespaceLoaded"/> phân biệt "khớp hết" với "chưa có gì để khớp" — hai trạng
/// thái khác nhau mà một danh sách rỗng không tự nói ra được.</summary>
public sealed record IntegrityReportDto(string MachineCode, bool NamespaceLoaded, IReadOnlyList<string> Violations);
