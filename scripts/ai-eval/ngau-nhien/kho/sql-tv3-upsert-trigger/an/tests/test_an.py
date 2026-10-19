import sqlite3

import pytest

from kiem_sql import ket_noi, chay_kich_ban, truy_van, cot


def _db():
    con = ket_noi()
    chay_kich_ban(con, "kho.sql")
    return con


def _nhap(con, ma, ten, so_luong):
    return truy_van(con, "nhap_hang.sql", {"ma": ma, "ten": ten, "so_luong": so_luong})


def _nhat_ky(con):
    return con.execute("SELECT ma, ton_cu, ton_moi FROM nhat_ky ORDER BY id").fetchall()


def test_xuat_trong_pham_vi_ton_qua_upsert():
    con = _db()
    _nhap(con, "A", "Bút", 10)
    assert _nhap(con, "A", "Bút", -4) == [("A", "Bút", 6)]
    assert _nhap(con, "A", "Bút", -6) == [("A", "Bút", 0)]
    assert _nhat_ky(con) == [("A", None, 10), ("A", 10, 6), ("A", 6, 0)]


def test_so_luong_0_doi_ten_khong_ghi_nhat_ky():
    con = _db()
    _nhap(con, "A", "Bút", 7)
    assert _nhap(con, "A", "Bút bi", 0) == [("A", "Bút bi", 7)]
    assert _nhat_ky(con) == [("A", None, 7)]


def test_update_truc_tiep_khong_doi_ton_khong_ghi():
    con = _db()
    _nhap(con, "A", "Bút", 7)
    con.execute("UPDATE ton_kho SET ten = 'Bút chì' WHERE ma = 'A'")
    con.execute("UPDATE ton_kho SET ton = 7 WHERE ma = 'A'")
    con.execute("UPDATE ton_kho SET ton = 9 WHERE ma = 'A'")
    assert _nhat_ky(con) == [("A", None, 7), ("A", 7, 9)]


def test_update_truc_tiep_am_bi_chan():
    con = _db()
    _nhap(con, "A", "Bút", 2)
    _nhap(con, "B", "Vở", 5)
    with pytest.raises(sqlite3.IntegrityError, match="ton am"):
        con.execute("UPDATE ton_kho SET ton = ton - 3")
    assert con.execute("SELECT ma, ton FROM ton_kho ORDER BY ma").fetchall() == [("A", 2), ("B", 5)]
    assert _nhat_ky(con) == [("A", None, 2), ("B", None, 5)]


def test_ma_moi_so_luong_am_bi_chan():
    con = _db()
    with pytest.raises(sqlite3.IntegrityError, match="ton am"):
        _nhap(con, "Z", "Lạ", -1)
    assert con.execute("SELECT COUNT(*) FROM ton_kho").fetchone() == (0,)
    assert _nhat_ky(con) == []


def test_insert_truc_tiep_cung_ghi_va_chan():
    con = _db()
    con.execute("INSERT INTO ton_kho (ma, ten, ton) VALUES ('Q', 'Thước', 0)")
    with pytest.raises(sqlite3.IntegrityError, match="ton am"):
        con.execute("INSERT INTO ton_kho (ma, ten, ton) VALUES ('R', 'Tẩy', -2)")
    assert _nhat_ky(con) == [("Q", None, 0)]


def test_ten_moi_nhat_va_ten_cot_returning():
    con = _db()
    _nhap(con, "A", "Cũ", 1)
    ten, hang = cot(con, "nhap_hang.sql", {"ma": "A", "ten": "Mới", "so_luong": 2})
    assert ten == ["ma", "ten", "ton"]
    assert hang == [("A", "Mới", 3)]
    assert con.execute("SELECT ma, ten, ton FROM ton_kho").fetchall() == [("A", "Mới", 3)]


def test_nhieu_ma_doc_lap_va_thu_tu_nhat_ky():
    con = _db()
    _nhap(con, "A", "a", 1)
    _nhap(con, "B", "b", 2)
    _nhap(con, "A", "a", 3)
    with pytest.raises(sqlite3.IntegrityError):
        _nhap(con, "B", "b", -3)
    _nhap(con, "B", "b", -2)
    assert con.execute("SELECT ma, ton FROM ton_kho ORDER BY ma").fetchall() == [("A", 4), ("B", 0)]
    assert _nhat_ky(con) == [("A", None, 1), ("B", None, 2), ("A", 1, 4), ("B", 2, 0)]
    ids = [r[0] for r in con.execute("SELECT id FROM nhat_ky ORDER BY id")]
    assert ids == sorted(set(ids)) and all(isinstance(i, int) for i in ids)
