from kiem_sql import ket_noi, chay_kich_ban, truy_van


def _db(hang):
    con = ket_noi()
    chay_kich_ban(con, "schema.sql")
    con.executemany("INSERT INTO dang_nhap VALUES (?, ?)", hang)
    return con


def test_chuoi_co_ban():
    con = _db([
        ("an", "2026-03-01 08:00:00"),
        ("an", "2026-03-02 09:00:00"),
        ("an", "2026-03-03 07:00:00"),
        ("an", "2026-03-05 07:00:00"),
    ])
    assert truy_van(con, "chuoi_dai_nhat.sql") == [("an", 3, "2026-03-01", "2026-03-03")]


def test_sap_xep_nhieu_nguoi():
    con = _db([
        ("binh", "2026-01-10 10:00:00"),
        ("an", "2026-01-01 10:00:00"),
        ("an", "2026-01-02 10:00:00"),
    ])
    assert truy_van(con, "chuoi_dai_nhat.sql") == [
        ("an", 2, "2026-01-01", "2026-01-02"),
        ("binh", 1, "2026-01-10", "2026-01-10"),
    ]
