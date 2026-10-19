import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.LongSummaryStatistics;
import java.util.Map;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.stream.Collectors;

public final class ThongKe {
    private static final Comparator<XepHang> THU_TU = Comparator.comparingLong(XepHang::tong).reversed()
        .thenComparing(Comparator.comparingLong(XepHang::soDon).reversed())
        .thenComparing(XepHang::khach);

    private ThongKe() {}

    public static TreeMap<String, Long> doanhThuTheoKhuVuc(List<DonBan> ds) {
        return ds.stream().collect(Collectors.groupingBy(DonBan::khuVuc, TreeMap::new,
            Collectors.summingLong(DonBan::thanhTien)));
    }

    public static TreeMap<String, Double> soLuongTrungBinhTheoSanPham(List<DonBan> ds) {
        return ds.stream().collect(Collectors.groupingBy(DonBan::sanPham, TreeMap::new,
            Collectors.averagingDouble(DonBan::soLuong)));
    }

    public static TreeMap<String, List<String>> khachTheoKhuVuc(List<DonBan> ds) {
        return ds.stream().collect(Collectors.groupingBy(DonBan::khuVuc, TreeMap::new,
            Collectors.collectingAndThen(Collectors.mapping(DonBan::khach, Collectors.toCollection(TreeSet::new)),
                ArrayList::new)));
    }

    public static Map<Boolean, Long> demDonLon(List<DonBan> ds, long nguong) {
        return ds.stream().collect(Collectors.partitioningBy(d -> d.thanhTien() >= nguong, Collectors.counting()));
    }

    public static TomTat tomTat(List<DonBan> ds) {
        return ds.stream().collect(Collectors.teeing(
            Collectors.summarizingLong(DonBan::thanhTien),
            Collectors.counting(),
            (LongSummaryStatistics s, Long n) -> n == 0
                ? new TomTat(0, 0, 0, 0, 0.0)
                : new TomTat(n, s.getSum(), s.getMin(), s.getMax(), s.getAverage())));
    }

    public static List<XepHang> topKhach(List<DonBan> ds, int n) {
        if (n < 0) throw new IllegalArgumentException("n âm: " + n);
        Map<String, XepHang> theoKhach = ds.stream().collect(Collectors.groupingBy(DonBan::khach,
            Collectors.teeing(Collectors.summingLong(DonBan::thanhTien), Collectors.counting(),
                (tong, dem) -> new XepHang(null, tong, dem))));
        return theoKhach.entrySet().stream()
            .map(e -> new XepHang(e.getKey(), e.getValue().tong(), e.getValue().soDon()))
            .sorted(THU_TU)
            .limit(n)
            .toList();
    }
}
