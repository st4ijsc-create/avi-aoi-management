from goi_y_tu import TrieGoiY


def test_goi_y_theo_tan_suat():
    t = TrieGoiY()
    t.them("cam", 3)
    t.them("cao", 7)
    t.them("cat", 1)
    t.them("bo", 9)
    assert t.goi_y("ca", 2) == [("cao", 7), ("cam", 3)]
    assert t.goi_y("ca", 10) == [("cao", 7), ("cam", 3), ("cat", 1)]


def test_dem_so_tu_va_tan_suat():
    t = TrieGoiY()
    t.them("mot")
    t.them("hai", 4)
    assert len(t) == 2
    assert t.tan_suat("hai") == 4
    assert t.tan_suat("ba") == 0


def test_xoa_co_ban():
    t = TrieGoiY()
    t.them("xanh", 2)
    t.them("xam", 5)
    assert t.xoa("xam") is True
    assert t.goi_y("x", 5) == [("xanh", 2)]
    assert len(t) == 1
