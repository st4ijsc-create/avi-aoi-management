namespace St4i.Hmi.Contracts;

/// <summary>Bản sao C# của <c>contracts/component-model.schema.json</c> v1. Ghim hai chiều bởi
/// <c>ComponentModelSchemaPinTests</c>.</summary>
public sealed record ComponentModelDocument(
    int SchemaVersion,
    string MachineCode,
    IReadOnlyList<ComponentNode> Components,
    IReadOnlyList<ComponentTypeDef> Types);

/// <summary>Một linh kiện cụ thể trên một máy cụ thể. <paramref name="TagPrefix"/> là thứ biến một
/// faceplate dùng chung thành một instance: binding trong màn hình viết <c>{component}/torque</c>, runtime
/// thay <c>{component}</c> bằng giá trị này. Đây là cơ chế indirect binding của §3.3 — không có nó thì
/// "sinh màn hình theo linh kiện" biến thành copy-paste.</summary>
public sealed record ComponentNode(
    string Id, string TypeId, string Label, string? ParentId, string TagPrefix);

/// <summary>Định nghĩa một KIỂU linh kiện — vai trò "UDT" trong mô hình này. Khai một lần, dùng N lần.</summary>
public sealed record ComponentTypeDef(
    string TypeId,
    string Label,
    IReadOnlyList<ComponentTagDef> Tags,
    IReadOnlyList<ComponentStateDef> States,
    string DefaultFaceplate);

/// <summary>Tag khai báo của một kiểu linh kiện. <paramref name="Min"/>/<paramref name="Max"/> là dải chặn
/// CỨNG cho <c>role == "setpoint"</c> — schema bắt buộc chúng, vì đây là giao diện vận hành máy công
/// nghiệp và không được để nhập giá trị ngoài dải an toàn (nguyên tắc của MACHINE_CONFIG_DESIGN.md §3).
///
/// <para>📎 🔴 <b>"schema bắt buộc chúng" GIỮ NGUYÊN VĂN nhưng đã HẾT ĐỦ, 2026-08-30</b> (review toàn
/// nhánh WS-HMI-0a, Minor 7). Từ WS-HMI-0a Task 1, <see cref="ContractInvariants.Validate(ComponentModelDocument)"/>
/// thi hành cùng luật ấy ở phía .NET — cả <c>min</c>/<c>max</c> lẫn <c>policyAction</c> cho
/// <c>role ∈ {setpoint, command}</c> — và <c>ComponentModelStore.PutAsync</c> gọi
/// <see cref="ContractInvariants.ThrowIfInvalid(ComponentModelDocument)"/> trước khi mở kết nối. Schema
/// không còn là NƠI DUY NHẤT; nó vẫn là nơi duy nhất kiểm được pattern, kiểu và trường lạ.</para>
///
/// <para><paramref name="EnumValues"/> thêm ở fix round 2 (finding Important 3): schema cho phép
/// <c>dataType: "enum"</c> nhưng KHÔNG có chỗ nào khai các giá trị của enum ấy, trong khi
/// <c>tag-namespace.schema.json</c> đã có <c>enumValues</c> từ đầu — hai schema bất đồng về đúng cùng một
/// kiểu dữ liệu. Đây là một mâu thuẫn NỘI BỘ của hợp đồng, không phải một tính năng mới, nên nó được
/// sửa thay vì hoãn (khác với <c>quality</c> và <c>alarms[]</c> — xem phần hoãn tường minh ở
/// <c>contracts/README.md</c>). Trường optional ⇒ vắng mặt CHÍNH LÀ null của nó; không bao giờ ghi
/// <c>"enumValues": null</c>.</para></summary>
public sealed record ComponentTagDef(
    string Name, string Role, string DataType, IReadOnlyList<string>? EnumValues, string? Unit,
    double? Min, double? Max, string? PolicyAction);

/// <summary>Một trạng thái hiển thị được của linh kiện. <paramref name="Tone"/> ánh xạ vào bậc trạng thái
/// run/warn/fault/idle — KHÔNG phải màu tuỳ ý; theme quyết định màu, và ISA-101 quy định màu chỉ xuất hiện
/// khi bất thường (§6).</summary>
public sealed record ComponentStateDef(string Name, string Expr, string Tone);
