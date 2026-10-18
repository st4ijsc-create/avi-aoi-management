import java.util.ArrayList;
import java.util.List;

public final class Kmp {
    private Kmp() {}

    public static int[] tienTo(String s) {
        int n = s.length();
        int[] pi = new int[n];
        for (int i = 1; i < n; i++) {
            int k = pi[i - 1];
            while (k > 0 && s.charAt(i) != s.charAt(k)) k = pi[k - 1];
            if (s.charAt(i) == s.charAt(k)) k++;
            pi[i] = k;
        }
        return pi;
    }

    public static List<Integer> viTri(String van, String mau) {
        if (mau.isEmpty()) throw new IllegalArgumentException("mẫu rỗng");
        int m = mau.length();
        int[] pi = tienTo(mau);
        List<Integer> kq = new ArrayList<>();
        int j = 0;
        for (int i = 0; i < van.length(); i++) {
            char c = van.charAt(i);
            while (j > 0 && c != mau.charAt(j)) j = pi[j - 1];
            if (c == mau.charAt(j)) j++;
            if (j == m) {
                kq.add(i - m + 1);
                j = pi[m - 1];
            }
        }
        return kq;
    }

    public static int dem(String van, String mau) {
        return viTri(van, mau).size();
    }

    public static int chuKy(String s) {
        int n = s.length();
        if (n == 0) return 0;
        int p = n - tienTo(s)[n - 1];
        return n % p == 0 ? p : n;
    }

    public static String thayThe(String van, String mau, String thay) {
        List<Integer> ds = viTri(van, mau);
        StringBuilder sb = new StringBuilder();
        int den = 0;
        for (int v : ds) {
            if (v < den) continue;
            sb.append(van, den, v).append(thay);
            den = v + mau.length();
        }
        sb.append(van, den, van.length());
        return sb.toString();
    }
}
