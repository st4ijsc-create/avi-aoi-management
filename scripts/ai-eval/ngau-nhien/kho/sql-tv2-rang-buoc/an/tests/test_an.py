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


def _loi(con, sql, tham_so=()):
    with pytest.raises(sqlite3.IntegrityError):
        con.execute(sql, tham_so)


def test_email_khong_phan_biet_hoa_thuong():
    con = _db()
    con.execute("INSERT INTO khach_hang (id, email, ho_ten) VALUES (1, 'Mai.Anh@Cong-Ty.com.vn', 'Mai Anh')")
    _loi(con, "INSERT INTO khach_hang (email, ho_ten) VALUES ('mai.anh@cong-ty.COM.VN', 'Trùng')")
    assert con.execute("SELECT id FROM khach_hang WHERE email = 'MAI.ANH@CONG-TY.COM.VN'").fetchall() == [(1,)]


def test_dinh_dang_email():
    con = _db()
    for e in ["ab.c", "@b.c", "a@bc", "a@b.", "a@.c"]:
        _loi(con, "INSERT INTO khach_hang (email, ho_ten) VALUES (?, 'X')", (e,))
    con.execute("INSERT INTO khach_hang (email, ho_ten) VALUES ('a@b.c', 'X')")
    assert con.execute("SELECT COUNT(*) FROM khach_hang").fetchone() == (1,)


def test_so_dien_thoai():
    con = _db()
    for s in ["091234567", "09123456789", "1912345678", "09123456a8", "+849123456"]:
        _loi(con, "INSERT INTO khach_hang (email, ho_ten, sdt) VALUES ('x@y.z', 'X', ?)", (s,))
    con.execute("INSERT INTO khach_hang (email, ho_ten, sdt) VALUES ('p@q.r', 'P', NULL)")
    con.execute("INSERT INTO khach_hang (email, ho_ten, sdt) VALUES ('s@t.u', 'S', '0000000000')")
    assert con.execute("SELECT COUNT(*) FROM khach_hang").fetchone() == (2,)


def test_ho_ten_hang_va_not_null():
    con = _db()
    _loi(con, "INSERT INTO khach_hang (email, ho_ten) VALUES ('a@b.c', '   ')")
    _loi(con, "INSERT INTO khach_hang (email, ho_ten) VALUES ('a@b.c', '')")
    _loi(con, "INSERT INTO khach_hang (email, ho_ten) VALUES ('a@b.c', NULL)")
    _loi(con, "INSERT INTO khach_hang (email, ho_ten) VALUES (NULL, 'X')")
    _loi(con, "INSERT INTO khach_hang (email, ho_ten, hang) VALUES ('a@b.c', 'X', 'bac')")
    _loi(con, "INSERT INTO khach_hang (email, ho_ten, hang) VALUES ('a@b.c', 'X', 'VANG')")
    for i, h in enumerate(["thuong", "vang", "kim_cuong"]):
        con.execute("INSERT INTO khach_hang (email, ho_ten, hang) VALUES (?, 'X', ?)", (f"k{i}@b.c", h))
    assert con.execute("SELECT COUNT(*) FROM khach_hang").fetchone() == (3,)


def test_ma_san_pham():
    con = _db()
    for ma in ["SP12", "sp1234", "SP12345", "SPA234", "XP1234", " SP1234"]:
        _loi(con, "INSERT INTO san_pham (ma, ten, gia) VALUES (?, 'X', 1)", (ma,))
    con.execute("INSERT INTO san_pham (ma, ten, gia) VALUES ('SP0000', 'X', 1)")
    _loi(con, "INSERT INTO san_pham (ma, ten, gia) VALUES ('SP0000', 'Y', 2)")


def test_khoang_gia_va_ton():
    con = _db()
    _loi(con, "INSERT INTO san_pham (ma, ten, gia) VALUES ('SP0001', 'X', 0)")
    _loi(con, "INSERT INTO san_pham (ma, ten, gia) VALUES ('SP0001', 'X', 1000000001)")
    _loi(con, "INSERT INTO san_pham (ma, ten, gia, ton) VALUES ('SP0001', 'X', 5, -1)")
    _loi(con, "INSERT INTO san_pham (ma, ten, gia) VALUES ('SP0001', NULL, 5)")
    con.execute("INSERT INTO san_pham (ma, ten, gia) VALUES ('SP0001', 'X', 1)")
    con.execute("INSERT INTO san_pham (ma, ten, gia, ton) VALUES ('SP0002', 'Y', 1000000000, 0)")
    _loi(con, "UPDATE san_pham SET ton = ton - 1 WHERE ma = 'SP0001'")
    assert con.execute("SELECT ma, ton FROM san_pham ORDER BY ma").fetchall() == [("SP0001", 0), ("SP0002", 0)]


