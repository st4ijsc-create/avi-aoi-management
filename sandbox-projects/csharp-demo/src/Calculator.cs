namespace CalculatorDemo;

/// <summary>
/// Máy tính tối giản — DỰ ÁN THỬ để kiểm chứng AI local code được C#.
///
/// ⚠ CÓ MỘT LỖI CỐ Ý ở <see cref="Divide"/>: nó KHÔNG kiểm chia cho 0, nên phép chia
/// nguyên cho 0 ném <see cref="DivideByZeroException"/> của .NET một cách thô (không có
/// thông điệp rõ), còn phép chia số thực cho 0 trả về Infinity thay vì báo lỗi.
///
/// NHIỆM VỤ MẪU cho AI local: sửa <see cref="Divide"/> để khi mẫu số = 0 thì ném
/// <c>ArgumentException("Không chia được cho 0")</c> — rồi chạy <c>dotnet test</c> để
/// hai ca test đang ĐỎ (<c>Divide_ByZero_*</c>) chuyển sang XANH.
/// </summary>
public class Calculator
{
    public int Add(int a, int b) => a + b;

    public int Subtract(int a, int b) => a - b;

    public int Multiply(int a, int b) => a * b;

    /// <summary>
    /// ⚠ LỖI CỐ Ý — chưa chặn mẫu số 0. AI cần sửa chỗ này.
    /// </summary>
    public double Divide(double a, double b)
    {
        return a / b;
    }
}
