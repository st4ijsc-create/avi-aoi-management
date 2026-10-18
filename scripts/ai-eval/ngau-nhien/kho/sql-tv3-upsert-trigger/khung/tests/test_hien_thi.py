import sqlite3

import pytest

from kiem_sql import ket_noi, chay_kich_ban, truy_van


def _db():
    con = ket_noi()
    chay_kich_ban(con, "kho.sql")
    return con


def _nhap(con, ma, ten, so_luong):
    return truy_van(con, "nhap_hang.sql", {"ma": ma, "ten": ten, "so_luong": so_luong})


def _nhat_ky(con):
    return con.execute("SELECT ma, ton_cu, ton_moi FROM nhat_ky ORDER BY id").fetchall()


def test_nhap_moi():
    con = _db()
    assert _nhap(con, "A", "Bút", 10) == [("A", "Bút", 10)]
    assert _nhat_ky(con) == [("A", None, 10)]


def test_nhap_cong_don():
    con = _db()
    _nhap(con, "A", "Bút", 10)
    assert _nhap(con, "A", "Bút", 5) == [("A", "Bút", 15)]
    assert _nhat_ky(con) == [("A", None, 10), ("A", 10, 15)]


def test_xuat_qua_ton_bi_chan():
    con = _db()
    _nhap(con, "A", "Bút", 3)
    with pytest.raises(sqlite3.IntegrityError, match="ton am"):
        _nhap(con, "A", "Bút", -4)
    assert con.execute("SELECT ton FROM ton_kho WHERE ma = 'A'").fetchone() == (3,)
    assert _nhat_ky(con) == [("A", None, 3)]
