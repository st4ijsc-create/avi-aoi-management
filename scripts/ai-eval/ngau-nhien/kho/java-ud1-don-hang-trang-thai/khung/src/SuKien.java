/**
 * Một sự kiện trong lịch sử đơn hàng. Tệp cho sẵn — KHÔNG sửa.
 * thuTu: 1, 2, 3… theo thứ tự xảy ra trong MỘT đơn; loai: "TAO", "THANH_TOAN", "GIAO", "NHAN", "HUY", "HOAN_TIEN";
 * truoc/sau: trạng thái trước/sau sự kiện (truoc của "TAO" là null); soTien: số tiền gắn với sự kiện (0 nếu không có).
 */
public record SuKien(int thuTu, String loai, TrangThai truoc, TrangThai sau, long soTien) {}
