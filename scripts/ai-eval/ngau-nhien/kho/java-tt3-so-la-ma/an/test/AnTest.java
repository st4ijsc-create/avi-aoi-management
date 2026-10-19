import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public class AnTest {
    public static void main(String[] args) {
        Kt.chay("biên và dạng trừ", () -> {
            Kt.bang("I", LaMa.sangLaMa(1));
            Kt.bang("MMMCMXCIX", LaMa.sangLaMa(3999));
            Kt.bang("MCMXCIV", LaMa.sangLaMa(1994));
            Kt.bang("CDXLIV", LaMa.sangLaMa(444));
            Kt.bang("DCCCLXXXVIII", LaMa.sangLaMa(888));
        });
        Kt.chay("sangLaMa ngoài miền", () -> {
            Kt.nem(IllegalArgumentException.class, () -> LaMa.sangLaMa(0));
            Kt.nem(IllegalArgumentException.class, () -> LaMa.sangLaMa(4000));
            Kt.nem(IllegalArgumentException.class, () -> LaMa.sangLaMa(-7));
        });
        Kt.chay("đọc các số hợp lệ", () -> {
            Kt.bang(3999, LaMa.tuLaMa("MMMCMXCIX"));
            Kt.bang(1994, LaMa.tuLaMa("MCMXCIV"));
            Kt.bang(400, LaMa.tuLaMa("CD"));
            Kt.bang(4, LaMa.tuLaMa("IV"));
            Kt.bang(3000, LaMa.tuLaMa("MMM"));
        });
        Kt.chay("từ chối dạng không chuẩn", () -> {
            for (String s : List.of("MMMM", "IC", "VX", "IIX", "XM", "VV", "LL", "DD", "IXI", "XCX", "CMC",
                    "IL", "XD", "VL", "IIV", "XXXX", "CCCC", "MCMC", "IVI", "LXL")) {
                Kt.nem(IllegalArgumentException.class, () -> LaMa.tuLaMa(s));
            }
        });
        Kt.chay("từ chối rỗng, null, khoảng trắng, ký tự lạ", () -> {
            for (String s : new String[] {"", null, " X", "X ", "X I", "A", "12", "X-"}) {
                Kt.nem(IllegalArgumentException.class, () -> LaMa.tuLaMa(s));
            }
        });
        Kt.chay("chữ thường toàn bộ được nhận, trộn hoa thường bị từ chối", () -> {
            Kt.bang(14, LaMa.tuLaMa("xiv"));
            Kt.bang(3999, LaMa.tuLaMa("mmmcmxcix"));
            Kt.nem(IllegalArgumentException.class, () -> LaMa.tuLaMa("Xiv"));
            Kt.nem(IllegalArgumentException.class, () -> LaMa.tuLaMa("mCM"));
            Kt.nem(IllegalArgumentException.class, () -> LaMa.tuLaMa("iiii"));
        });
        Kt.chay("khứ hồi đủ 1..3999 và không trùng", () -> {
            Set<String> da = new HashSet<>();
            for (int n = 1; n <= 3999; n++) {
                String r = LaMa.sangLaMa(n);
                Kt.bang(n, LaMa.tuLaMa(r));
                Kt.bang(n, LaMa.tuLaMa(r.toLowerCase(Locale.ROOT)));
                Kt.dung(da.add(r), "trùng " + r);
            }
        });
        Kt.chay("cộng: biên trên, chữ thường, đầu vào sai", () -> {
            Kt.bang("MMMCMXCIX", LaMa.cong("MMM", "CMXCIX"));
            Kt.bang("XV", LaMa.cong("xiv", "I"));
            Kt.bang("MM", LaMa.cong("M", "M"));
            Kt.nem(IllegalArgumentException.class, () -> LaMa.cong("MMM", "M"));
            Kt.nem(IllegalArgumentException.class, () -> LaMa.cong("MMMCMXCIX", "I"));
            Kt.nem(IllegalArgumentException.class, () -> LaMa.cong("IIII", "I"));
            Kt.nem(IllegalArgumentException.class, () -> LaMa.cong("I", null));
        });
        Kt.ketThuc();
    }
}
