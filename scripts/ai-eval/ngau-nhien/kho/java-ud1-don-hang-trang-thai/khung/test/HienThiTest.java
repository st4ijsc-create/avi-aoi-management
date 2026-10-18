import java.util.List;

public class HienThiTest {
    static List<String> cacLoai(DonHang d) {
        return d.lichSu().stream().map(SuKien::loai).toList();
    }

    public static void main(String[] args) {
        Kt.chay("đường đi bình thường tới DA_GIAO", () -> {
            DichVuDonHang dv = new DichVuDonHang(new KhoBoNho());
            DonHang d = dv.taoDon("Lan", 100_000);
            Kt.bang(1L, d.ma());
            dv.thanhToan(1, 100_000);
            dv.giao(1);
            DonHang sau = dv.nhan(1);
            Kt.bang(TrangThai.DA_GIAO, sau.trangThai());
            Kt.bang(List.of("TAO", "THANH_TOAN", "GIAO", "NHAN"), cacLoai(sau));
        });
        Kt.chay("giao trước khi thanh toán bị từ chối", () -> {
            DichVuDonHang dv = new DichVuDonHang(new KhoBoNho());
            dv.taoDon("Minh", 50_000);
            Kt.nem(IllegalStateException.class, () -> dv.giao(1));
        });
        Kt.chay("hoàn tiền một phần", () -> {
            DichVuDonHang dv = new DichVuDonHang(new KhoBoNho());
            dv.taoDon("Hùng", 100_000);
            dv.thanhToan(1, 100_000);
            dv.giao(1);
            dv.nhan(1);
            DonHang d = dv.hoanTien(1, 30_000);
            Kt.bang(30_000L, d.daHoan());
            Kt.bang(TrangThai.DA_GIAO, d.trangThai());
            Kt.bang(70_000L, dv.tongDoanhThuThuan());
        });
        Kt.ketThuc();
    }
}
