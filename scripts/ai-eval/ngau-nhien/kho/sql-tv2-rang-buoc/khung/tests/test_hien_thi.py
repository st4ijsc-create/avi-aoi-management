import sqlite3

import pytest

from kiem_sql import ket_noi, chay_kich_ban


def _db():
    con = ket_noi()
    chay_kich_ban(con, "schema.sql")
    return con


def _mau(con):
    con.execute("INSERT INTO khach_hang (id, email, ho_ten, sdt) VALUES (1, 'an@vi.du', 'Lê An', '0912345678')")
    con.execute("INSERT INTO san_pham (ma, ten, gia) VALUES ('SP0001', 'Bút', 5000)")
    con.execute("INSERT INTO don_hang (id, khach_id, ngay) VALUES (10, 1, '2026-03-01')")
    con.execute("INSERT INTO chi_tiet (don_id, ma_sp, so_luong) VALUES (10, 'SP0001', 3)")


def test_du_lieu_hop_le_va_mac_dinh():
    con = _db()
    _mau(con)
    assert con.execute("SELECT hang FROM khach_hang WHERE id = 1").fetchone() == ("thuong",)
    assert con.execute("SELECT ton FROM san_pham WHERE ma = 'SP0001'").fetchone() == (0,)
    assert con.execute("SELECT ghi_chu FROM don_hang WHERE id = 10").fetchone() == ("",)


def test_email_trung_bi_chan():
    con = _db()
    _mau(con)
    with pytest.raises(sqlite3.IntegrityError):
        con.execute("INSERT INTO khach_hang (email, ho_ten) VALUES ('an@vi.du', 'Người khác')")


def test_xoa_don_xoa_theo_chi_tiet():
    con = _db()
    _mau(con)
    con.execute("DELETE FROM don_hang WHERE id = 10")
    assert con.execute("SELECT COUNT(*) FROM chi_tiet").fetchone() == (0,)
