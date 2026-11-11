"""Hoá đơn."""
from .phi import DonVanChuyen, tinh_phi

KHOANG_CACH_NOI_THANH = 5


def tong_hoa_don(don):
    """Giá hàng + phí giao của một DonHang."""
    return don.gia_hang + tinh_phi(DonVanChuyen(don.khoi_luong, don.khoang_cach))


def phi_giao_noi_thanh(khoi_luong):
    """Phí giao nội thành: khoảng cách cố định KHOANG_CACH_NOI_THANH km."""
    return tinh_phi(DonVanChuyen(khoi_luong, KHOANG_CACH_NOI_THANH))
