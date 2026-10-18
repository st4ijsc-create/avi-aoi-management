import asyncio
import time

import pytest

from chay_gioi_han import chay_gioi_han
from ket_qua import KetQua


class DemDongThoi:
    def __init__(self):
        self.dang_chay = 0
        self.toi_da = 0
        self.nhat_ky = []

    def tac_vu(self, i, giay, gia_tri=None, ngu_khi_huy=0.0):
        async def ham():
            self.dang_chay += 1
            self.toi_da = max(self.toi_da, self.dang_chay)
            self.nhat_ky.append(("vao", i))
            try:
                await asyncio.sleep(giay)
                return gia_tri
            except asyncio.CancelledError:
                self.nhat_ky.append(("huy", i))
                if ngu_khi_huy:
                    await asyncio.sleep(ngu_khi_huy)
                raise
            finally:
                self.nhat_ky.append(("ra", i))
                self.dang_chay -= 1

        return ham


def test_dong_thoi_khong_vuot_gioi_han_va_dat_gioi_han():
    d = DemDongThoi()
    kq = asyncio.run(chay_gioi_han([d.tac_vu(i, 0.05, i * 10) for i in range(10)], 3))
    assert d.toi_da == 3
    assert kq == [KetQua(i, "ok", i * 10) for i in range(10)]


def test_gioi_han_mot_chay_tuan_tu_theo_chi_so():
    d = DemDongThoi()
    asyncio.run(chay_gioi_han([d.tac_vu(i, 0.01) for i in range(4)], 1))
    assert d.nhat_ky == [(s, i) for i in range(4) for s in ("vao", "ra")]


def test_het_gio_huy_that_tac_vu():
    d = DemDongThoi()
    bat_dau = time.perf_counter()
    kq = asyncio.run(chay_gioi_han([d.tac_vu(0, 5)], 1, tran_giay=0.1))
    assert time.perf_counter() - bat_dau < 2.0
    assert kq == [KetQua(0, "het_gio", None, None)]
    assert ("huy", 0) in d.nhat_ky
    assert d.dang_chay == 0


def test_tran_tinh_tu_luc_tac_vu_bat_dau():
    d = DemDongThoi()
    kq = asyncio.run(chay_gioi_han([d.tac_vu(i, 0.15, i) for i in range(3)], 1, tran_giay=0.6))
    assert [k.trang_thai for k in kq] == ["ok", "ok", "ok"]


def test_cho_tac_vu_bi_huy_dung_han_moi_giai_phong_cho():
    d = DemDongThoi()
    tac_vu = [d.tac_vu(i, 5 if i % 2 == 0 else 0.02, i, ngu_khi_huy=0.1) for i in range(6)]
    kq = asyncio.run(chay_gioi_han(tac_vu, 2, tran_giay=0.1))
    assert d.toi_da <= 2
    assert [k.trang_thai for k in kq] == ["het_gio", "ok", "het_gio", "ok", "het_gio", "ok"]
    assert [k.gia_tri for k in kq] == [None, 1, None, 3, None, 5]


def test_tham_so_sai_nem_value_error_va_khong_goi_tac_vu():
    goi = []

    def ham():
        goi.append(1)

        async def rong():
            return 1

        return rong()

    for gioi_han, tran in [(0, None), (-2, None), (2, 0), (2, -1.5)]:
        with pytest.raises(ValueError):
            asyncio.run(chay_gioi_han([ham], gioi_han, tran))
    assert goi == []


def test_danh_sach_rong():
    assert asyncio.run(chay_gioi_han([], 4, tran_giay=1)) == []


def test_ham_tac_vu_nem_loi_ngay_khi_goi():
    def hong_ngay():
        raise KeyError("k")

    async def tot():
        return "x"

    kq = asyncio.run(chay_gioi_han([hong_ngay, tot], 2))
    assert kq[0].trang_thai == "loi"
    assert isinstance(kq[0].loi, KeyError)
    assert kq[1] == KetQua(1, "ok", "x")


def test_huy_tu_ben_ngoai_huy_tac_vu_dang_chay_va_khong_khoi_dong_them():
    d = DemDongThoi()

    async def kich_ban():
        t = asyncio.create_task(chay_gioi_han([d.tac_vu(i, 10) for i in range(5)], 2))
        await asyncio.sleep(0.1)
        t.cancel()
        with pytest.raises(asyncio.CancelledError):
            await t
        sau_huy = list(d.nhat_ky)
        await asyncio.sleep(0.1)
        return sau_huy

    bat_dau = time.perf_counter()
    sau_huy = asyncio.run(kich_ban())
    assert time.perf_counter() - bat_dau < 3.0
    assert sorted(x for x in sau_huy if x[0] == "vao") == [("vao", 0), ("vao", 1)]
    assert sorted(x for x in sau_huy if x[0] == "huy") == [("huy", 0), ("huy", 1)]
    assert d.dang_chay == 0
    assert sau_huy == d.nhat_ky
