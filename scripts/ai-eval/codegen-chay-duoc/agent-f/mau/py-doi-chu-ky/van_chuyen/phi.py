"""Hàm tính phí giao hàng gốc."""
import math
from dataclasses import dataclass


@dataclass(frozen=True)
class DonVanChuyen:
    khoi_luong: float
    khoang_cach: float


@dataclass(frozen=True)
class BieuPhi:
    co_ban: int = 15000
    moi_kg: int = 2000
    moi_km: int = 500
    toi_thieu: int = 20000


BIEU_PHI_CHUAN = BieuPhi()


def tinh_phi(don, *, bieu_phi=BIEU_PHI_CHUAN):
    """Phí giao (đồng) cho một kiện theo biểu phí: khối lượng (kg) và khoảng cách (km) làm tròn lên."""
    if not isinstance(don, DonVanChuyen):
        raise TypeError("don phải là DonVanChuyen")
    if not isinstance(bieu_phi, BieuPhi):
        raise TypeError("bieu_phi phải là BieuPhi")
    if don.khoi_luong < 0 or don.khoang_cach < 0:
        raise ValueError("khối lượng và khoảng cách không được âm")
    phi = bieu_phi.co_ban + bieu_phi.moi_kg * math.ceil(don.khoi_luong) + bieu_phi.moi_km * math.ceil(don.khoang_cach)
    return max(bieu_phi.toi_thieu, phi)
