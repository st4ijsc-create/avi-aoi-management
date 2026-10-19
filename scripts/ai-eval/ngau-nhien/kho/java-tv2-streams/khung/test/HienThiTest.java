import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class HienThiTest {
    static final List<DonBan> DS = List.of(
        new DonBan("Nam", "Bút", "Lan", 10, 5_000),
        new DonBan("Bắc", "Vở", "Minh", 3, 12_000),
        new DonBan("Nam", "Vở", "Hùng", 5, 12_000),
        new DonBan("Trung", "Bút", "Lan", 2, 5_000),
        new DonBan("Bắc", "Bút", "Minh", 20, 5_000),
        new DonBan("Nam", "Bút", "Lan", 1, 5_000));

    public static void main(String[] args) {
        Kt.chay("doanh thu theo khu vực (TreeMap)", () -> {
            var m = ThongKe.doanhThuTheoKhuVuc(DS);
            Kt.bang(Map.of("Bắc", 136_000L, "Nam", 115_000L, "Trung", 10_000L), m);
            Kt.bang(List.of("Bắc", "Nam", "Trung"), new ArrayList<>(m.keySet()));
        });
        Kt.chay("top 2 khách", () -> {
            Kt.bang(List.of(new XepHang("Minh", 136_000, 2), new XepHang("Lan", 65_000, 3)), ThongKe.topKhach(DS, 2));
        });
        Kt.chay("tóm tắt thành tiền", () -> {
            Kt.bang(new TomTat(6, 261_000, 5_000, 100_000, 43_500.0), ThongKe.tomTat(DS));
        });
        Kt.ketThuc();
    }
}
