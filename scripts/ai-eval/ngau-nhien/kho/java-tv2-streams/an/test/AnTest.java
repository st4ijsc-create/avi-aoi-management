import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class AnTest {
    static final List<DonBan> DS = List.of(
        new DonBan("Nam", "Bút", "Lan", 10, 5_000),
        new DonBan("Bắc", "Vở", "Minh", 3, 12_000),
        new DonBan("Nam", "Vở", "Hùng", 5, 12_000),
        new DonBan("Trung", "Bút", "Lan", 2, 5_000),
        new DonBan("Bắc", "Bút", "Minh", 20, 5_000),
        new DonBan("Nam", "Bút", "Lan", 1, 5_000),
        new DonBan("an giang", "Thước", "Lan", 4, 2_500));

    static final List<DonBan> HOA = List.of(
        new DonBan("X", "p", "Dũng", 1, 50),
        new DonBan("X", "p", "Chi", 1, 50),
        new DonBan("Y", "p", "Bình", 1, 100),
        new DonBan("X", "p", "An", 2, 30),
        new DonBan("Y", "q", "Chi", 5, 10),
        new DonBan("Y", "q", "An", 4, 10));

    public static void main(String[] args) {
        Kt.chay("khoá TreeMap theo thứ tự tự nhiên của String (hoa trước thường)", () -> {
            var m = ThongKe.doanhThuTheoKhuVuc(DS);
            Kt.bang(List.of("Bắc", "Nam", "Trung", "an giang"), new ArrayList<>(m.keySet()));
            Kt.bang(List.of(136_000L, 115_000L, 10_000L, 10_000L), new ArrayList<>(m.values()));
        });
        Kt.chay("số lượng trung bình theo sản phẩm", () -> {
            var m = ThongKe.soLuongTrungBinhTheoSanPham(DS);
            Kt.bang(List.of("Bút", "Thước", "Vở"), new ArrayList<>(m.keySet()));
            Kt.gan(8.25, m.get("Bút"), 1e-12);
            Kt.gan(4.0, m.get("Thước"), 1e-12);
            Kt.gan(4.0, m.get("Vở"), 1e-12);
        });
        Kt.chay("khách theo khu vực: không trùng, tăng dần", () -> {
            var m = ThongKe.khachTheoKhuVuc(DS);
            Kt.bang(List.of("Bắc", "Nam", "Trung", "an giang"), new ArrayList<>(m.keySet()));
            Kt.bang(List.of("Minh"), m.get("Bắc"));
            Kt.bang(List.of("Hùng", "Lan"), m.get("Nam"));
            Kt.bang(List.of("Lan"), m.get("an giang"));
        });
        Kt.chay("đếm đơn lớn: ngưỡng tính cả bằng", () -> {
            var m = ThongKe.demDonLon(DS, 50_000);
            Kt.bang(3L, m.get(true));
            Kt.bang(4L, m.get(false));
        });
        Kt.chay("đếm đơn lớn: luôn đủ hai khoá", () -> {
            var rong = ThongKe.demDonLon(List.of(), 1);
            Kt.bang(2, rong.size());
            Kt.bang(0L, rong.get(true));
            Kt.bang(0L, rong.get(false));
            var tatCa = ThongKe.demDonLon(DS, 0);
            Kt.bang(7L, tatCa.get(true));
            Kt.bang(0L, tatCa.get(false));
        });
        Kt.chay("tóm tắt bảy đơn", () -> {
            TomTat t = ThongKe.tomTat(DS);
            Kt.bang(7L, t.soDon());
            Kt.bang(271_000L, t.tong());
            Kt.bang(5_000L, t.nhoNhat());
            Kt.bang(100_000L, t.lonNhat());
            Kt.gan(271_000.0 / 7, t.trungBinh(), 1e-9);
        });
        Kt.chay("tóm tắt danh sách rỗng toàn số 0", () -> {
            Kt.bang(new TomTat(0, 0, 0, 0, 0.0), ThongKe.tomTat(List.of()));
        });
        Kt.chay("top khách: hoà tổng ⇒ nhiều đơn hơn ⇒ tên tăng dần", () -> {
            Kt.bang(List.of(new XepHang("An", 100, 2), new XepHang("Chi", 100, 2), new XepHang("Bình", 100, 1),
                new XepHang("Dũng", 50, 1)), ThongKe.topKhach(HOA, 10));
            Kt.bang(List.of(new XepHang("An", 100, 2), new XepHang("Chi", 100, 2)), ThongKe.topKhach(HOA, 2));
        });
        Kt.chay("top khách: n = 0, n âm, danh sách rỗng, n vượt", () -> {
            Kt.bang(List.of(), ThongKe.topKhach(DS, 0));
            Kt.bang(List.of(), ThongKe.topKhach(List.of(), 3));
            Kt.nem(IllegalArgumentException.class, () -> ThongKe.topKhach(DS, -1));
            Kt.bang(List.of(new XepHang("Minh", 136_000, 2), new XepHang("Lan", 75_000, 4), new XepHang("Hùng", 60_000, 1)),
                ThongKe.topKhach(DS, 99));
        });
        Kt.chay("danh sách rỗng ⇒ map rỗng", () -> {
            Kt.bang(0, ThongKe.doanhThuTheoKhuVuc(List.of()).size());
            Kt.bang(0, ThongKe.soLuongTrungBinhTheoSanPham(List.of()).size());
            Kt.bang(0, ThongKe.khachTheoKhuVuc(List.of()).size());
        });
        Kt.ketThuc();
    }
}
