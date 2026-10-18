import java.util.List;
import java.util.Optional;

/** Kho lưu đơn hàng. Tệp cho sẵn — KHÔNG sửa. */
public interface KhoDonHang {
    /** Thêm mới hoặc thay thế đơn có cùng mã. */
    void luu(DonHang don);

    /** Đơn theo mã, hoặc Optional.empty() nếu không có. */
    Optional<DonHang> tim(long ma);

    /** Mọi đơn, sắp theo mã tăng dần. */
    List<DonHang> tatCa();
}
