import pytest

from duong_di import duong_re_nhat


def test_trong_so_am_nem_loi():
    with pytest.raises(ValueError):
        duong_re_nhat([("A", "B", 1), ("B", "C", -1)], "A", "C")


def test_trong_so_am_nem_ca_khi_nguon_trung_dich():
    with pytest.raises(ValueError):
        duong_re_nhat([("Q", "R", -2)], "A", "A")


def test_hoa_chi_phi_chon_it_canh():
    canh = [("A", "B", 2), ("B", "D", 2), ("A", "D", 4)]
    assert duong_re_nhat(canh, "A", "D") == (4, ["A", "D"])


def test_hoa_chi_phi_va_so_canh_chon_tu_dien():
    canh = [("A", "C", 1), ("C", "D", 1), ("A", "B", 1), ("B", "D", 1)]
    assert duong_re_nhat(canh, "A", "D") == (2, ["A", "B", "D"])


def test_it_canh_uu_tien_hon_tu_dien():
    canh = [("A", "B", 1), ("B", "C", 1), ("C", "D", 1), ("A", "X", 1), ("X", "D", 2)]
    assert duong_re_nhat(canh, "A", "D") == (3, ["A", "X", "D"])


def test_canh_song_song():
    canh = [("A", "B", 5), ("A", "B", 1), ("B", "C", 1)]
    assert duong_re_nhat(canh, "A", "C") == (2, ["A", "B", "C"])


def test_trong_so_khong():
    canh = [("A", "B", 0), ("B", "C", 0), ("A", "C", 0)]
    assert duong_re_nhat(canh, "A", "C") == (0, ["A", "C"])


def test_chu_trinh_khong_treo_va_dich_ngoai_do_thi():
    canh = [("A", "B", 1), ("B", "A", 1), ("B", "C", 1)]
    assert duong_re_nhat(canh, "A", "C") == (2, ["A", "B", "C"])
    assert duong_re_nhat(canh, "A", "Z") is None


def test_luoi_lon_hon():
    # lưới 4x4, đi phải (trọng số 1) hoặc xuống (trọng số 2); ô (1,1) đi xuống rẻ bất thường
    canh = []
    for r in range(4):
        for c in range(4):
            if c < 3:
                canh.append((f"{r}{c}", f"{r}{c + 1}", 1))
            if r < 3:
                canh.append((f"{r}{c}", f"{r + 1}{c}", 0 if (r, c) == (1, 1) else 2))
    chi_phi, duong = duong_re_nhat(canh, "00", "33")
    assert chi_phi == 7
    assert duong == ["00", "01", "11", "21", "22", "23", "33"]
