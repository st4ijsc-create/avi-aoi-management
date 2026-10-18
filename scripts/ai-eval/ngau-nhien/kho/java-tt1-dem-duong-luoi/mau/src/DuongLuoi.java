import java.util.ArrayList;
import java.util.List;

public final class DuongLuoi {
    public static final long MOD = 1_000_000_007L;

    private DuongLuoi() {}

    public static long demDuong(String[] luoi) {
        List<int[]> moc = cacMoc(luoi);
        if (moc == null) return 0;
        long tich = 1;
        for (int i = 0; i + 1 < moc.size(); i++) {
            long doan = demDoan(luoi, moc.get(i), moc.get(i + 1));
            tich = tich * doan % MOD;
        }
        return tich;
    }

    public static String duongNhoNhat(String[] luoi) {
        List<int[]> moc = cacMoc(luoi);
        if (moc == null) return null;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i + 1 < moc.size(); i++) {
            String doan = nhoNhatDoan(luoi, moc.get(i), moc.get(i + 1));
            if (doan == null) return null;
            sb.append(doan);
        }
        return sb.toString();
    }

    /** Kiểm lưới; trả dãy mốc (đầu, các ô '*' theo thứ tự, cuối) hoặc null nếu chắc chắn không có đường. */
    private static List<int[]> cacMoc(String[] luoi) {
        if (luoi == null || luoi.length == 0) throw new IllegalArgumentException("lưới rỗng");
        int w = -1;
        for (String hang : luoi) {
            if (hang == null || hang.isEmpty()) throw new IllegalArgumentException("hàng rỗng");
            if (w < 0) w = hang.length();
            else if (hang.length() != w) throw new IllegalArgumentException("lưới không chữ nhật");
            for (int c = 0; c < hang.length(); c++) {
                char ch = hang.charAt(c);
                if (ch != '.' && ch != '#' && ch != '*') throw new IllegalArgumentException("ký tự lạ: " + ch);
            }
        }
        int h = luoi.length;
        if (luoi[0].charAt(0) == '#' || luoi[h - 1].charAt(w - 1) == '#') return null;
        List<int[]> moc = new ArrayList<>();
        moc.add(new int[] {0, 0});
        for (int r = 0; r < h; r++) {
            for (int c = 0; c < w; c++) {
                if (luoi[r].charAt(c) == '*') moc.add(new int[] {r, c});
            }
        }
        moc.add(new int[] {h - 1, w - 1});
        for (int i = 0; i + 1 < moc.size(); i++) {
            if (moc.get(i + 1)[1] < moc.get(i)[1]) return null;
        }
        return moc;
    }

    private static long demDoan(String[] luoi, int[] a, int[] b) {
        int cao = b[0] - a[0] + 1, rong = b[1] - a[1] + 1;
        long[] dp = new long[rong];
        for (int i = 0; i < cao; i++) {
            String hang = luoi[a[0] + i];
            for (int j = 0; j < rong; j++) {
                if (hang.charAt(a[1] + j) == '#') { dp[j] = 0; continue; }
                if (i == 0 && j == 0) { dp[j] = 1; continue; }
                if (j > 0) dp[j] = (dp[j] + dp[j - 1]) % MOD;
            }
        }
        return dp[rong - 1];
    }

    private static String nhoNhatDoan(String[] luoi, int[] a, int[] b) {
        int cao = b[0] - a[0] + 1, rong = b[1] - a[1] + 1;
        boolean[][] toi = new boolean[cao][rong];
        for (int i = cao - 1; i >= 0; i--) {
            for (int j = rong - 1; j >= 0; j--) {
                if (luoi[a[0] + i].charAt(a[1] + j) == '#') continue;
                if (i == cao - 1 && j == rong - 1) toi[i][j] = true;
                else toi[i][j] = (i + 1 < cao && toi[i + 1][j]) || (j + 1 < rong && toi[i][j + 1]);
            }
        }
        if (!toi[0][0]) return null;
        StringBuilder sb = new StringBuilder();
        int i = 0, j = 0;
        while (i != cao - 1 || j != rong - 1) {
            if (i + 1 < cao && toi[i + 1][j]) { sb.append('D'); i++; }
            else { sb.append('R'); j++; }
        }
        return sb.toString();
    }
}
