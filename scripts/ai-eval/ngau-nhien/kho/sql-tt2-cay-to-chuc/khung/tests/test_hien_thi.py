from kiem_sql import ket_noi, chay_kich_ban, truy_van


def _db(hang):
    con = ket_noi()
    chay_kich_ban(con, "schema.sql")
    con.executemany("INSERT INTO nhan_vien (id, ten, quan_ly_id) VALUES (?, ?, ?)", hang)
    return con


def test_cay_nho():
    con = _db([
        (1, "Hà", None),
        (2, "Minh", 1),
        (3, "Lan", 1),
        (4, "Tú", 2),
    ])
    assert truy_van(con, "cay_to_chuc.sql") == [
        (1, "Hà", 0, "Hà", 3),
        (2, "Minh", 1, "Hà > Minh", 1),
        (4, "Tú", 2, "Hà > Minh > Tú", 0),
        (3, "Lan", 1, "Hà > Lan", 0),
    ]


def test_mot_nguoi():
    con = _db([(5, "Sơn", None)])
    assert truy_van(con, "cay_to_chuc.sql") == [(5, "Sơn", 0, "Sơn", 0)]


def test_con_xep_theo_id_khong_theo_thu_tu_chen():
    con = _db([
        (1, "Gốc", None),
        (3, "Ba", 1),
        (2, "Hai", 1),
    ])
    assert truy_van(con, "cay_to_chuc.sql") == [
        (1, "Gốc", 0, "Gốc", 2),
        (2, "Hai", 1, "Gốc > Hai", 0),
        (3, "Ba", 1, "Gốc > Ba", 0),
    ]
