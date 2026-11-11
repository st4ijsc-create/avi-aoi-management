import pytest

from van_chuyen import DonHang, bao_gia_nhieu, bao_gia_re_nhat, phi_giao_noi_thanh, phi_sau_giam, tong_hoa_don


def test_phi_giao_don_hang_lam_tron_len():
    # 15000 + 2000*3 + 500*13
    assert DonHang("A1", 100000, 2.3, 12.5).phi_giao() == 27500


def test_phi_toi_thieu():
    assert DonHang("A2", 0, 0.4, 1).phi_giao() == 20000


def test_bao_gia_nhieu_va_re_nhat():
    ds = [(5, 30), (1, 2), (1, 2), (10, 0)]
    assert bao_gia_nhieu(ds) == [40000, 20000, 20000, 35000]
    assert bao_gia_re_nhat(ds) == (1, 20000)
    assert bao_gia_re_nhat([]) is None


def test_tong_hoa_don():
    assert tong_hoa_don(DonHang("A3", 250000, 3, 8)) == 250000 + 25000


def test_phi_giao_noi_thanh():
    # 15000 + 2000*4 + 500*5
    assert phi_giao_noi_thanh(3.5) == 25500


def test_phi_sau_giam():
    assert phi_sau_giam(2.3, 12.5, 15) == 23375
    with pytest.raises(ValueError):
        phi_sau_giam(1, 1, 101)
