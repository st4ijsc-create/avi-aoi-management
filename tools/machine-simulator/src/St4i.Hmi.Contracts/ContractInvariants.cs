namespace St4i.Hmi.Contracts;

/// <summary>Ném khi một tài liệu vi phạm luật an toàn §5. <see cref="Violations"/> mang TOÀN BỘ vi phạm,
/// không phải cái đầu tiên — người sửa cần thấy hết trong một lần.</summary>
public sealed class ContractViolationException : Exception
{
    /// <summary>TOÀN BỘ vi phạm tìm thấy, không phải cái đầu tiên.</summary>
    public IReadOnlyList<string> Violations { get; }

    /// <summary>Khởi tạo với danh sách vi phạm đầy đủ đã thu thập bởi <see cref="ContractInvariants.Validate(TagNamespaceDocument)"/>
    /// hoặc <see cref="ContractInvariants.Validate(ComponentModelDocument)"/>.</summary>
    public ContractViolationException(IReadOnlyList<string> violations)
        : base($"Tài liệu vi phạm bất biến hợp đồng ({violations.Count}): {string.Join(" | ", violations)}")
        => Violations = violations;
}

/// <summary>
/// Luật an toàn §5 viết thành mã, cho phía .NET. Schema JSON đã thi hành cùng những luật này cho mọi tài
/// liệu đi qua bộ validate phía web — nhưng các record ở assembly này khai enum là <see langword="string"/>,
/// nên một producer .NET dựng thẳng một record vi phạm sẽ không gặp trở ngại nào. Đây là cửa đóng chỗ đó.
///
/// <para>🔴 <b>Giới hạn, nói ra để không ai đọc quá:</b> đây KHÔNG phải bộ validate JSON Schema. Nó kiểm
/// đúng ba luật §5 và không gì khác — không pattern, không kiểu, không trường lạ. Một tài liệu qua được
/// đây vẫn có thể bị schema từ chối. Và nó chỉ chạy ở nơi có ai đó gọi nó; serialize thẳng bằng
/// <c>JsonSerializer</c> vẫn đi vòng qua được. Bảo vệ nằm ở CỬA GHI (các store), không ở kiểu dữ liệu.</para>
/// </summary>
public static class ContractInvariants
{
    /// <summary>Kiểm luật §5 cho một <see cref="TagNamespaceDocument"/>: mọi tag <c>access == "rw"</c>
    /// phải có <see cref="TagDescriptor.PolicyAction"/>. Trả về rỗng nếu hợp lệ; danh sách đầy đủ nếu không.</summary>
    public static IReadOnlyList<string> Validate(TagNamespaceDocument doc)
    {
        var v = new List<string>();
        foreach (var t in doc.Tags)
            if (t.Access == "rw" && string.IsNullOrEmpty(t.PolicyAction))
                v.Add($"tag '{t.Path}': access='rw' nhưng thiếu policyAction — §5 cấm đường ghi không gác");
        return v;
    }

    /// <summary>Kiểm luật §5 cho một <see cref="ComponentModelDocument"/>: mọi <see cref="ComponentTagDef"/>
    /// với <c>role</c> là <c>"setpoint"</c> hoặc <c>"command"</c> phải có <see cref="ComponentTagDef.PolicyAction"/>,
    /// và riêng <c>"setpoint"</c> còn phải có cả <see cref="ComponentTagDef.Min"/> và <see cref="ComponentTagDef.Max"/>.
    /// Trả về rỗng nếu hợp lệ; danh sách đầy đủ nếu không.</summary>
    public static IReadOnlyList<string> Validate(ComponentModelDocument doc)
    {
        var v = new List<string>();
        foreach (var type in doc.Types)
        foreach (var t in type.Tags)
        {
            var writable = t.Role is "setpoint" or "command";
            if (writable && string.IsNullOrEmpty(t.PolicyAction))
                v.Add($"componentTag '{type.TypeId}.{t.Name}': role='{t.Role}' nhưng thiếu policyAction — §5");
            if (t.Role == "setpoint" && t.Min is null)
                v.Add($"componentTag '{type.TypeId}.{t.Name}': setpoint thiếu min — dải chặn cứng là bắt buộc");
            if (t.Role == "setpoint" && t.Max is null)
                v.Add($"componentTag '{type.TypeId}.{t.Name}': setpoint thiếu max — dải chặn cứng là bắt buộc");
        }
        return v;
    }

    /// <summary>Như <see cref="Validate(TagNamespaceDocument)"/> nhưng ném <see cref="ContractViolationException"/>
    /// mang toàn bộ vi phạm thay vì trả về danh sách — dùng ở cửa ghi của store.</summary>
    public static void ThrowIfInvalid(TagNamespaceDocument doc)
    {
        var v = Validate(doc);
        if (v.Count > 0) throw new ContractViolationException(v);
    }

    /// <summary>Như <see cref="Validate(ComponentModelDocument)"/> nhưng ném <see cref="ContractViolationException"/>
    /// mang toàn bộ vi phạm thay vì trả về danh sách — dùng ở cửa ghi của store.</summary>
    public static void ThrowIfInvalid(ComponentModelDocument doc)
    {
        var v = Validate(doc);
        if (v.Count > 0) throw new ContractViolationException(v);
    }
}
