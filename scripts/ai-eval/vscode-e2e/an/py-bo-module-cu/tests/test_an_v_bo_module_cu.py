import importlib.util
import os

from diem import BaiKiemTra, HocSinh, bao_cao_lop
from diem.tinh import dinh_dang_diem, lam_tron

GOC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_an_cu_py_da_xoa():
    assert not os.path.exists(os.path.join(GOC, "diem", "cu.py"))
    assert importlib.util.find_spec("diem.cu") is None


def test_an_khong_con_import_diem_cu():
    for ten in os.listdir(os.path.join(GOC, "diem")):
        if ten.endswith(".py"):
            with open(os.path.join(GOC, "diem", ten), encoding="utf-8") as f:
                nd = f.read()
            assert "diem.cu" not in nd and "from . import cu" not in nd and "from .cu" not in nd, ten


def test_an_lam_tron_nua_len():
    assert lam_tron(2.675) == 2.68
    assert lam_tron(2.5, 0) == 3.0
    assert lam_tron(1.005) == 1.01
    assert lam_tron(7.333) == 7.33


def test_an_dinh_dang_diem():
    assert dinh_dang_diem(None) == ""
    assert dinh_dang_diem(7) == "7.00"
    assert dinh_dang_diem(2.675) == "2.68"


def test_an_bao_cao_van_chay():
    r = bao_cao_lop([HocSinh("H1", "An", [BaiKiemTra("a", 2.675)])])
    assert r[0]["dtb_hien_thi"] == "2.68"
