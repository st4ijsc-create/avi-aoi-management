from duong_di import duong_re_nhat


def test_duong_co_ban():
    canh = [("A", "B", 1), ("B", "C", 2), ("A", "C", 5)]
    assert duong_re_nhat(canh, "A", "C") == (3, ["A", "B", "C"])


def test_khong_toi_duoc():
    assert duong_re_nhat([("A", "B", 1)], "B", "A") is None


def test_nguon_trung_dich():
    assert duong_re_nhat([("A", "B", 1)], "X", "X") == (0, ["X"])
