import json

from kiem_sql import ket_noi, chay_kich_ban, truy_van


def _db(*don):
    con = ket_noi()
    chay_kich_ban(con, "schema.sql")
    con.executemany(
        "INSERT INTO don_hang (id, khach, du_lieu) VALUES (?, ?, ?)",
        [(i, k, json.dumps(d, ensure_ascii=False)) for i, k, d in don],
    )
    return con


def _mh(ma, sl, gia, the=None):
    m = {"ma": ma, "sl": sl, "gia": gia}
    if the is not None:
        m["the"] = the
    return m


MAU = (
    (1, "an", {"ngay": "2026-03-01", "phi_ship": 20000,
               "mat_hang": [_mh("A1", 2, 15000, ["sach"]), _mh("B2", 1, 50000, ["do-choi", "qua"])]}),
    (2, "binh", {"ngay": "2026-03-02", "phi_ship": 0,
                 "mat_hang": [_mh("A1", 3, 15000, ["sach", "qua"])]}),
)


def test_tong_tien():
    assert truy_van(_db(*MAU), "tong_tien.sql") == [
        (1, "an", 2, 100000),
        (2, "binh", 1, 45000),
    ]


def test_dem_the():
    assert truy_van(_db(*MAU), "dem_the.sql") == [
        ("qua", 2, 4),
        ("sach", 2, 5),
        ("do-choi", 1, 1),
    ]


def test_xuat_json():
    hang = truy_van(_db(*MAU), "xuat_json.sql", {"nguong": 40000})
    assert len(hang) == 1 and hang[0][0] == "an"
    assert json.loads(hang[0][1]) == [{"id": 1, "ngay": "2026-03-01", "tong_sl": 3}]
