namespace DatPhong;

/// <summary>Trùng lịch khi đặt phòng; kế thừa InvalidOperationException để mã cũ vẫn bắt được.</summary>
public sealed class XungDotLichException : InvalidOperationException
{
    public IReadOnlyList<DateTime> NgayXungDot { get; }

    public XungDotLichException(string maPhong, IReadOnlyList<DateTime> ngayXungDot)
        : base($"Phòng {maPhong} đã có người đặt lúc {string.Join(", ", ngayXungDot.Select(n => n.ToString("yyyy-MM-dd HH:mm")))}")
    {
        NgayXungDot = ngayXungDot;
    }
}
