import json

from kiem_sql import ket_noi, chay_kich_ban, truy_van, cot


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


def test_tong_tien_thieu_phi_ship_va_don_rong():
    con = _db(
        (3, "c", {"ngay": "2026-01-01", "mat_hang": [_mh("X", 4, 2500)]}),
        (1, "a", {"ngay": "2026-01-02", "phi_ship": None, "mat_hang": [_mh("Y", 1, 700), _mh("Z", 2, 150)]}),
        (2, "b", {"ngay": "2026-01-03", "phi_ship": 30000, "mat_hang": []}),
    )
    assert truy_van(con, "tong_tien.sql") == [
        (1, "a", 2, 1000),
        (2, "b", 0, 30000),
        (3, "c", 1, 10000),
    ]


def test_tong_tien_ten_cot_kieu_va_bang_rong():
    assert truy_van(_db(), "tong_tien.sql") == []
    ten, hang = cot(_db((1, "a", {"ngay": "2026-01-01", "phi_ship": 5, "mat_hang": [_mh("Q", 3, 7)]})), "tong_tien.sql")
    assert ten == ["id", "khach", "so_mat_hang", "tong_tien"]
    assert hang == [(1, "a", 1, 26)]
    assert isinstance(hang[0][2], int) and isinstance(hang[0][3], int)


def test_dem_the_mot_don_nhieu_mat_hang_cung_the_tinh_mot_don():
    con = _db(
        (1, "a", {"ngay": "2026-02-01", "mat_hang": [_mh("A", 2, 10, ["sale"]), _mh("B", 5, 10, ["sale", "moi"])]}),
        (2, "b", {"ngay": "2026-02-02", "mat_hang": [_mh("C", 1, 10, ["moi"])]}),
    )
    assert truy_van(con, "dem_the.sql") == [
        ("moi", 2, 6),
        ("sale", 1, 7),
    ]


def test_dem_the_bo_qua_mat_hang_khong_the_va_hoa_xep_theo_ten():
    con = _db(
        (1, "a", {"ngay": "2026-02-01", "mat_hang": [_mh("A", 1, 10), _mh("B", 2, 10, []), _mh("C", 3, 10, ["giảm-giá"])]}),
        (2, "b", {"ngay": "2026-02-02", "mat_hang": [_mh("D", 4, 10, ["bán-chạy"])]}),
        (3, "c", {"ngay": "2026-02-03", "mat_hang": []}),
    )
    ten, hang = cot(con, "dem_the.sql")
    assert ten == ["the", "so_don", "so_luong"]
    assert hang == [("bán-chạy", 1, 4), ("giảm-giá", 1, 3)]


def test_dem_the_bang_rong():
    assert truy_van(_db(), "dem_the.sql") == []


def test_xuat_json_nguong_bao_gom_bang_va_tong_sl_moi_mat_hang():
    con = _db(
        (5, "an", {"ngay": "2026-04-05", "mat_hang": [_mh("A", 1, 100), _mh("B", 4, 5)]}),
        (2, "an", {"ngay": "2026-04-02", "mat_hang": [_mh("C", 2, 150)]}),
        (3, "an", {"ngay": "2026-04-03", "mat_hang": [_mh("D", 9, 99)]}),
        (4, "chi", {"ngay": "2026-04-04", "mat_hang": [_mh("E", 1, 99)]}),
        (1, "bao", {"ngay": "2026-04-01", "phi_ship": 1000, "mat_hang": [_mh("F", 7, 100), _mh("G", 1, 1)]}),
    )
    hang = truy_van(con, "xuat_json.sql", {"nguong": 100})
    assert [h[0] for h in hang] == ["an", "bao"]
    assert all(isinstance(h[1], str) for h in hang)
    assert json.loads(hang[0][1]) == [
        {"id": 2, "ngay": "2026-04-02", "tong_sl": 2},
        {"id": 5, "ngay": "2026-04-05", "tong_sl": 5},
    ]
    assert json.loads(hang[1][1]) == [{"id": 1, "ngay": "2026-04-01", "tong_sl": 8}]


def test_xuat_json_doi_nguong_va_khong_khop():
    con = _db(
        (1, "an", {"ngay": "2026-04-01", "mat_hang": [_mh("A", 1, 100)]}),
        (2, "bao", {"ngay": "2026-04-02", "mat_hang": [_mh("B", 1, 20)]}),
        (3, "bao", {"ngay": "2026-04-03", "mat_hang": []}),
    )
    hang = truy_van(con, "xuat_json.sql", {"nguong": 20})
    assert [h[0] for h in hang] == ["an", "bao"]
    assert json.loads(hang[1][1]) == [{"id": 2, "ngay": "2026-04-02", "tong_sl": 1}]
    assert truy_van(con, "xuat_json.sql", {"nguong": 101}) == []


def test_xuat_json_ten_cot():
    con = _db((1, "an", {"ngay": "2026-04-01", "mat_hang": [_mh("A", 3, 100)]}))
    ten, hang = cot(con, "xuat_json.sql", {"nguong": 1})
    assert ten == ["khach", "don"]
    assert json.loads(hang[0][1]) == [{"id": 1, "ngay": "2026-04-01", "tong_sl": 3}]
