from kiem_sql import ket_noi, chay_kich_ban, truy_van, cot


def _db(khu_vuc, ban_hang):
    con = ket_noi()
    chay_kich_ban(con, "schema.sql")
    chay_kich_ban(con, "view.sql")
    con.executemany("INSERT INTO khu_vuc (ma) VALUES (?)", [(k,) for k in khu_vuc])
    con.executemany("INSERT INTO ban_hang (luc, khu_vuc, so_tien, giam_gia) VALUES (?, ?, ?, ?)", ban_hang)
    return con


def _bc(con, tu, den):
    return truy_van(con, "bao_cao.sql", {"tu": tu, "den": den})


def test_view_ten_cot_va_bien_thang():
    con = _db(["HN"], [
        ("2026-01-31 23:59:59", "HN", 70, 70),
        ("2026-12-01 00:00:00", "HN", 9, None),
    ])
    ten, hang = cot(con, "bao_cao.sql", {"tu": "2026-01", "den": "2026-01"})
    assert ten == ["thang", "khu_vuc", "doanh_thu", "so_don", "tang_truong"]
    cur = con.execute("SELECT * FROM ban_hang_chuan ORDER BY id")
    assert [d[0] for d in cur.description] == ["id", "thang", "khu_vuc", "thuc_thu"]
    assert cur.fetchall() == [(1, "2026-01", "HN", 0), (2, "2026-12", "HN", 9)]


def test_thang_trong_bang_0_va_tang_truong_tu_0_la_null():
    con = _db(["HN"], [
        ("2026-03-02 09:00:00", "HN", 300, None),
        ("2026-05-02 09:00:00", "HN", 120, 20),
        ("2026-06-02 09:00:00", "HN", 150, None),
    ])
    assert _bc(con, "2026-03", "2026-06") == [
        ("2026-03", "HN", 300, 1, None),
        ("2026-04", "HN", 0, 0, -100.0),
        ("2026-05", "HN", 100, 1, None),
        ("2026-06", "HN", 150, 1, 50.0),
    ]


def test_khu_vuc_khong_ban_van_co_du_thang():
    con = _db(["DN", "HN"], [("2026-01-10 10:00:00", "HN", 10, None)])
    assert _bc(con, "2026-01", "2026-02") == [
        ("2026-01", "DN", 0, 0, None),
        ("2026-01", "HN", 10, 1, None),
        ("2026-02", "DN", 0, 0, None),
        ("2026-02", "HN", 0, 0, -100.0),
    ]


def test_qua_nam_va_loai_ngoai_khoang():
    con = _db(["SG"], [
        ("2025-10-31 23:00:00", "SG", 999, None),
        ("2025-11-15 10:00:00", "SG", 300, None),
        ("2025-12-15 10:00:00", "SG", 400, None),
        ("2026-01-15 10:00:00", "SG", 200, None),
        ("2026-02-15 10:00:00", "SG", 200, None),
        ("2026-03-01 00:00:00", "SG", 777, None),
    ])
    assert _bc(con, "2025-11", "2026-02") == [
        ("2025-11", "SG", 300, 1, None),
        ("2025-12", "SG", 400, 1, 33.33),
        ("2026-01", "SG", 200, 1, -50.0),
        ("2026-02", "SG", 200, 1, 0.0),
    ]


def test_thang_dau_khoang_luon_null_du_thang_truoc_co_ban():
    con = _db(["HN"], [
        ("2026-01-15 10:00:00", "HN", 300, None),
        ("2026-02-15 10:00:00", "HN", 200, None),
    ])
    assert _bc(con, "2026-02", "2026-02") == [("2026-02", "HN", 200, 1, None)]
    assert _bc(con, "2026-01", "2026-02")[1] == ("2026-02", "HN", 200, 1, -33.33)


def test_don_giam_het_van_tinh_so_don():
    con = _db(["HN"], [
        ("2026-07-01 10:00:00", "HN", 50, 50),
        ("2026-07-02 10:00:00", "HN", 80, 30),
    ])
    assert _bc(con, "2026-07", "2026-07") == [("2026-07", "HN", 50, 2, None)]


def test_khoang_nguoc_va_khong_khu_vuc():
    con = _db(["HN"], [("2026-01-15 10:00:00", "HN", 1, None)])
    assert _bc(con, "2026-03", "2026-01") == []
    assert _bc(_db([], []), "2026-01", "2026-03") == []


def test_kieu_du_lieu():
    con = _db(["HN"], [("2026-01-15 10:00:00", "HN", 3, None), ("2026-02-15 10:00:00", "HN", 4, None)])
    hang = _bc(con, "2026-01", "2026-02")
    assert hang == [("2026-01", "HN", 3, 1, None), ("2026-02", "HN", 4, 1, 33.33)]
    assert isinstance(hang[0][2], int) and isinstance(hang[0][3], int) and isinstance(hang[1][4], float)


def test_bao_cao_doc_qua_view():
    con = _db(["HN"], [("2026-01-15 10:00:00", "HN", 1, None)])
    con.execute("DROP VIEW ban_hang_chuan")
    con.execute(
        "CREATE VIEW ban_hang_chuan (id, thang, khu_vuc, thuc_thu) AS "
        "VALUES (1, '2026-01', 'HN', 500), (2, '2026-02', 'HN', 250), (3, '2026-02', 'HN', 0)"
    )
    assert _bc(con, "2026-01", "2026-02") == [
        ("2026-01", "HN", 500, 1, None),
        ("2026-02", "HN", 250, 2, -50.0),
    ]
