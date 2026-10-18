from kiem_sql import ket_noi, chay_kich_ban, truy_van


def _db(khu_vuc, ban_hang):
    con = ket_noi()
    chay_kich_ban(con, "schema.sql")
    chay_kich_ban(con, "view.sql")
    con.executemany("INSERT INTO khu_vuc (ma) VALUES (?)", [(k,) for k in khu_vuc])
    con.executemany("INSERT INTO ban_hang (luc, khu_vuc, so_tien, giam_gia) VALUES (?, ?, ?, ?)", ban_hang)
    return con


MAU = [
    ("2026-01-05 10:00:00", "HN", 100, None),
    ("2026-01-20 15:30:00", "HN", 200, 50),
    ("2026-01-09 08:00:00", "SG", 400, None),
    ("2026-02-01 00:00:00", "HN", 500, 0),
    ("2026-02-14 12:00:00", "SG", 300, 100),
]


def test_view_chuan_hoa():
    con = _db(["HN", "SG"], MAU)
    assert con.execute("SELECT id, thang, khu_vuc, thuc_thu FROM ban_hang_chuan ORDER BY id").fetchall() == [
        (1, "2026-01", "HN", 100),
        (2, "2026-01", "HN", 150),
        (3, "2026-01", "SG", 400),
        (4, "2026-02", "HN", 500),
        (5, "2026-02", "SG", 200),
    ]


def test_bao_cao_hai_thang():
    con = _db(["HN", "SG"], MAU)
    assert truy_van(con, "bao_cao.sql", {"tu": "2026-01", "den": "2026-02"}) == [
        ("2026-01", "HN", 250, 2, None),
        ("2026-01", "SG", 400, 1, None),
        ("2026-02", "HN", 500, 1, 100.0),
        ("2026-02", "SG", 200, 1, -50.0),
    ]


def test_bao_cao_mot_thang():
    con = _db(["HN", "SG"], MAU)
    assert truy_van(con, "bao_cao.sql", {"tu": "2026-02", "den": "2026-02"}) == [
        ("2026-02", "HN", 500, 1, None),
        ("2026-02", "SG", 200, 1, None),
    ]
