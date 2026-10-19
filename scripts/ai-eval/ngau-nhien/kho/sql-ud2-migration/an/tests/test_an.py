import sqlite3

import pytest

from kiem_sql import ket_noi, chay_kich_ban, truy_van, cot


def _db(nhan_vien, cham_cong=()):
    con = ket_noi()
    chay_kich_ban(con, "001_tao_bang.sql")
    con.executemany("INSERT INTO nhan_vien (id, ho_ten, email, phong) VALUES (?, ?, ?, ?)", nhan_vien)
    con.executemany("INSERT INTO cham_cong (nhan_vien_id, ngay, so_gio) VALUES (?, ?, ?)", cham_cong)
    chay_kich_ban(con, "002_tach_ho_ten.sql")
    return con


BIEN = [
    (1, "  An  ", None, None),
    (2, "Lê   Thị  Hoa ", "", ""),
    (3, "Ngô Quyền", "  Q@Vua.VN ", " KT "),
    (4, "Đinh Bộ Lĩnh", "   ", "  "),
]


def test_tach_ten_va_chuan_hoa_bien():
    con = _db(BIEN)
    assert con.execute("SELECT id, ho, ten, email, phong FROM nhan_vien ORDER BY id").fetchall() == [
        (1, "", "An", None, "chung"),
        (2, "Lê", "Thị  Hoa", None, "chung"),
        (3, "Ngô", "Quyền", "q@vua.vn", "KT"),
        (4, "Đinh", "Bộ Lĩnh", None, "chung"),
    ]


def test_rang_buoc_moi_co_hieu_luc():
    con = _db(BIEN)
    with pytest.raises(sqlite3.IntegrityError):
        con.execute("INSERT INTO nhan_vien (ho, ten, email) VALUES ('X', 'Y', 'Q@VUA.vn')")
    with pytest.raises(sqlite3.IntegrityError):
        con.execute("INSERT INTO nhan_vien (ho, ten) VALUES (NULL, 'Y')")
    with pytest.raises(sqlite3.IntegrityError):
        con.execute("INSERT INTO nhan_vien (ho, ten) VALUES ('X', NULL)")
    with pytest.raises(sqlite3.IntegrityError):
        con.execute("INSERT INTO nhan_vien (ho, ten) VALUES ('X', '')")
    with pytest.raises(sqlite3.IntegrityError):
        con.execute("INSERT INTO nhan_vien (ho, ten, phong) VALUES ('X', 'Y', NULL)")
    con.execute("INSERT INTO nhan_vien (id, ho, ten) VALUES (10, '', 'Z')")
    con.execute("INSERT INTO nhan_vien (id, ho, ten, email) VALUES (11, '', 'W', NULL)")
    assert con.execute("SELECT phong, email FROM nhan_vien WHERE id = 10").fetchone() == ("chung", None)
    assert con.execute("SELECT id FROM nhan_vien WHERE email = 'Q@VUA.VN'").fetchall() == [(3,)]


def test_chi_muc_phong_duoc_dung_lai():
    con = _db(BIEN)
    hang = con.execute(
        "SELECT tbl_name FROM sqlite_schema WHERE type = 'index' AND name = 'idx_nhan_vien_phong'"
    ).fetchall()
    assert hang == [("nhan_vien",)]
    assert [r[2] for r in con.execute("PRAGMA index_info('idx_nhan_vien_phong')")] == ["phong"]


def test_khoa_ngoai_cham_cong_van_tro_nhan_vien_va_duoc_bat():
    con = _db([(1, "Hà My", None, "A"), (2, "Lý Tú", None, "A")], [(1, "2026-01-01", 8.0), (2, "2026-01-01", 6.0)])
    assert con.execute("PRAGMA foreign_keys").fetchone() == (1,)
    assert [r[2] for r in con.execute("PRAGMA foreign_key_list('cham_cong')")] == ["nhan_vien"]
    assert con.execute("PRAGMA foreign_key_check").fetchall() == []
    assert con.execute(
        "SELECT n.ten, c.so_gio FROM cham_cong c JOIN nhan_vien n ON n.id = c.nhan_vien_id ORDER BY c.id"
    ).fetchall() == [("My", 8.0), ("Tú", 6.0)]
    with pytest.raises(sqlite3.IntegrityError):
        con.execute("INSERT INTO cham_cong (nhan_vien_id, ngay, so_gio) VALUES (99, '2026-01-02', 1.0)")
    with pytest.raises(sqlite3.IntegrityError):
        con.execute("DELETE FROM nhan_vien WHERE id = 1")


def test_khong_con_bang_tam_hay_cot_cu():
    con = _db(BIEN)
    bang = {r[0] for r in con.execute("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")}
    assert bang == {"nhan_vien", "cham_cong"}
    assert [r[1] for r in con.execute("PRAGMA table_info(nhan_vien)")] == ["id", "ho", "ten", "email", "phong"]
    assert con.execute("PRAGMA user_version").fetchone() == (2,)


def test_bang_rong_van_migrate_duoc():
    con = _db([])
    assert con.execute("SELECT COUNT(*) FROM nhan_vien").fetchone() == (0,)
    assert con.execute("PRAGMA user_version").fetchone() == (2,)
    assert truy_van(con, "truy_van.sql") == []


NV = [
    (1, "Phạm Minh", "m@x.vn", "A"),
    (2, "Lê Minh", None, "A"),
    (3, "Hồ Anh", "a@x.vn", "B"),
    (4, "Vũ Bảo", "b@x.vn", "B"),
    (5, "Mai Lan", None, "C"),
    (6, "An", None, "B"),
    (7, "Tô Hà", "", "D"),
]
CC = [
    (1, "2026-03-01", 8.0), (1, "2026-03-02", 8.0), (1, "2026-03-03", 4.0),
    (3, "2026-03-01", 1.5), (3, "2026-03-02", 2.0),
]


def test_truy_van_khong_nhan_ban_khi_nhieu_cham_cong_va_thu_tu():
    con = _db(NV, CC)
    assert truy_van(con, "truy_van.sql") == [
        ("B", 3, 2, "An, Hồ Anh, Vũ Bảo", 3.5),
        ("A", 2, 1, "Lê Minh, Phạm Minh", 20.0),
        ("C", 1, 0, "Mai Lan", 0.0),
        ("D", 1, 0, "Tô Hà", 0.0),
    ]


def test_truy_van_ten_cot_va_kieu():
    con = _db(NV, CC)
    ten, hang = cot(con, "truy_van.sql")
    assert ten == ["phong", "so_nguoi", "so_co_email", "danh_sach", "tong_gio"]
    for h in hang:
        assert isinstance(h[1], int) and isinstance(h[2], int) and isinstance(h[4], float)
