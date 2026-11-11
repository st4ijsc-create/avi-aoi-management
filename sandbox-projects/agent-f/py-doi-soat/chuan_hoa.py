"""Chuẩn hoá dữ liệu tồn kho."""


def chuan_hoa_ma(ma):
    """Mã hàng: bỏ khoảng trắng hai đầu, viết hoa. Rỗng sau khi bỏ khoảng trắng ⇒ ValueError."""
    kq = str(ma).strip().upper()
    if not kq:
        raise ValueError("mã hàng rỗng")
    return kq
