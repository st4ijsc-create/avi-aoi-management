import java.util.Arrays;
import java.util.Objects;

/**
 * Trình kiểm thử tối giản cho bộ đo (không JUnit, không Maven).
 * Dùng trong một lớp test có main:
 *   Kt.chay("tên", () -> { Kt.bang(mongDoi, thucTe); Kt.dung(dk, "lý do"); Kt.nem(IllegalArgumentException.class, () -> ...); });
 *   ...
 *   Kt.ketThuc();   // in "KT_TONG pass=X fail=Y" rồi thoát 0 (không trượt) hoặc 1
 * ĐỪNG SỬA tệp này (tệp được bảo vệ — sửa ⇒ bài TRƯỢT).
 */
public final class Kt {
    private static int dat = 0;
    private static int truot = 0;

    public interface ThanTest {
        void chay() throws Exception;
    }

    private Kt() {}

    public static void chay(String ten, ThanTest t) {
        try {
            t.chay();
            dat++;
            System.out.println("ok - " + ten);
        } catch (Throwable e) {
            truot++;
            System.out.println("TRUOT - " + ten + ": " + e);
        }
    }

    public static void bang(Object mongDoi, Object thucTe) {
        if (!Objects.deepEquals(mongDoi, thucTe)) {
            throw new AssertionError("mong đợi <" + hien(mongDoi) + "> nhưng được <" + hien(thucTe) + ">");
        }
    }

    public static void gan(double mongDoi, double thucTe, double saiSo) {
        if (Double.isNaN(thucTe) || Math.abs(mongDoi - thucTe) > saiSo) {
            throw new AssertionError("mong đợi ≈" + mongDoi + " nhưng được " + thucTe);
        }
    }

    public static void dung(boolean dieuKien, String thongDiep) {
        if (!dieuKien) throw new AssertionError(thongDiep);
    }

    public static <T extends Throwable> T nem(Class<T> loai, ThanTest t) {
        try {
            t.chay();
        } catch (Throwable e) {
            if (loai.isInstance(e)) return loai.cast(e);
            throw new AssertionError("mong đợi ném " + loai.getSimpleName() + " nhưng ném " + e);
        }
        throw new AssertionError("mong đợi ném " + loai.getSimpleName() + " nhưng không ném gì");
    }

    public static void ketThuc() {
        System.out.println("KT_TONG pass=" + dat + " fail=" + truot);
        System.out.flush();
        System.exit(truot == 0 ? 0 : 1);
    }

    private static String hien(Object o) {
        if (o instanceof Object[] a) return Arrays.deepToString(a);
        if (o instanceof int[] a) return Arrays.toString(a);
        if (o instanceof long[] a) return Arrays.toString(a);
        if (o instanceof double[] a) return Arrays.toString(a);
        if (o instanceof char[] a) return Arrays.toString(a);
        if (o instanceof byte[] a) return Arrays.toString(a);
        if (o instanceof boolean[] a) return Arrays.toString(a);
        return String.valueOf(o);
    }
}
