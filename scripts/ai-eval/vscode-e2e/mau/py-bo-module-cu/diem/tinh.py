from decimal import ROUND_HALF_UP, Decimal


def lam_tron(x, so_chu_so=2):
    """Làm tròn kiểu nửa-lên trên biểu diễn thập phân (2.675 ⇒ 2.68), không theo kiểu ngân hàng của round()."""
    return float(Decimal(str(x)).quantize(Decimal(1).scaleb(-so_chu_so), rounding=ROUND_HALF_UP))


def dinh_dang_diem(x):
    """Điểm ⇒ chuỗi 2 chữ số thập phân; None ⇒ chuỗi rỗng."""
    return "" if x is None else f"{lam_tron(x):.2f}"


def trung_binh(bai):
    """Điểm trung bình CÓ HỆ SỐ của danh sách BaiKiemTra, làm tròn 2 chữ số nửa-lên; không có bài ⇒ None."""
    if not bai:
        return None
    tong_he_so = sum(b.he_so for b in bai)
    return lam_tron(sum(b.diem * b.he_so for b in bai) / tong_he_so)
