/** Một đơn bán. Tệp cho sẵn — KHÔNG sửa. */
public record DonBan(String khuVuc, String sanPham, String khach, int soLuong, long donGia) {
    /** Thành tiền = soLuong × donGia (tính bằng long). */
    public long thanhTien() {
        return soLuong * donGia;
    }
}
