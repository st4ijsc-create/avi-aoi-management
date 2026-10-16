# TEST ẨN bộ F (py-kho-cache) — chép vào dự án lúc chấm, xoá sau khi chấm. Không phải tệp của dự án.
import pytest

from kho import DichVuKho, LoiKho, RepoCoCache, RepoTep, SanPham


class NguonDem:
    """Repo giả trong bộ nhớ, đếm số lần gọi."""

    def __init__(self):
        self.du_lieu = {}
        self.dem = {"lay": 0, "luu": 0, "xoa": 0, "tat_ca": 0}

    def lay(self, ma):
        self.dem["lay"] += 1
        sp = self.du_lieu.get(ma)
        return SanPham(sp.ma, sp.ten, sp.so_luong) if sp else None

    def luu(self, sp):
        self.dem["luu"] += 1
        self.du_lieu[sp.ma] = SanPham(sp.ma, sp.ten, sp.so_luong)

    def xoa(self, ma):
        self.dem["xoa"] += 1
        return self.du_lieu.pop(ma, None) is not None

    def tat_ca(self):
        self.dem["tat_ca"] += 1
        return [SanPham(s.ma, s.ten, s.so_luong) for _, s in sorted(self.du_lieu.items())]


class DongHo:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def test_an_lay_lan_hai_trung_cache():
    n = NguonDem()
    n.du_lieu["A1"] = SanPham("A1", "Ốc", 5)
    r = RepoCoCache(n, ttl_giay=30, dong_ho=DongHo())
    assert r.lay("A1").so_luong == 5
    assert r.lay("A1").so_luong == 5
    assert n.dem["lay"] == 1
    assert r.thong_ke() == {"trung": 1, "truot": 1}


def test_an_het_han_theo_ttl():
    n = NguonDem()
    n.du_lieu["A1"] = SanPham("A1", "Ốc", 5)
    dh = DongHo()
    r = RepoCoCache(n, ttl_giay=30, dong_ho=dh)
    r.lay("A1")
    dh.t += 29.9
    r.lay("A1")
    assert n.dem["lay"] == 1
    dh.t += 0.1  # tuổi = 30 ⇒ hết hạn
    r.lay("A1")
    assert n.dem["lay"] == 2


def test_an_ket_qua_none_cung_duoc_cache():
    n = NguonDem()
    r = RepoCoCache(n, ttl_giay=30, dong_ho=DongHo())
    assert r.lay("Z9") is None
    assert r.lay("Z9") is None
    assert n.dem["lay"] == 1


def test_an_luu_ghi_xuyen_va_cap_nhat_cache():
    n = NguonDem()
    r = RepoCoCache(n, ttl_giay=30, dong_ho=DongHo())
    assert r.lay("A1") is None
    r.luu(SanPham("A1", "Ốc", 9))
    assert n.du_lieu["A1"].so_luong == 9
    assert r.lay("A1").so_luong == 9
    assert n.dem["lay"] == 1


def test_an_xoa_bo_khoi_cache():
    n = NguonDem()
    r = RepoCoCache(n, ttl_giay=30, dong_ho=DongHo())
    r.luu(SanPham("A1", "Ốc", 9))
    assert r.xoa("A1") is True
    assert "A1" not in n.du_lieu
    assert r.lay("A1") is None
    assert r.xoa("A1") is False


def test_an_tat_ca_luon_doc_nguon():
    n = NguonDem()
    r = RepoCoCache(n, ttl_giay=30, dong_ho=DongHo())
    r.luu(SanPham("B2", "Bu lông", 1))
    r.tat_ca()
    r.tat_ca()
    assert n.dem["tat_ca"] == 2
    assert [s.ma for s in r.tat_ca()] == ["B2"]


def test_an_tra_ban_sao_khong_lam_hong_cache():
    n = NguonDem()
    n.du_lieu["A1"] = SanPham("A1", "Ốc", 5)
    r = RepoCoCache(n, ttl_giay=30, dong_ho=DongHo())
    sp = r.lay("A1")
    sp.so_luong = 999
    assert r.lay("A1").so_luong == 5
    sp2 = r.lay("A1")
    sp2.so_luong = 777
    assert r.lay("A1").so_luong == 5


def test_an_xoa_cache():
    n = NguonDem()
    n.du_lieu["A1"] = SanPham("A1", "Ốc", 5)
    r = RepoCoCache(n, ttl_giay=30, dong_ho=DongHo())
    r.lay("A1")
    r.xoa_cache()
    r.lay("A1")
    assert n.dem["lay"] == 2


def test_an_dich_vu_dung_cache_giam_doc_tep(tmp_path):
    goc = RepoTep(str(tmp_path / "kho.json"))
    dv = DichVuKho(goc, cache_ttl=60, dong_ho=DongHo())
    dv.them_san_pham("A1", "Ốc")
    dv.nhap("A1", 10)
    so_lan_doc = goc.so_lan_doc
    for _ in range(5):
        assert dv.ton("A1") == 10
    assert goc.so_lan_doc == so_lan_doc
    tk = dv.thong_ke_cache()
    assert tk["trung"] >= 5


def test_an_dich_vu_khong_cache_thi_thong_ke_none(tmp_path):
    dv = DichVuKho(RepoTep(str(tmp_path / "kho.json")))
    assert dv.thong_ke_cache() is None
    assert DichVuKho(RepoTep(str(tmp_path / "k2.json")), cache_ttl=5).thong_ke_cache() == {"trung": 0, "truot": 0}


def test_an_xuat_that_bai_khong_lam_ban_cache(tmp_path):
    dv = DichVuKho(RepoTep(str(tmp_path / "kho.json")), cache_ttl=60, dong_ho=DongHo())
    dv.them_san_pham("A1", "Ốc")
    dv.nhap("A1", 5)
    with pytest.raises(LoiKho, match="Không đủ hàng A1"):
        dv.xuat("A1", 6)
    assert dv.ton("A1") == 5
    assert dv.xuat("A1", 5) == 0
