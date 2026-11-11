"""Hàm tính phí giao hàng gốc."""
import math

CO_BAN = 15000
MOI_KG = 2000
MOI_KM = 500
TOI_THIEU = 20000


def tinh_phi(khoi_luong, khoang_cach):
    """Phí giao (đồng) cho một kiện: khối lượng (kg) và khoảng cách (km) làm tròn lên."""
    if khoi_luong < 0 or khoang_cach < 0:
        raise ValueError("khối lượng và khoảng cách không được âm")
    phi = CO_BAN + MOI_KG * math.ceil(khoi_luong) + MOI_KM * math.ceil(khoang_cach)
    return max(TOI_THIEU, phi)
