import java.util.ArrayList;
import java.util.List;

public final class DocCsv {
    private DocCsv() {}

    public static List<List<String>> phanTich(String vanBan) {
        String s = vanBan;
        int n = s.length();
        List<List<String>> ds = new ArrayList<>();
        if (n == 0) return ds;
        List<String> dong = new ArrayList<>();
        StringBuilder o = new StringBuilder();
        int i = 0;
        while (true) {
            if (i < n && s.charAt(i) == '"') {
                i++;
                while (true) {
                    if (i >= n) throw new IllegalArgumentException("ô có nháy chưa đóng");
                    char c = s.charAt(i);
                    if (c == '"') {
                        if (i + 1 < n && s.charAt(i + 1) == '"') {
                            o.append('"');
                            i += 2;
                        } else {
                            i++;
                            break;
                        }
                    } else {
                        o.append(c);
                        i++;
                    }
                }
                if (i < n && s.charAt(i) != ',' && !laXuongDong(s, i)) {
                    throw new IllegalArgumentException("ký tự sau nháy đóng ở vị trí " + i);
                }
            } else {
                while (i < n && s.charAt(i) != ',' && !laXuongDong(s, i)) {
                    if (s.charAt(i) == '"') throw new IllegalArgumentException("nháy trong ô không bọc nháy ở vị trí " + i);
                    o.append(s.charAt(i));
                    i++;
                }
            }
            dong.add(o.toString());
            o.setLength(0);
            if (i >= n) {
                ds.add(dong);
                return ds;
            }
            if (s.charAt(i) == ',') {
                i++;
                continue;
            }
            i += s.charAt(i) == '\r' ? 2 : 1;
            ds.add(dong);
            dong = new ArrayList<>();
            if (i >= n) return ds;
        }
    }

    private static boolean laXuongDong(String s, int i) {
        char c = s.charAt(i);
        return c == '\n' || (c == '\r' && i + 1 < s.length() && s.charAt(i + 1) == '\n');
    }
}
