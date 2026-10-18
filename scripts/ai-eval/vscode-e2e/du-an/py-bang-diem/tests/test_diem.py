from diem import BaiKiemTra, HocSinh, bao_cao_lop, trung_binh, xep_loai


def test_trung_binh_co_he_so():
    bai = [BaiKiemTra("15p", 6, 1), BaiKiemTra("giữa kỳ", 7, 2), BaiKiemTra("cuối kỳ", 9, 3)]
    assert trung_binh(bai) == 7.83


def test_trung_binh_lam_tron_nua_len_va_rong():
    assert trung_binh([BaiKiemTra("a", 8.25), BaiKiemTra("b", 8.0)]) == 8.13
    assert trung_binh([]) is None


def test_xep_loai_bien():
    assert [xep_loai(x) for x in (8, 7.99, 6.5, 6.49, 5, 4.99, None)] == [
        "Giỏi", "Khá", "Khá", "Trung bình", "Trung bình", "Yếu", None]


def test_bao_cao_lop():
    hs = [
        HocSinh("H1", "Nguyễn An", [BaiKiemTra("a", 9), BaiKiemTra("b", 8, 2)]),
        HocSinh("H2", "Trần Bình", []),
    ]
    dong = [(d["ma"], d["ho_ten"], d["dtb"], d["xep_loai"], d["dtb_hien_thi"]) for d in bao_cao_lop(hs)]
    assert dong == [("H1", "Nguyễn An", 8.33, "Giỏi", "8.33"), ("H2", "Trần Bình", None, None, "")]
