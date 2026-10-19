import java.util.ArrayList;
import java.util.List;

public final class DonHang {
    private final long ma;
    private final String khach;
    private final long tongTien;
    private TrangThai trangThai = TrangThai.CHO_THANH_TOAN;
    private boolean daThanhToan;
    private long daHoan;
    private final List<SuKien> lichSu = new ArrayList<>();

    public DonHang(long ma, String khach, long tongTien) {
        if (khach == null || khach.isBlank()) throw new IllegalArgumentException("khách trống");
        if (tongTien <= 0) throw new IllegalArgumentException("tổng tiền phải dương");
        this.ma = ma;
        this.khach = khach;
        this.tongTien = tongTien;
        lichSu.add(new SuKien(1, "TAO", null, TrangThai.CHO_THANH_TOAN, 0));
    }

    public long ma() {
        return ma;
    }

    public String khach() {
        return khach;
    }

    public long tongTien() {
        return tongTien;
    }

    public TrangThai trangThai() {
        return trangThai;
    }

    public boolean daThanhToan() {
        return daThanhToan;
    }

    public long daHoan() {
        return daHoan;
    }

    public List<SuKien> lichSu() {
        return List.copyOf(lichSu);
    }

    public void thanhToan(long soTien) {
        canTrangThai(TrangThai.CHO_THANH_TOAN, "thanh toán");
        if (soTien != tongTien) throw new IllegalArgumentException("phải thanh toán đúng " + tongTien);
        daThanhToan = true;
        chuyen("THANH_TOAN", TrangThai.DA_THANH_TOAN, soTien);
    }

    public void giao() {
        canTrangThai(TrangThai.DA_THANH_TOAN, "giao");
        chuyen("GIAO", TrangThai.DANG_GIAO, 0);
    }

    public void nhan() {
        canTrangThai(TrangThai.DANG_GIAO, "nhận");
        chuyen("NHAN", TrangThai.DA_GIAO, 0);
    }

    public void huy() {
        if (trangThai == TrangThai.CHO_THANH_TOAN) {
            chuyen("HUY", TrangThai.DA_HUY, 0);
        } else if (trangThai == TrangThai.DA_THANH_TOAN) {
            daHoan = tongTien;
            chuyen("HUY", TrangThai.DA_HUY, tongTien);
        } else {
            throw new IllegalStateException("không huỷ được ở trạng thái " + trangThai);
        }
    }

    public void hoanTien(long soTien) {
        canTrangThai(TrangThai.DA_GIAO, "hoàn tiền");
        if (soTien <= 0 || daHoan + soTien > tongTien) {
            throw new IllegalArgumentException("số tiền hoàn không hợp lệ: " + soTien);
        }
        daHoan += soTien;
        chuyen("HOAN_TIEN", daHoan == tongTien ? TrangThai.DA_HOAN_TIEN : TrangThai.DA_GIAO, soTien);
    }

    private void canTrangThai(TrangThai can, String viec) {
        if (trangThai != can) throw new IllegalStateException("không " + viec + " được ở trạng thái " + trangThai);
    }

    private void chuyen(String loai, TrangThai sau, long soTien) {
        lichSu.add(new SuKien(lichSu.size() + 1, loai, trangThai, sau, soTien));
        trangThai = sau;
    }
}
