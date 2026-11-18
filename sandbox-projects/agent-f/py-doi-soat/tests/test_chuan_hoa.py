import pytest

from chuan_hoa import chuan_hoa_ma


def test_bo_khoang_trang_va_viet_hoa():
    assert chuan_hoa_ma("  a01 ") == "A01"


def test_giu_nguyen_ma_da_chuan():
    assert chuan_hoa_ma("B-7") == "B-7"


def test_rong_la_loi():
    with pytest.raises(ValueError):
        chuan_hoa_ma("   ")
