import pytest

from kho import DichVuKho, LoiKho, RepoTep


@pytest.fixture
def dv(tmp_path):
    return DichVuKho(RepoTep(str(tmp_path / "kho.json")))


def test_them_nhap_xuat_ton(dv):
    dv.them_san_pham("A1", "Ốc vít M3")
    assert dv.nhap("A1", 100) == 100
    assert dv.xuat("A1", 30) == 70
    assert dv.ton("A1") == 70


def test_xuat_qua_ton_bao_loi_va_khong_doi_ton(dv):
    dv.them_san_pham("A1", "Ốc vít M3")
    dv.nhap("A1", 5)
    with pytest.raises(LoiKho, match="Không đủ hàng A1"):
        dv.xuat("A1", 6)
    assert dv.ton("A1") == 5


def test_san_pham_khong_ton_tai(dv):
    with pytest.raises(LoiKho, match="Không có sản phẩm Z9"):
        dv.nhap("Z9", 1)


def test_bao_cao_ton_thap_va_ngung_kinh_doanh(dv):
    for ma in ["B2", "A1", "C3"]:
        dv.them_san_pham(ma, ma)
    dv.nhap("A1", 50)
    dv.nhap("C3", 2)
    assert dv.bao_cao_ton_thap(10) == ["B2", "C3"]
    dv.ngung_kinh_doanh("B2")
    assert dv.bao_cao_ton_thap(10) == ["C3"]


def test_du_lieu_ben_vung_qua_repo_moi(tmp_path):
    duong = str(tmp_path / "kho.json")
    DichVuKho(RepoTep(duong)).them_san_pham("A1", "Ốc vít")
    DichVuKho(RepoTep(duong)).nhap("A1", 7)
    assert DichVuKho(RepoTep(duong)).ton("A1") == 7
