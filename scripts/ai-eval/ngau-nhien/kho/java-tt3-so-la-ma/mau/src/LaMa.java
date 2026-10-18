import java.util.Locale;
import java.util.regex.Pattern;

public final class LaMa {
    private static final int[] GIA_TRI = {1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1};
    private static final String[] KY_HIEU = {"M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"};
    private static final Pattern CHUAN =
        Pattern.compile("M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})");

    private LaMa() {}

    public static String sangLaMa(int n) {
        if (n < 1 || n > 3999) throw new IllegalArgumentException("ngoài 1..3999: " + n);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < GIA_TRI.length; i++) {
            while (n >= GIA_TRI[i]) {
                sb.append(KY_HIEU[i]);
                n -= GIA_TRI[i];
            }
        }
        return sb.toString();
    }

    public static int tuLaMa(String s) {
        if (s == null || s.isEmpty()) throw new IllegalArgumentException("rỗng");
        String hoa;
        if (s.chars().allMatch(c -> "IVXLCDM".indexOf(c) >= 0)) hoa = s;
        else if (s.chars().allMatch(c -> "ivxlcdm".indexOf(c) >= 0)) hoa = s.toUpperCase(Locale.ROOT);
        else throw new IllegalArgumentException("ký tự lạ hoặc trộn hoa/thường: " + s);
        if (!CHUAN.matcher(hoa).matches()) throw new IllegalArgumentException("không chuẩn: " + s);
        int tong = 0;
        for (int i = 0; i < hoa.length(); i++) {
            int v = giaTri(hoa.charAt(i));
            if (i + 1 < hoa.length() && v < giaTri(hoa.charAt(i + 1))) tong -= v;
            else tong += v;
        }
        return tong;
    }

    public static String cong(String a, String b) {
        int tong = tuLaMa(a) + tuLaMa(b);
        if (tong > 3999) throw new IllegalArgumentException("tổng vượt 3999: " + tong);
        return sangLaMa(tong);
    }

    private static int giaTri(char c) {
        return switch (c) {
            case 'I' -> 1;
            case 'V' -> 5;
            case 'X' -> 10;
            case 'L' -> 50;
            case 'C' -> 100;
            case 'D' -> 500;
            default -> 1000;
        };
    }
}
