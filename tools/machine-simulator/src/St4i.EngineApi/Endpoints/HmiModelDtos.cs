namespace St4i.EngineApi.Endpoints;

/// <summary>Kết quả một lần ghi cây linh kiện. <paramref name="Warnings"/> là mất TOÀN VẸN, không phải
/// lỗi: một `tagPrefix` chưa khớp tag nào có thể chỉ nghĩa là connector chưa nạp namespace. Vi phạm bất
/// biến AN TOÀN §5 không bao giờ đi đường này — nó là 400.</summary>
public sealed record PutModelResultDto(string MachineCode, int ComponentCount, IReadOnlyList<string> Warnings);

/// <summary><paramref name="NamespaceLoaded"/> phân biệt "khớp hết" với "chưa có gì để khớp" — hai trạng
/// thái khác nhau mà một danh sách rỗng không tự nói ra được.</summary>
public sealed record IntegrityReportDto(string MachineCode, bool NamespaceLoaded, IReadOnlyList<string> Violations);

/// <summary>Kết quả một lần nạp tag namespace (WS-HMI-0b Task 2, <c>PUT /v1/tags/{machineCode}</c>).
///
/// <para>🔴 <b><paramref name="BackedByDriverCount"/> ở task này CHỈ LÀ MỘT PHÉP ĐẾM TRƯỜNG DỮ LIỆU</b> —
/// số tag khai <c>isBackedByDriver: true</c>, không hơn. Nó KHÔNG đo rằng có driver nào thật sự nạp tag ấy,
/// và không được đọc thành như thế. Trường tồn tại từ bây giờ để WS-HMI-0c có CHỖ biến nó thành một mệnh đề
/// đo được (xem báo cáo Task 2: hình dạng cần có là
/// <c>MachineParameterSchema.IsConsumedBySimulator</c> + <c>UnconsumedConfigKindsTests</c> — một bên khai,
/// một bên đối chiếu với thứ runtime thật sự tiêu thụ, và bài test đỏ khi hai bên lệch). Xây nó thành phép
/// đo thật ở task này là xây trước khi có cái để đối chiếu.</para></summary>
public sealed record PutNamespaceResultDto(string MachineCode, int TagCount, int BackedByDriverCount);
