"""Khuyến mãi phí giao."""
from .phi import DonVanChuyen, tinh_phi


def phi_sau_giam(khoi_luong, khoang_cach, phan_tram):
    """Phí giao sau khi giảm `phan_tram` % (0..100), làm tròn XUỐNG tới đồng."""
    if not 0 <= phan_tram <= 100:
        raise ValueError("phần trăm giảm phải trong 0..100")
    return tinh_phi(DonVanChuyen(khoi_luong, khoang_cach)) * (100 - phan_tram) // 100
