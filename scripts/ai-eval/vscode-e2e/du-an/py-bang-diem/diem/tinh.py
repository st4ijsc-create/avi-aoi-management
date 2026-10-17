from decimal import ROUND_HALF_UP, Decimal


def _nua_len(x, so_chu_so=2):
    """Làm tròn kiểu nửa-lên trên biểu diễn thập phân (8.125 ⇒ 8.13), không theo kiểu ngân hàng của round()."""
    return float(Decimal(str(x)).quantize(Decimal(1).scaleb(-so_chu_so), rounding=ROUND_HALF_UP))


def trung_binh(bai):
    """Điểm trung bình CÓ HỆ SỐ của danh sách BaiKiemTra, làm tròn 2 chữ số nửa-lên; không có bài ⇒ None."""
    if not bai:
        return None
    tong_he_so = sum(b.he_so for b in bai)
    return _nua_len(sum(b.diem * b.he_so for b in bai) / tong_he_so)
