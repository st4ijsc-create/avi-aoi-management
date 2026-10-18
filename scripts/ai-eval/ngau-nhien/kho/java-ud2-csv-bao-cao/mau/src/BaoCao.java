import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class BaoCao {
    private static final RoundingMode LAM_TRON = RoundingMode.HALF_UP;
    private static final String[] TIEU_DE = {"Nhóm", "Số dòng", "Tổng", "Trung bình"};

    private record Nhom(String ten, long dem, BigDecimal tong) {}

    private BaoCao() {}

    public static List<DongBaoCao> tongHop(String csv) {
        return cacNhom(csv).stream().map(BaoCao::sangDong).toList();
    }

    public static String lapBang(String csv) {
        List<Nhom> nhom = cacNhom(csv);
        List<String[]> o = new ArrayList<>();
        o.add(TIEU_DE);
        long dem = 0;
        BigDecimal tong = BigDecimal.ZERO;
        for (Nhom g : nhom) {
            DongBaoCao d = sangDong(g);
            o.add(new String[] {d.nhom(), Long.toString(d.soDong()), d.tong().toPlainString(), d.trungBinh().toPlainString()});
            dem += g.dem();
            tong = tong.add(g.tong());
        }
        DongBaoCao cong = sangDong(new Nhom("Cộng", dem, tong));
        o.add(new String[] {cong.nhom(), Long.toString(cong.soDong()), cong.tong().toPlainString(), cong.trungBinh().toPlainString()});

        int[] rong = new int[4];
        for (String[] r : o) for (int k = 0; k < 4; k++) rong[k] = Math.max(rong[k], r[k].length());
        StringBuilder vach = new StringBuilder();
        for (int k = 0; k < 4; k++) {
            if (k > 0) vach.append("-+-");
            vach.append("-".repeat(rong[k]));
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < o.size(); i++) {
            if (i == 1) sb.append(vach).append('\n');
            if (i == o.size() - 1) sb.append(vach).append('\n');
            String[] r = o.get(i);
            sb.append(r[0]).append(" ".repeat(rong[0] - r[0].length()));
            for (int k = 1; k < 4; k++) sb.append(" | ").append(" ".repeat(rong[k] - r[k].length())).append(r[k]);
            sb.append('\n');
        }
        return sb.toString();
    }

    private static DongBaoCao sangDong(Nhom g) {
        BigDecimal tb = g.dem() == 0 ? BigDecimal.ZERO.setScale(2) : g.tong().divide(BigDecimal.valueOf(g.dem()), 2, LAM_TRON);
        return new DongBaoCao(g.ten(), g.dem(), g.tong().setScale(2, LAM_TRON), tb);
    }

    private static List<Nhom> cacNhom(String csv) {
        List<List<String>> bang = DocCsv.phanTich(csv);
        if (bang.isEmpty()) throw new IllegalArgumentException("thiếu dòng tiêu đề");
        List<String> tieuDe = bang.get(0);
        int iNhom = tieuDe.indexOf("nhom");
        int iTien = tieuDe.indexOf("so_tien");
        if (iNhom < 0 || iTien < 0) throw new IllegalArgumentException("thiếu cột nhom/so_tien");
        Map<String, BigDecimal> tong = new LinkedHashMap<>();
        Map<String, Long> dem = new LinkedHashMap<>();
        for (int i = 1; i < bang.size(); i++) {
            List<String> r = bang.get(i);
            if (r.size() != tieuDe.size()) throw new IllegalArgumentException("bản ghi " + i + " sai số ô");
            BigDecimal v = new BigDecimal(r.get(iTien).trim());
            tong.merge(r.get(iNhom), v, BigDecimal::add);
            dem.merge(r.get(iNhom), 1L, Long::sum);
        }
        List<Nhom> ds = new ArrayList<>();
        for (var e : tong.entrySet()) ds.add(new Nhom(e.getKey(), dem.get(e.getKey()), e.getValue()));
        ds.sort(Comparator.comparing(Nhom::tong).reversed().thenComparing(Nhom::ten));
        return ds;
    }
}
