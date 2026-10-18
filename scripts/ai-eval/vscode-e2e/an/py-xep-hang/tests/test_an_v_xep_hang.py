from diem.xep_hang import xep_hang


def test_an_khong_dong_hang():
    assert xep_hang({"A": 7.0, "B": 9.5, "C": 8.0}) == {"A": 3, "B": 1, "C": 2}


def test_an_dong_hang_nhay_hang():
    assert xep_hang({"A": 8.0, "B": 9.0, "C": 8.0, "D": 6.0}) == {"A": 2, "B": 1, "C": 2, "D": 4}


def test_an_ba_nguoi_dong_hang_dau():
    assert xep_hang({"A": 5.0, "B": 5.0, "C": 5.0, "D": 4.0}) == {"A": 1, "B": 1, "C": 1, "D": 4}


def test_an_none_khong_xep_hang():
    assert xep_hang({"A": None, "B": 6.5, "C": None}) == {"A": None, "B": 1, "C": None}


def test_an_rong():
    assert xep_hang({}) == {}


def test_an_giu_thu_tu_khoa_dau_vao():
    assert list(xep_hang({"Z": 1.0, "A": 2.0, "M": None})) == ["Z", "A", "M"]
