class KhoDonHang:
    """Kho đơn hàng trong bộ nhớ (mỗi đối tượng là một kho riêng)."""

    def __init__(self):
        raise NotImplementedError

    def tao(self, khach, dong):
        """Tạo đơn mới (trạng thái "moi"), trả dict đơn hàng."""
        raise NotImplementedError

    def lay(self, ma):
        """Dict đơn hàng có id `ma`, hoặc None."""
        raise NotImplementedError

    def danh_sach(self, trang_thai=None):
        """List dict đơn hàng theo id tăng dần, lọc theo trạng thái nếu khác None."""
        raise NotImplementedError

    def doi_trang_thai(self, ma, trang_thai):
        """Đặt trạng thái mới cho đơn `ma`, trả dict đơn hàng sau khi đổi."""
        raise NotImplementedError
