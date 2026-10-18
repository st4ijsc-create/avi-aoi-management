import random
import time

import pytest

from goi_y_tu import TrieGoiY


def test_cong_don_tan_suat():
    t = TrieGoiY()
    t.them("an", 2)
    t.them("an", 3)
    t.them("an")
    assert t.tan_suat("an") == 6
    assert len(t) == 1
    assert t.goi_y("a", 3) == [("an", 6)]


def test_khong_phan_biet_hoa_thuong():
    t = TrieGoiY()
    t.them("Hà Nội")
    t.them("hà nội", 2)
    t.them("HẢI PHÒNG", 4)
    assert t.tan_suat("HÀ NỘI") == 3
    assert len(t) == 2
    assert t.goi_y("H", 5) == [("hải phòng", 4), ("hà nội", 3)]
    assert t.goi_y("HÀ", 5) == [("hà nội", 3)]


def test_hoa_tan_suat_xep_tu_dien():
    t = TrieGoiY()
    for tu in ["tre", "tao", "tim", "ta", "tu"]:
        t.them(tu, 2)
    t.them("to", 5)
    assert t.goi_y("t", 4) == [("to", 5), ("ta", 2), ("tao", 2), ("tim", 2)]


def test_tien_to_la_mot_tu_va_khong_khop():
    t = TrieGoiY()
    t.them("ca", 1)
    t.them("cam", 2)
    t.them("canh", 1)
    assert t.goi_y("ca", 5) == [("cam", 2), ("ca", 1), ("canh", 1)]
    assert t.goi_y("cam", 5) == [("cam", 2)]
    assert t.goi_y("cb", 5) == []
    assert t.goi_y("camx", 5) == []


def test_k_khong_duong_va_tien_to_rong():
    t = TrieGoiY()
    t.them("b", 1)
    t.them("a", 1)
    t.them("c", 3)
    assert t.goi_y("", 0) == []
    assert t.goi_y("", -3) == []
    assert t.goi_y("", 10) == [("c", 3), ("a", 1), ("b", 1)]


def test_xoa_tien_to_khong_phai_tu_va_them_lai():
    t = TrieGoiY()
    t.them("abc", 4)
    assert t.xoa("ab") is False
    assert t.xoa("abcd") is False
    assert t.xoa("") is False
    assert len(t) == 1
    assert t.xoa("ABC") is True
    assert t.xoa("abc") is False
    assert len(t) == 0
    assert t.goi_y("a", 5) == []
    assert t.tan_suat("abc") == 0
    t.them("abc")
    assert t.tan_suat("abc") == 1


def test_xoa_giu_tu_chung_tien_to():
    t = TrieGoiY()
    t.them("ab", 3)
    t.them("abc", 1)
    t.them("abd", 2)
    assert t.xoa("ab") is True
    assert t.goi_y("ab", 5) == [("abd", 2), ("abc", 1)]
    assert t.xoa("abd") is True
    assert t.goi_y("a", 5) == [("abc", 1)]
    assert t.tan_suat("abc") == 1
    assert len(t) == 1


def test_loi_dau_vao_khong_doi_trang_thai():
    t = TrieGoiY()
    with pytest.raises(ValueError):
        t.them("")
    with pytest.raises(ValueError):
        t.them("x", 0)
    with pytest.raises(ValueError):
        t.them("x", -2)
    assert len(t) == 0
    assert t.tan_suat("x") == 0
    assert t.goi_y("", 5) == []


def test_hieu_nang_nhieu_truy_van():
    ngau = random.Random(7)
    chu = "abcdefghij"
    t = TrieGoiY()
    tu_da_them = {}
    for _ in range(30000):
        tu = "".join(ngau.choice(chu) for _ in range(ngau.randint(4, 8)))
        f = ngau.randint(1, 50)
        t.them(tu, f)
        tu_da_them[tu] = tu_da_them.get(tu, 0) + f
    truy_van = ["".join(ngau.choice(chu) for _ in range(3)) for _ in range(3000)]
    bat_dau = time.perf_counter()
    ket_qua = [t.goi_y(q, 5) for q in truy_van]
    assert time.perf_counter() - bat_dau < 3.0
    assert len(t) == len(tu_da_them)
    for q, kq in list(zip(truy_van, ket_qua))[:50]:
        ky_vong = sorted(((w, f) for w, f in tu_da_them.items() if w.startswith(q)), key=lambda p: (-p[1], p[0]))[:5]
        assert kq == ky_vong
