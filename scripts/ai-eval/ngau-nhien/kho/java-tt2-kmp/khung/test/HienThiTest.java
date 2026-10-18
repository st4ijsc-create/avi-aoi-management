import java.util.List;

public class HienThiTest {
    public static void main(String[] args) {
        Kt.chay("mảng tiền tố cơ bản", () -> {
            Kt.bang(new int[] {0, 0, 0, 1, 2, 0}, Kmp.tienTo("abcabd"));
        });
        Kt.chay("vị trí và đếm không chồng lấn", () -> {
            Kt.bang(List.of(0, 3), Kmp.viTri("abcabc", "abc"));
            Kt.bang(2, Kmp.dem("abcabc", "abc"));
        });
        Kt.chay("chu kỳ và thay thế đơn giản", () -> {
            Kt.bang(2, Kmp.chuKy("abab"));
            Kt.bang(3, Kmp.chuKy("abc"));
            Kt.bang("xyzxyz", Kmp.thayThe("abcabc", "abc", "xyz"));
        });
        Kt.ketThuc();
    }
}
