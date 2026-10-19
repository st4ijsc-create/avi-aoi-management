import java.util.List;

public class AnTest {
    public static void main(String[] args) {
        Kt.chay("tiền tố có lùi nhiều bậc", () -> {
            Kt.bang(new int[] {0, 1, 0, 1, 2, 2, 3}, Kmp.tienTo("aabaaab"));
            Kt.bang(new int[] {0, 1, 2, 3}, Kmp.tienTo("aaaa"));
            Kt.bang(new int[0], Kmp.tienTo(""));
            Kt.bang(new int[] {0}, Kmp.tienTo("x"));
        });
        Kt.chay("vị trí chồng lấn", () -> {
            Kt.bang(List.of(0, 1, 2), Kmp.viTri("aaaa", "aa"));
            Kt.bang(List.of(0, 2, 4), Kmp.viTri("abababa", "aba"));
            Kt.bang(3, Kmp.dem("abababab", "abab"));
        });
        Kt.chay("vị trí biên: mẫu dài hơn, bằng nhau, văn bản rỗng, không thấy", () -> {
            Kt.bang(List.of(), Kmp.viTri("ab", "abc"));
            Kt.bang(List.of(0), Kmp.viTri("abc", "abc"));
            Kt.bang(List.of(), Kmp.viTri("", "a"));
            Kt.bang(0, Kmp.dem("xyz", "q"));
        });
        Kt.chay("ký tự tiếng Việt theo chỉ số char", () -> {
            Kt.bang(List.of(0, 1), Kmp.viTri("ăăă", "ăă"));
            Kt.bang(List.of(3), Kmp.viTri("Hà Nội", "Nội"));
        });
        Kt.chay("mẫu rỗng ném IllegalArgumentException", () -> {
            Kt.nem(IllegalArgumentException.class, () -> Kmp.viTri("abc", ""));
            Kt.nem(IllegalArgumentException.class, () -> Kmp.dem("abc", ""));
            Kt.nem(IllegalArgumentException.class, () -> Kmp.thayThe("abc", "", "x"));
        });
        Kt.chay("chu kỳ ngắn nhất", () -> {
            Kt.bang(5, Kmp.chuKy("abcab"));
            Kt.bang(1, Kmp.chuKy("aaaa"));
            Kt.bang(0, Kmp.chuKy(""));
            Kt.bang(3, Kmp.chuKy("aabaab"));
            Kt.bang(3, Kmp.chuKy("abcabcabc"));
            Kt.bang(1, Kmp.chuKy("z"));
        });
        Kt.chay("thay thế không chồng lấn từ trái sang phải", () -> {
            Kt.bang("bb", Kmp.thayThe("aaaa", "aa", "b"));
            Kt.bang("ba", Kmp.thayThe("aaa", "aa", "b"));
            Kt.bang("Xbab", Kmp.thayThe("ababab", "aba", "X"));
            Kt.bang("acac", Kmp.thayThe("abcabc", "b", ""));
            Kt.bang("xx", Kmp.thayThe("xx", "y", "z"));
            Kt.bang("aaaa", Kmp.thayThe("aa", "a", "aa"));
        });
        Kt.chay("chuỗi dài (tuyến tính)", () -> {
            String van = "a".repeat(200_000);
            String mau = "a".repeat(1_000);
            Kt.bang(199_001, Kmp.dem(van, mau));
            List<Integer> v = Kmp.viTri(van + "b", "a".repeat(999) + "b");
            Kt.bang(List.of(199_001), v);
        });
        Kt.ketThuc();
    }
}
