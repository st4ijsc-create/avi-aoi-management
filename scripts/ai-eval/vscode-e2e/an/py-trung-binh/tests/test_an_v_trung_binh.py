from diem.mo_hinh import BaiKiemTra
from diem.tinh import trung_binh


def test_an_he_so_khac_nhau():
    assert trung_binh([BaiKiemTra("a", 10, 1), BaiKiemTra("b", 4, 2)]) == 6.0


def test_an_mot_bai_he_so_lon():
    assert trung_binh([BaiKiemTra("a", 7.5, 3)]) == 7.5


def test_an_nua_len_khong_kieu_ngan_hang():
    # (8.25 + 8.0) / 2 = 8.125 ⇒ 8.13 (round() cho 8.12)
    assert trung_binh([BaiKiemTra("a", 8.25), BaiKiemTra("b", 8.0)]) == 8.13
    # (6.5·1 + 6.75·1) / 2 = 6.625 ⇒ 6.63 (round() cho 6.62)
    assert trung_binh([BaiKiemTra("a", 6.5), BaiKiemTra("b", 6.75)]) == 6.63


def test_an_lam_tron_xuong_binh_thuong():
    assert trung_binh([BaiKiemTra("a", 1), BaiKiemTra("b", 1), BaiKiemTra("c", 2)]) == 1.33


def test_an_rong_tra_none():
    assert trung_binh([]) is None
