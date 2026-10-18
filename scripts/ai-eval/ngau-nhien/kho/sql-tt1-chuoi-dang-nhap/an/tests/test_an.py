from kiem_sql import ket_noi, chay_kich_ban, truy_van, cot


def _db(hang):
    con = ket_noi()
    chay_kich_ban(con, "schema.sql")
    con.executemany("INSERT INTO dang_nhap VALUES (?, ?)", hang)
    return con


def test_nhieu_lan_mot_ngay_chi_tinh_mot():
    con = _db([
        ("an", "2026-03-01 08:00:00"),
        ("an", "2026-03-02 08:00:00"),
        ("an", "2026-03-02 12:00:00"),
        ("an", "2026-03-02 23:59:59"),
        ("an", "2026-03-03 00:00:00"),
    ])
    assert truy_van(con, "chuoi_dai_nhat.sql") == [("an", 3, "2026-03-01", "2026-03-03")]


def test_hoa_lay_chuoi_som_nhat():
    con = _db([
        ("an", "2026-05-10 08:00:00"),
        ("an", "2026-05-11 08:00:00"),
        ("an", "2026-05-01 08:00:00"),
        ("an", "2026-05-02 08:00:00"),
    ])
    assert truy_van(con, "chuoi_dai_nhat.sql") == [("an", 2, "2026-05-01", "2026-05-02")]


def test_qua_thang_va_nam_nhuan():
    con = _db([
        ("an", "2028-02-28 08:00:00"),
        ("an", "2028-02-29 08:00:00"),
        ("an", "2028-03-01 08:00:00"),
        ("an", "2027-12-31 08:00:00"),
        ("an", "2028-01-01 08:00:00"),
    ])
    assert truy_van(con, "chuoi_dai_nhat.sql") == [("an", 3, "2028-02-28", "2028-03-01")]


def test_ten_cot_va_kieu():
    con = _db([("an", "2026-03-01 08:00:00")])
    ten, hang = cot(con, "chuoi_dai_nhat.sql")
    assert ten == ["nguoi_dung", "do_dai", "bat_dau", "ket_thuc"]
    assert isinstance(hang[0][1], int)


def test_bang_rong():
    con = _db([])
    assert truy_van(con, "chuoi_dai_nhat.sql") == []


def test_tron_nhieu_nguoi_va_thu_tu():
    hang = []
    for d in (1, 2, 3, 4):
        hang.append(("cuong", f"2026-07-0{d} 09:00:00"))
    for d in (1, 2, 3, 4):
        hang.append(("an", f"2026-07-0{d} 18:00:00"))
    for d in (1, 3, 5, 7):
        hang.append(("dung", f"2026-07-0{d} 18:00:00"))
    hang.append(("an", "2026-07-04 19:00:00"))
    con = _db(hang)
    assert truy_van(con, "chuoi_dai_nhat.sql") == [
        ("an", 4, "2026-07-01", "2026-07-04"),
        ("cuong", 4, "2026-07-01", "2026-07-04"),
        ("dung", 1, "2026-07-01", "2026-07-01"),
    ]
