import time

import pytest

from khop_glob import khop


def test_khoang_gom_hai_dau():
    assert khop("[a-c]", "a") is True
    assert khop("[a-c]", "c") is True
    assert khop("[a-c]", "d") is False
    assert khop("[0-9][0-9]", "09") is True
    assert khop("[a-cx-z]", "z") is True
    assert khop("[a-cx-z]", "m") is False


def test_phu_dinh():
    assert khop("[!x]", "y") is True
    assert khop("[!x]", "x") is False
    assert khop("[!a-c]z", "bz") is False
    assert khop("[!a-c]z", "dz") is True
    assert khop("[!x]", "") is False


def test_ngoac_dong_va_gach_ngang_dau_cuoi_la_ky_tu_thuong():
    assert khop("[]]", "]") is True
    assert khop("[]a]", "a") is True
    assert khop("[!]]", "]") is False
    assert khop("[!]]", "q") is True
    assert khop("[-a]", "-") is True
    assert khop("[a-]", "-") is True
    assert khop("[a-]", "b") is False


def test_thoat_ngoai_va_trong_lop():
    assert khop(r"\*", "*") is True
    assert khop(r"\*", "x") is False
    assert khop(r"a\?", "a?") is True
    assert khop(r"a\?", "ab") is False
    assert khop(r"\[x]", "[x]") is True
    assert khop(r"[\]]", "]") is True
    assert khop(r"[a\-z]", "-") is True
    assert khop(r"[a\-z]", "m") is False
    assert khop("\\\\", "\\") is True
    assert khop(r"\a\b", "ab") is True


def test_mau_hong_nem_value_error():
    for mau in ["[abc", "[", "[!", "[]", "abc\\", "[a\\", "[z-a]"]:
        with pytest.raises(ValueError):
            khop(mau, "")


def test_mau_hong_nem_ca_khi_chuoi_da_lech_som():
    with pytest.raises(ValueError):
        khop("x*[", "yyy")
    with pytest.raises(ValueError):
        khop("b[c-a]", "a")


def test_sao_khop_rong_va_nhieu():
    assert khop("a*b*c", "abc") is True
    assert khop("a*b*c", "aXXbYYc") is True
    assert khop("a*b*c", "aXXcYYb") is False
    assert khop("**x**", "x") is True
    assert khop("*?", "") is False
    assert khop("?*", "q") is True
    assert khop("*a", "bab") is False


def test_phan_biet_hoa_thuong_va_unicode():
    assert khop("A*", "abc") is False
    assert khop("[à-ả]?", "ạx") is True
    assert khop("[à-ả]", "ậ") is False
    assert khop("đ?ng", "đúng") is True


def test_hieu_nang_nhieu_sao():
    bat_dau = time.perf_counter()
    assert khop("*a" * 50 + "*b", "a" * 2000) is False
    assert khop("*a" * 50 + "*b", "a" * 1999 + "b") is True
    assert khop("a*" * 30 + "[!a]", "a" * 1500) is False
    assert time.perf_counter() - bat_dau < 5.0
