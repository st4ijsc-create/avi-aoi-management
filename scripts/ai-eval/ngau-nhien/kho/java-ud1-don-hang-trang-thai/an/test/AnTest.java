import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Optional;

public class AnTest {
    /** Kho đếm số lần luu, uỷ quyền cho KhoBoNho. */
    static final class KhoDem implements KhoDonHang {
        final KhoBoNho that = new KhoBoNho();
        int soLanLuu = 0;

        @Override
        public void luu(DonHang don) {
            soLanLuu++;
            that.luu(don);
        }

        @Override
        public Optional<DonHang> tim(long ma) {
            return that.tim(ma);
        }

        @Override
        public List<DonHang> tatCa() {
            return that.tatCa();
        }
    }

    static DonHang daGiao(long tong) {
        DonHang d = new DonHang(7, "Khách", tong);
        d.thanhToan(tong);
        d.giao();
        d.nhan();
        return d;
    }

    public static void main(String[] args) {
        Kt.chay("kiểm đầu vào khi tạo đơn; tạo hỏng không tốn mã", () -> {
            Kt.nem(IllegalArgumentException.class, () -> new DonHang(1, " ", 10));
            Kt.nem(IllegalArgumentException.class, () -> new DonHang(1, null, 10));
            Kt.nem(IllegalArgumentException.class, () -> new DonHang(1, "A", 0));
            Kt.nem(IllegalArgumentException.class, () -> new DonHang(1, "A", -5));
            DichVuDonHang dv = new DichVuDonHang(new KhoBoNho());
            Kt.nem(IllegalArgumentException.class, () -> dv.taoDon("", 5));
            Kt.bang(1L, dv.taoDon("B", 5).ma());
            Kt.bang(2L, dv.taoDon("C", 6).ma());
        });
        Kt.chay("đơn mới: trạng thái và sự kiện TAO", () -> {
            DonHang d = new DonHang(9, "Lan", 1_000);
            Kt.bang(TrangThai.CHO_THANH_TOAN, d.trangThai());
            Kt.bang(false, d.daThanhToan());
            Kt.bang(0L, d.daHoan());
            Kt.bang(List.of(new SuKien(1, "TAO", null, TrangThai.CHO_THANH_TOAN, 0)), d.lichSu());
        });
        Kt.chay("thanh toán sai số tiền không đổi gì; thanh toán hai lần bị từ chối", () -> {
            DonHang d = new DonHang(1, "Lan", 1_000);
            Kt.nem(IllegalArgumentException.class, () -> d.thanhToan(999));
            Kt.bang(TrangThai.CHO_THANH_TOAN, d.trangThai());
            Kt.bang(false, d.daThanhToan());
            Kt.bang(1, d.lichSu().size());
            d.thanhToan(1_000);
            Kt.nem(IllegalStateException.class, () -> d.thanhToan(1_000));
            Kt.bang(List.of(new SuKien(1, "TAO", null, TrangThai.CHO_THANH_TOAN, 0),
                new SuKien(2, "THANH_TOAN", TrangThai.CHO_THANH_TOAN, TrangThai.DA_THANH_TOAN, 1_000)), d.lichSu());
        });
        Kt.chay("trạng thái được kiểm TRƯỚC số tiền", () -> {
            DonHang moi = new DonHang(1, "Lan", 1_000);
            Kt.nem(IllegalStateException.class, () -> moi.hoanTien(-5));
            DonHang daTra = new DonHang(2, "Lan", 1_000);
            daTra.thanhToan(1_000);
            Kt.nem(IllegalStateException.class, () -> daTra.thanhToan(-1));
            Kt.nem(IllegalStateException.class, () -> daTra.nhan());
        });
        Kt.chay("huỷ trước khi thanh toán", () -> {
            DonHang d = new DonHang(1, "Lan", 1_000);
            d.huy();
            Kt.bang(TrangThai.DA_HUY, d.trangThai());
            Kt.bang(false, d.daThanhToan());
            Kt.bang(0L, d.daHoan());
            Kt.bang(new SuKien(2, "HUY", TrangThai.CHO_THANH_TOAN, TrangThai.DA_HUY, 0), d.lichSu().get(1));
            Kt.nem(IllegalStateException.class, d::huy);
            Kt.nem(IllegalStateException.class, () -> d.thanhToan(1_000));
        });
        Kt.chay("huỷ sau thanh toán hoàn đủ; không huỷ khi đang giao hoặc đã giao", () -> {
            DonHang d = new DonHang(1, "Lan", 1_000);
            d.thanhToan(1_000);
            d.huy();
            Kt.bang(TrangThai.DA_HUY, d.trangThai());
            Kt.bang(true, d.daThanhToan());
            Kt.bang(1_000L, d.daHoan());
            Kt.bang(new SuKien(3, "HUY", TrangThai.DA_THANH_TOAN, TrangThai.DA_HUY, 1_000), d.lichSu().get(2));
            DonHang dang = new DonHang(2, "Lan", 1_000);
            dang.thanhToan(1_000);
            dang.giao();
            Kt.nem(IllegalStateException.class, dang::huy);
            Kt.nem(IllegalStateException.class, daGiao(500)::huy);
        });
        Kt.chay("hoàn tiền hai lần tới đủ ⇒ DA_HOAN_TIEN", () -> {
            DonHang d = daGiao(100_000);
            d.hoanTien(40_000);
            d.hoanTien(60_000);
            Kt.bang(TrangThai.DA_HOAN_TIEN, d.trangThai());
            Kt.bang(100_000L, d.daHoan());
            List<SuKien> ls = d.lichSu();
            Kt.bang(6, ls.size());
            Kt.bang(new SuKien(5, "HOAN_TIEN", TrangThai.DA_GIAO, TrangThai.DA_GIAO, 40_000), ls.get(4));
            Kt.bang(new SuKien(6, "HOAN_TIEN", TrangThai.DA_GIAO, TrangThai.DA_HOAN_TIEN, 60_000), ls.get(5));
            Kt.nem(IllegalStateException.class, () -> d.hoanTien(1));
            DonHang motLan = daGiao(500);
            motLan.hoanTien(500);
            Kt.bang(TrangThai.DA_HOAN_TIEN, motLan.trangThai());
        });
        Kt.chay("hoàn vượt hoặc không dương bị từ chối, không đổi gì", () -> {
            DonHang d = daGiao(100_000);
            d.hoanTien(70_000);
            Kt.nem(IllegalArgumentException.class, () -> d.hoanTien(40_000));
            Kt.nem(IllegalArgumentException.class, () -> d.hoanTien(0));
            Kt.nem(IllegalArgumentException.class, () -> d.hoanTien(-1));
            Kt.bang(70_000L, d.daHoan());
            Kt.bang(TrangThai.DA_GIAO, d.trangThai());
            Kt.bang(5, d.lichSu().size());
        });
        Kt.chay("lịch sử là bản chụp không sửa được", () -> {
            DonHang d = new DonHang(1, "Lan", 1_000);
            List<SuKien> truoc = d.lichSu();
            d.thanhToan(1_000);
            Kt.bang(1, truoc.size());
            Kt.bang(2, d.lichSu().size());
            Kt.nem(UnsupportedOperationException.class, () -> d.lichSu().add(new SuKien(9, "X", null, null, 0)));
            Kt.nem(UnsupportedOperationException.class, () -> d.lichSu().clear());
        });
        Kt.chay("dịch vụ: mã không có, kho dùng qua giao diện, lưu sau mỗi thao tác thành công", () -> {
            KhoDem kho = new KhoDem();
            DichVuDonHang dv = new DichVuDonHang(kho);
            Kt.nem(NoSuchElementException.class, () -> dv.thanhToan(1, 10));
            Kt.nem(NoSuchElementException.class, () -> dv.giao(1));
            Kt.nem(NoSuchElementException.class, () -> dv.nhan(1));
            Kt.nem(NoSuchElementException.class, () -> dv.huy(1));
            Kt.nem(NoSuchElementException.class, () -> dv.hoanTien(1, 10));
            Kt.bang(0, kho.soLanLuu);
            dv.taoDon("Lan", 300);
            Kt.bang(1, kho.soLanLuu);
            Kt.nem(IllegalStateException.class, () -> dv.giao(1));
            Kt.bang(1, kho.soLanLuu);
            dv.thanhToan(1, 300);
            Kt.bang(2, kho.soLanLuu);
            Kt.nem(IllegalArgumentException.class, () -> dv.taoDon("Minh", 0));
            Kt.bang(2, kho.soLanLuu);
            dv.taoDon("Minh", 200);
            dv.giao(1);
            Kt.bang(4, kho.soLanLuu);
            List<Long> ma = new ArrayList<>();
            for (DonHang d : kho.tatCa()) ma.add(d.ma());
            Kt.bang(List.of(1L, 2L), ma);
            Kt.bang(TrangThai.DANG_GIAO, kho.tim(1).orElseThrow().trangThai());
            Kt.bang(1L, new DichVuDonHang(new KhoBoNho()).taoDon("Khác", 1).ma());
        });
        Kt.chay("doanh thu thuần và đếm theo trạng thái", () -> {
            DichVuDonHang rong = new DichVuDonHang(new KhoBoNho());
            Kt.bang(0L, rong.tongDoanhThuThuan());
            Map<TrangThai, Long> m0 = rong.demTheoTrangThai();
            Kt.bang(List.of(TrangThai.values()), new ArrayList<>(m0.keySet()));
            Kt.bang(List.of(0L, 0L, 0L, 0L, 0L, 0L), new ArrayList<>(m0.values()));

            DichVuDonHang dv = new DichVuDonHang(new KhoBoNho());
            dv.taoDon("A", 100_000); dv.thanhToan(1, 100_000); dv.giao(1); dv.nhan(1); dv.hoanTien(1, 30_000);
            dv.taoDon("B", 50_000);
            dv.taoDon("C", 80_000); dv.thanhToan(3, 80_000); dv.huy(3);
            dv.taoDon("D", 20_000); dv.thanhToan(4, 20_000); dv.giao(4);
            dv.taoDon("E", 10_000); dv.huy(5);
            dv.taoDon("F", 40_000); dv.thanhToan(6, 40_000); dv.giao(6); dv.nhan(6); dv.hoanTien(6, 40_000);
            dv.taoDon("G", 30_000); dv.thanhToan(7, 30_000);
            Kt.bang(120_000L, dv.tongDoanhThuThuan());
            Map<TrangThai, Long> m = dv.demTheoTrangThai();
            Kt.bang(List.of(TrangThai.values()), new ArrayList<>(m.keySet()));
            Kt.bang(List.of(1L, 1L, 1L, 1L, 2L, 1L), new ArrayList<>(m.values()));
        });
        Kt.ketThuc();
    }
}
