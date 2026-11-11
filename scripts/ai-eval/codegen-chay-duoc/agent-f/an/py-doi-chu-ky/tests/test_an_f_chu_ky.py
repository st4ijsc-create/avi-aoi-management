"""Test ẩn bài py-doi-chu-ky: chữ ký mới của tinh_phi, hành vi mọi đường gọi giữ nguyên, không còn lời gọi kiểu cũ."""
import ast
import dataclasses
import pathlib

import pytest

import van_chuyen
from van_chuyen import BIEU_PHI_CHUAN, BieuPhi, DonHang, DonVanChuyen, bao_gia_nhieu, bao_gia_re_nhat, phi_giao_noi_thanh, phi_sau_giam, tinh_phi, tong_hoa_don

GOI = pathlib.Path(van_chuyen.__file__).parent


def test_hai_vi_du_so_trong_de():
    assert tinh_phi(DonVanChuyen(2.3, 12.5)) == 27500
    assert tinh_phi(DonVanChuyen(0.4, 1)) == 20000


def test_bieu_phi_tuy_chinh_va_mac_dinh():
    bp = BieuPhi(co_ban=10000, moi_kg=1000, moi_km=100, toi_thieu=12000)
    assert tinh_phi(DonVanChuyen(2.3, 12.5), bieu_phi=bp) == 10000 + 3000 + 1300
    assert tinh_phi(DonVanChuyen(0, 0), bieu_phi=bp) == 12000
    assert BIEU_PHI_CHUAN == BieuPhi(15000, 2000, 500, 20000)
    assert tinh_phi(DonVanChuyen(5, 30), bieu_phi=BIEU_PHI_CHUAN) == 40000


def test_kieu_du_lieu_bat_bien():
    for lop in (DonVanChuyen, BieuPhi):
        assert dataclasses.is_dataclass(lop)
    d = DonVanChuyen(1, 2)
    with pytest.raises(dataclasses.FrozenInstanceError):
        d.khoi_luong = 3
    with pytest.raises(dataclasses.FrozenInstanceError):
        BIEU_PHI_CHUAN.co_ban = 0


def test_chu_ky_cu_bi_tu_choi():
    with pytest.raises(TypeError):
        tinh_phi(2, 10)
    with pytest.raises(TypeError):
        tinh_phi(2.0)
    with pytest.raises(TypeError):
        tinh_phi(DonVanChuyen(1, 1), BIEU_PHI_CHUAN)  # bieu_phi chỉ nhận theo tên


def test_so_am_van_loi_gia_tri():
    with pytest.raises(ValueError):
        tinh_phi(DonVanChuyen(-1, 2))


def test_moi_duong_goi_giu_hanh_vi():
    assert DonHang("A1", 100000, 2.3, 12.5).phi_giao() == 27500
    assert bao_gia_nhieu([(5, 30), (1, 2), (10, 0)]) == [40000, 20000, 35000]
    assert tong_hoa_don(DonHang("A3", 250000, 3, 8)) == 275000
    assert phi_sau_giam(2.3, 12.5, 15) == 23375


def test_duong_goi_gian_tiep_qua_tham_so_ham():
    # _chon_re_nhat nhận hàm làm tham số — đổi tên tinh_phi bằng grep không thấy chỗ này
    assert bao_gia_re_nhat([(5, 30), (2.1, 3), (1, 2), (1, 1)]) == (2, 20000)
    assert bao_gia_re_nhat([(7, 7)]) == (0, 15000 + 14000 + 3500)
    assert bao_gia_re_nhat([]) is None


def test_duong_goi_gian_tiep_qua_partial():
    assert phi_giao_noi_thanh(3.5) == 25500
    assert phi_giao_noi_thanh(0) == 20000


def test_khong_con_loi_goi_kieu_cu_trong_goi():
    """Không còn lời gọi `tinh_phi(a, b)` hai đối số vị trí, và không còn `partial(tinh_phi, ... khoang_cach=...)`."""
    sai = []
    for tep in sorted(GOI.glob("*.py")):
        cay = ast.parse(tep.read_text(encoding="utf-8"))
        for nut in ast.walk(cay):
            if not isinstance(nut, ast.Call):
                continue
            ten = nut.func.id if isinstance(nut.func, ast.Name) else nut.func.attr if isinstance(nut.func, ast.Attribute) else None
            if ten == "tinh_phi" and len(nut.args) >= 2:
                sai.append(f"{tep.name}:{nut.lineno}")
            if ten == "partial" and nut.args and isinstance(nut.args[0], ast.Name) and nut.args[0].id == "tinh_phi" and any(k.arg in ("khoi_luong", "khoang_cach") for k in nut.keywords):
                sai.append(f"{tep.name}:{nut.lineno} partial")
    assert sai == []


def test_xuat_tu_goi():
    for ten in ("DonVanChuyen", "BieuPhi", "BIEU_PHI_CHUAN", "tinh_phi"):
        assert ten in van_chuyen.__all__, ten
