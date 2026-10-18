from kiem_sql import ket_noi, chay_kich_ban, truy_van


def _db(nhan_vien, cham_cong=()):
    """Áp 001, chèn dữ liệu theo lược đồ CŨ, rồi áp 002."""
    con = ket_noi()
    chay_kich_ban(con, "001_tao_bang.sql")
    con.executemany("INSERT INTO nhan_vien (id, ho_ten, email, phong) VALUES (?, ?, ?, ?)", nhan_vien)
    con.executemany("INSERT INTO cham_cong (nhan_vien_id, ngay, so_gio) VALUES (?, ?, ?)", cham_cong)
    chay_kich_ban(con, "002_tach_ho_ten.sql")
    return con


NV = [
    (1, "Nguyễn Văn An", "an@cty.vn", "KT"),
    (2, "Trần Bình", "binh@cty.vn", "KT"),
    (3, "Lê Chi", None, "NS"),
]
CC = [(1, "2026-03-01", 8.0), (1, "2026-03-02", 7.5), (3, "2026-03-01", 4.0)]


def test_tach_ho_ten():
    con = _db(NV, CC)
    assert con.execute("SELECT id, ho, ten, email, phong FROM nhan_vien ORDER BY id").fetchall() == [
        (1, "Nguyễn", "Văn An", "an@cty.vn", "KT"),
        (2, "Trần", "Bình", "binh@cty.vn", "KT"),
        (3, "Lê", "Chi", None, "NS"),
    ]


def test_luoc_do_moi_va_phien_ban():
    con = _db(NV, CC)
    assert [r[1] for r in con.execute("PRAGMA table_info(nhan_vien)")] == ["id", "ho", "ten", "email", "phong"]
    assert con.execute("PRAGMA user_version").fetchone() == (2,)


def test_truy_van_theo_phong():
    con = _db(NV, CC)
    assert truy_van(con, "truy_van.sql") == [
        ("KT", 2, 2, "Trần Bình, Nguyễn Văn An", 15.5),
        ("NS", 1, 0, "Lê Chi", 4.0),
    ]