def test_bang_strict_chan_sai_kieu():
    con = _db()
    strict = dict(con.execute("SELECT name, strict FROM pragma_table_list WHERE schema = 'main'").fetchall())
    for t in ["khach_hang", "san_pham", "don_hang", "chi_tiet"]:
        assert strict.get(t) == 1, t
    _loi(con, "INSERT INTO san_pham (ma, ten, gia) VALUES ('SP0001', 'X', 'abc')")
    _loi(con, "INSERT INTO san_pham (ma, ten, gia) VALUES ('SP0001', 'X', 12.5)")


def test_ngay_hop_le():
    con = _db()
    _mau(con)
    for n in ["2027-02-29", "2026-02-30", "2026-2-03", "2026/02/03", "2026-02-03 10:00:00", "03-02-2026", ""]:
        _loi(con, "INSERT INTO don_hang (khach_id, ngay) VALUES (1, ?)", (n,))
    con.execute("INSERT INTO don_hang (id, khach_id, ngay) VALUES (11, 1, '2028-02-29')")
    con.execute("INSERT INTO don_hang (id, khach_id, ngay) VALUES (12, 1, '2026-12-31')")
    assert con.execute("SELECT COUNT(*) FROM don_hang").fetchone() == (3,)


def test_khoa_ngoai_phai_ton_tai():
    con = _db()
    _mau(con)
    _loi(con, "INSERT INTO don_hang (khach_id, ngay) VALUES (99, '2026-03-01')")
    _loi(con, "INSERT INTO chi_tiet (don_id, ma_sp, so_luong) VALUES (10, 'SP9999', 1)")
    _loi(con, "INSERT INTO chi_tiet (don_id, ma_sp, so_luong) VALUES (77, 'SP0001', 1)")


def test_xoa_bi_chan_khi_con_tham_chieu():
    con = _db()
    _mau(con)
    con.execute("INSERT INTO khach_hang (id, email, ho_ten) VALUES (2, 'b@vi.du', 'Bình')")
    _loi(con, "DELETE FROM khach_hang WHERE id = 1")
    _loi(con, "DELETE FROM san_pham WHERE ma = 'SP0001'")
    con.execute("DELETE FROM khach_hang WHERE id = 2")
    con.execute("DELETE FROM don_hang WHERE id = 10")
    con.execute("DELETE FROM san_pham WHERE ma = 'SP0001'")
    con.execute("DELETE FROM khach_hang WHERE id = 1")
    assert con.execute("SELECT COUNT(*) FROM khach_hang").fetchone() == (0,)


def test_chi_tiet_khoa_chinh_ghep_va_so_luong():
    con = _db()
    _mau(con)
    con.execute("INSERT INTO san_pham (ma, ten, gia) VALUES ('SP0002', 'Vở', 8000)")
    con.execute("INSERT INTO don_hang (id, khach_id, ngay) VALUES (11, 1, '2026-03-02')")
    _loi(con, "INSERT INTO chi_tiet (don_id, ma_sp, so_luong) VALUES (10, 'SP0001', 1)")
    _loi(con, "INSERT INTO chi_tiet (don_id, ma_sp, so_luong) VALUES (10, 'SP0002', 0)")
    _loi(con, "INSERT INTO chi_tiet (don_id, ma_sp, so_luong) VALUES (10, 'SP0002', 1001)")
    con.execute("INSERT INTO chi_tiet (don_id, ma_sp, so_luong) VALUES (10, 'SP0002', 1000)")
    con.execute("INSERT INTO chi_tiet (don_id, ma_sp, so_luong) VALUES (11, 'SP0001', 1)")
    con.execute("DELETE FROM don_hang WHERE id = 10")
    assert con.execute("SELECT don_id, ma_sp FROM chi_tiet").fetchall() == [(11, "SP0001")]
