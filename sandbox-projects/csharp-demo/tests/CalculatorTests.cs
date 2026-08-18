using CalculatorDemo;
using Xunit;

namespace CalculatorDemo.Tests;

public class CalculatorTests
{
    private readonly Calculator _calc = new();

    [Fact]
    public void Add_HaiSoDuong() => Assert.Equal(5, _calc.Add(2, 3));

    [Fact]
    public void Subtract_ChoKetQuaAm() => Assert.Equal(-1, _calc.Subtract(2, 3));

    [Fact]
    public void Multiply_ThongThuong() => Assert.Equal(6, _calc.Multiply(2, 3));

    [Fact]
    public void Divide_ThongThuong() => Assert.Equal(2.5, _calc.Divide(5, 2));

    // ── HAI CA ĐANG ĐỎ — NHIỆM VỤ CỦA AI LÀ LÀM CHÚNG XANH ──────────────────────────────
    // Kỳ vọng: Divide(x, 0) ném ArgumentException với thông điệp "Không chia được cho 0".
    // Hiện Calculator.Divide chưa chặn mẫu số 0 nên hai ca này thất bại.

    [Fact]
    public void Divide_ByZero_NemArgumentException()
    {
        Assert.Throws<System.ArgumentException>(() => _calc.Divide(5, 0));
    }

    [Fact]
    public void Divide_ByZero_ThongDiepRoRang()
    {
        var ex = Assert.Throws<System.ArgumentException>(() => _calc.Divide(1, 0));
        Assert.Contains("Không chia được cho 0", ex.Message);
    }
}
