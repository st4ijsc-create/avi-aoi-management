from kiem_sql import ket_noi, chay_kich_ban, truy_van


def _db(danh_muc, san_pham, ban_hang):
    con = ket_noi()
    chay_kich_ban(con, "schema.sql")
    con.executemany("INSERT INTO danh_muc (id, ten) VALUES (?, ?)", danh_muc)
    con.executemany("INSERT INTO san_pham (id, ten, danh_muc_id) VALUES (?, ?, ?)", san_pham)
    con.executemany("INSERT INTO ban_hang (san_pham_id, so_luong, don_gia) VALUES (?, ?, ?)", ban_hang)
    return con


def test_top2_va_ty_trong():
    con = _db(
        [(1, "Sách")],
        [(1, "Toán", 1), (2, "Văn", 1), (3, "Sử", 1)],
        [(1, 6, 100), (2, 3, 100), (3, 1, 100)],
    )
    assert truy_van(con, "top_san_pham.sql") == [
        ("Sách", 1, "Toán", 600, 60.0),
        ("Sách", 2, "Văn", 300, 30.0),
    ]


def test_danh_muc_chua_ban_van_hien():
    con = _db(
        [(1, "Bút"), (2, "Vở")],
        [(1, "Bi", 1)],
        [(1, 2, 5000)],
    )
    assert truy_van(con, "top_san_pham.sql") == [
        ("Bút", 1, "Bi", 10000, 100.0),
        ("Vở", None, None, 0, None),
    ]
