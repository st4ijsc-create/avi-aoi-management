"""LỖI THỜI — giữ lại cho mã cũ. Đừng thêm gì vào đây."""


def lam_tron(x, so_chu_so=2):
    return round(x, so_chu_so)


def dinh_dang_diem(x):
    """Điểm ⇒ chuỗi 2 chữ số thập phân; None ⇒ chuỗi rỗng."""
    return "" if x is None else f"{lam_tron(x):.2f}"
