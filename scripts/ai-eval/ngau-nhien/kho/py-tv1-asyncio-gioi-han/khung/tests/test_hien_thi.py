import asyncio

from chay_gioi_han import chay_gioi_han
from ket_qua import KetQua


def tre_roi_tra(giay, gia_tri):
    async def ham():
        await asyncio.sleep(giay)
        return gia_tri

    return ham


def test_ket_qua_theo_thu_tu_chi_so():
    tac_vu = [tre_roi_tra(0.06, "a"), tre_roi_tra(0.01, "b"), tre_roi_tra(0.03, "c")]
    kq = asyncio.run(chay_gioi_han(tac_vu, 3))
    assert kq == [KetQua(0, "ok", "a"), KetQua(1, "ok", "b"), KetQua(2, "ok", "c")]


def test_loi_duoc_dong_goi():
    loi = ValueError("hỏng")

    async def hong():
        raise loi

    kq = asyncio.run(chay_gioi_han([tre_roi_tra(0, 1), hong, tre_roi_tra(0, 3)], 2))
    assert [k.trang_thai for k in kq] == ["ok", "loi", "ok"]
    assert kq[1].loi is loi
    assert kq[1].gia_tri is None
    assert kq[2].gia_tri == 3


def test_het_gio():
    kq = asyncio.run(chay_gioi_han([tre_roi_tra(5, "cham"), tre_roi_tra(0, "nhanh")], 2, tran_giay=0.1))
    assert kq == [KetQua(0, "het_gio"), KetQua(1, "ok", "nhanh")]
