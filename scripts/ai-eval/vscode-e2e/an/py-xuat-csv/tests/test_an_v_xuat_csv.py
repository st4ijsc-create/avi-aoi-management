import diem
from diem import BaiKiemTra, HocSinh, bao_cao_lop
from diem.xuat import xuat_csv as xuat_csv_mod


def _lop():
    return [
        HocSinh("H1", "Nguyễn An", [BaiKiemTra("a", 8)]),
        HocSinh("H2", "Trần Bình", [BaiKiemTra("a", 9.5)]),
        HocSinh("H3", "Lê Chi", []),
        HocSinh("H4", "Phạm Dũng", [BaiKiemTra("a", 8)]),
        HocSinh("H5", "Võ Em", [BaiKiemTra("a", 4)]),
    ]


def test_an_hang_dong_hang_va_none():
    assert [d["hang"] for d in bao_cao_lop(_lop())] == [2, 1, None, 2, 4]


def test_an_bao_cao_giu_cac_khoa_cu():
    d = bao_cao_lop(_lop())[0]
    assert (d["ma"], d["dtb"], d["xep_loai"], d["dtb_hien_thi"]) == ("H1", 8.0, "Giỏi", "8.00")


def test_an_init_xuat_dung_ham():
    assert diem.xuat_csv is xuat_csv_mod


def test_an_csv_day_du():
    assert xuat_csv_mod(bao_cao_lop(_lop())) == (
        "ma,ho_ten,dtb,xep_loai,hang\n"
        "H1,Nguyễn An,8.00,Giỏi,2\n"
        "H2,Trần Bình,9.50,Giỏi,1\n"
        "H3,Lê Chi,,,\n"
        "H4,Phạm Dũng,8.00,Giỏi,2\n"
        "H5,Võ Em,4.00,Yếu,4\n"
    )


def test_an_csv_rong_chi_tieu_de():
    assert xuat_csv_mod([]) == "ma,ho_ten,dtb,xep_loai,hang\n"


def test_an_csv_trich_dan():
    dong = [{"ma": "H9", "ho_ten": 'Lê "Bé", Na', "dtb": 6.5, "xep_loai": "Khá", "hang": 1}]
    assert xuat_csv_mod(dong) == 'ma,ho_ten,dtb,xep_loai,hang\nH9,"Lê ""Bé"", Na",6.50,Khá,1\n'
