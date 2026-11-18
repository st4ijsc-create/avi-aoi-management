"""Đơn hàng có giao."""
from .phi import DonVanChuyen, tinh_phi


class DonHang:
    def __init__(self, ma, gia_hang, khoi_luong, khoang_cach):
        self.ma = ma
        self.gia_hang = gia_hang
        self.khoi_luong = khoi_luong
        self.khoang_cach = khoang_cach

    def phi_giao(self):
        return tinh_phi(DonVanChuyen(self.khoi_luong, self.khoang_cach))
