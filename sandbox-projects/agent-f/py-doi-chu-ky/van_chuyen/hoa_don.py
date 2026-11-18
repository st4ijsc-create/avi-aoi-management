"""Hoá đơn."""
from functools import partial

from .phi import tinh_phi

KHOANG_CACH_NOI_THANH = 5

_phi_noi_thanh = partial(tinh_phi, khoang_cach=KHOANG_CACH_NOI_THANH)


def tong_hoa_don(don):
    """Giá hàng + phí giao của một DonHang."""
    return don.gia_hang + tinh_phi(don.khoi_luong, don.khoang_cach)


def phi_giao_noi_thanh(khoi_luong):
    """Phí giao nội thành: khoảng cách cố định KHOANG_CACH_NOI_THANH km."""
    return _phi_noi_thanh(khoi_luong=khoi_luong)
