import java.util.EnumMap;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.function.Consumer;

public final class DichVuDonHang {
    private final KhoDonHang kho;
    private long maKe = 1;

    public DichVuDonHang(KhoDonHang kho) {
        this.kho = Objects.requireNonNull(kho);
    }

    public DonHang taoDon(String khach, long tongTien) {
        DonHang d = new DonHang(maKe, khach, tongTien);
        maKe++;
        kho.luu(d);
        return d;
    }

    public DonHang thanhToan(long ma, long soTien) {
        return lam(ma, d -> d.thanhToan(soTien));
    }

    public DonHang giao(long ma) {
        return lam(ma, DonHang::giao);
    }

    public DonHang nhan(long ma) {
        return lam(ma, DonHang::nhan);
    }

    public DonHang huy(long ma) {
        return lam(ma, DonHang::huy);
    }

    public DonHang hoanTien(long ma, long soTien) {
        return lam(ma, d -> d.hoanTien(soTien));
    }

    public long tongDoanhThuThuan() {
        long tong = 0;
        for (DonHang d : kho.tatCa()) {
            if (d.daThanhToan()) tong += d.tongTien() - d.daHoan();
        }
        return tong;
    }

    public Map<TrangThai, Long> demTheoTrangThai() {
        Map<TrangThai, Long> m = new EnumMap<>(TrangThai.class);
        for (TrangThai t : TrangThai.values()) m.put(t, 0L);
        for (DonHang d : kho.tatCa()) m.merge(d.trangThai(), 1L, Long::sum);
        return m;
    }

    private DonHang lam(long ma, Consumer<DonHang> viec) {
        DonHang d = kho.tim(ma).orElseThrow(() -> new NoSuchElementException("không có đơn " + ma));
        viec.accept(d);
        kho.luu(d);
        return d;
    }
}
