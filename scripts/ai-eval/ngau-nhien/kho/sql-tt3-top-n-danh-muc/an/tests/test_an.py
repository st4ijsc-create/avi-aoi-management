from kiem_sql import ket_noi, chay_kich_ban, truy_van, cot


def _db(danh_muc, san_pham, ban_hang):
    con = ket_noi()
    chay_kich_ban(con, "schema.sql")
    con.executemany("INSERT INTO danh_muc (id, ten) VALUES (?, ?)", danh_muc)
    con.executemany("INSERT INTO san_pham (id, ten, danh_muc_id) VALUES (?, ?, ?)", san_pham)
    con.executemany("INSERT INTO ban_hang (san_pham_id, so_luong, don_gia) VALUES (?, ?, ?)", ban_hang)
    return con


def test_dong_hang_dau_hang_ke_tiep_lien_sau():
    # 400, 400, 200, 100 => hạng 1, 1, 2, 3 => giữ 3 sản phẩm; tổng 1100
    con = _db(
        [(1, "Đồ chơi")],
        [(1, "Xe", 1), (2, "Búp bê", 1), (3, "Bóng", 1), (4, "Diều", 1)],
        [(1, 4, 100), (2, 2, 200), (3, 2, 100), (4, 1, 100)],
    )
    assert truy_van(con, "top_san_pham.sql") == [
        ("Đồ chơi", 1, "Búp bê", 400, 36.36),
        ("Đồ chơi", 1, "Xe", 400, 36.36),
        ("Đồ chơi", 2, "Bóng", 200, 18.18),
    ]


def test_dong_hang_hai():
    # 100, 50, 50, 20 => 1, 2, 2, 3; tổng 220
    con = _db(
        [(1, "Rau")],
        [(1, "Cải", 1), (2, "Muống", 1), (3, "Dền", 1), (4, "Ngót", 1)],
        [(1, 1, 100), (2, 1, 50), (3, 1, 50), (4, 1, 20)],
    )
    assert truy_van(con, "top_san_pham.sql") == [
        ("Rau", 1, "Cải", 100, 45.45),
        ("Rau", 2, "Dền", 50, 22.73),
        ("Rau", 2, "Muống", 50, 22.73),
    ]


def test_ty_trong_tinh_tren_ca_danh_muc_va_lam_tron():
    # 5, 3, 1 => tổng 9
    con = _db(
        [(1, "Trà")],
        [(1, "Sen", 1), (2, "Lài", 1), (3, "Ô long", 1)],
        [(1, 5, 1), (2, 3, 1), (3, 1, 1)],
    )
    assert truy_van(con, "top_san_pham.sql") == [
        ("Trà", 1, "Sen", 5, 55.56),
        ("Trà", 2, "Lài", 3, 33.33),
    ]


def test_cong_don_nhieu_lan_ban():
    # ST25: 30000 + 50000 = 80000; Tám: 40000 + 1000 = 41000; tổng 121000
    con = _db(
        [(1, "Gạo")],
        [(1, "ST25", 1), (2, "Tám", 1)],
        [(1, 1, 30000), (2, 2, 20000), (1, 2, 25000), (2, 1, 1000)],
    )
    assert truy_van(con, "top_san_pham.sql") == [
        ("Gạo", 1, "ST25", 80000, 66.12),
        ("Gạo", 2, "Tám", 41000, 33.88),
    ]


def test_san_pham_chua_ban_khong_chiem_hang():
    con = _db(
        [(1, "Giày"), (2, "Mũ")],
        [(1, "Dép", 1), (2, "Bốt", 1), (3, "Lưỡi trai", 2), (4, "Nồi", 2)],
        [(2, 3, 10)],
    )
    assert truy_van(con, "top_san_pham.sql") == [
        ("Giày", 1, "Bốt", 30, 100.0),
        ("Mũ", None, None, 0, None),
    ]


def test_thu_tu_danh_muc_theo_id():
    con = _db(
        [(5, "A-cuối"), (2, "Z-đầu")],
        [(1, "p", 5), (2, "q", 2)],
        [(1, 1, 7), (2, 1, 9)],
    )
    assert truy_van(con, "top_san_pham.sql") == [
        ("Z-đầu", 1, "q", 9, 100.0),
        ("A-cuối", 1, "p", 7, 100.0),
    ]


def test_ten_cot_va_kieu():
    con = _db([(1, "K")], [(1, "a", 1), (2, "b", 1)], [(1, 1, 3), (2, 1, 1)])
    ten, hang = cot(con, "top_san_pham.sql")
    assert ten == ["danh_muc", "hang", "san_pham", "doanh_thu", "ty_trong"]
    assert hang == [("K", 1, "a", 3, 75.0), ("K", 2, "b", 1, 25.0)]
    assert all(isinstance(h[1], int) and isinstance(h[3], int) and isinstance(h[4], float) for h in hang)


def test_khong_co_danh_muc():
    assert truy_van(_db([], [], []), "top_san_pham.sql") == []
