import copy


class KhoDonHang:
    """Kho đơn hàng trong bộ nhớ (mỗi đối tượng là một kho riêng)."""

    def __init__(self):
        self._don = {}
        self._id_ke = 1

    def tao(self, khach, dong):
        """Tạo đơn mới (trạng thái "moi"), trả dict đơn hàng."""
        dong_sach = [{"ma": d["ma"].strip(), "so_luong": d["so_luong"], "don_gia": d["don_gia"]} for d in dong]
        don = {
            "id": self._id_ke,
            "khach": khach.strip(),
            "dong": dong_sach,
            "trang_thai": "moi",
            "tong": sum(d["so_luong"] * d["don_gia"] for d in dong_sach),
        }
        self._don[don["id"]] = don
        self._id_ke += 1
        return copy.deepcopy(don)

    def lay(self, ma):
        """Dict đơn hàng có id `ma`, hoặc None."""
        don = self._don.get(ma)
        return None if don is None else copy.deepcopy(don)

    def danh_sach(self, trang_thai=None):
        """List dict đơn hàng theo id tăng dần, lọc theo trạng thái nếu khác None."""
        return [copy.deepcopy(self._don[k]) for k in sorted(self._don)
                if trang_thai is None or self._don[k]["trang_thai"] == trang_thai]

    def doi_trang_thai(self, ma, trang_thai):
        """Đặt trạng thái mới cho đơn `ma`, trả dict đơn hàng sau khi đổi."""
        self._don[ma]["trang_thai"] = trang_thai
        return copy.deepcopy(self._don[ma])
