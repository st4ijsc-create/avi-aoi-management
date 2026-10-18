from kiem_sql import ket_noi, chay_kich_ban, truy_van, cot


def _db(hang):
    con = ket_noi()
    chay_kich_ban(con, "schema.sql")
    con.executemany("INSERT INTO nhan_vien (id, ten, quan_ly_id) VALUES (?, ?, ?)", hang)
    return con


def test_bang_rong():
    assert truy_van(_db([]), "cay_to_chuc.sql") == []


def test_ten_cot_va_kieu():
    ten, hang = cot(_db([(1, "A", None), (2, "B", 1)]), "cay_to_chuc.sql")
    assert ten == ["id", "ten", "cap", "duong_dan", "so_cap_duoi"]
    for h in hang:
        assert isinstance(h[2], int) and isinstance(h[4], int)


def test_id_nhieu_chu_so_xep_theo_gia_tri_so():
    # 2 < 10 < 11 theo GIÁ TRỊ số (so sánh chuỗi sẽ xếp "10" trước "2")
    con = _db([
        (1, "Gốc", None),
        (10, "Mười", 1),
        (2, "Hai", 1),
        (11, "Mười một", 2),
        (3, "Ba", 2),
    ])
    assert truy_van(con, "cay_to_chuc.sql") == [
        (1, "Gốc", 0, "Gốc", 4),
        (2, "Hai", 1, "Gốc > Hai", 2),
        (3, "Ba", 2, "Gốc > Hai > Ba", 0),
        (11, "Mười một", 2, "Gốc > Hai > Mười một", 0),
        (10, "Mười", 1, "Gốc > Mười", 0),
    ]


def test_nhieu_cay_theo_id_goc():
    con = _db([
        (20, "Bắc", None),
        (7, "Nam", None),
        (21, "B1", 20),
        (8, "N1", 7),
        (9, "N2", 7),
    ])
    assert truy_van(con, "cay_to_chuc.sql") == [
        (7, "Nam", 0, "Nam", 2),
        (8, "N1", 1, "Nam > N1", 0),
        (9, "N2", 1, "Nam > N2", 0),
        (20, "Bắc", 0, "Bắc", 1),
        (21, "B1", 1, "Bắc > B1", 0),
    ]


def test_chuoi_sau_dem_gian_tiep():
    hang = [(1, "c0", None)] + [(i, f"c{i - 1}", i - 1) for i in range(2, 8)]
    kq = truy_van(_db(hang), "cay_to_chuc.sql")
    assert [h[0] for h in kq] == [1, 2, 3, 4, 5, 6, 7]
    assert [h[2] for h in kq] == [0, 1, 2, 3, 4, 5, 6]
    assert [h[4] for h in kq] == [6, 5, 4, 3, 2, 1, 0]
    assert kq[-1][3] == "c0 > c1 > c2 > c3 > c4 > c5 > c6"


def test_ten_trung_nhau_van_tach_theo_id():
    con = _db([
        (1, "An", None),
        (2, "An", 1),
        (3, "An", 2),
        (4, "Bình", 1),
    ])
    assert truy_van(con, "cay_to_chuc.sql") == [
        (1, "An", 0, "An", 3),
        (2, "An", 1, "An > An", 1),
        (3, "An", 2, "An > An > An", 0),
        (4, "Bình", 1, "An > Bình", 0),
    ]


def test_dem_cay_con_khong_lan_sang_nhanh_co_id_tien_to():
    # nhánh 1 và nhánh 12 không được tính lẫn cấp dưới của nhau
    con = _db([
        (100, "Gốc", None),
        (1, "X", 100),
        (12, "Y", 100),
        (5, "x1", 1),
        (13, "y1", 12),
        (14, "y2", 12),
        (15, "y3", 14),
    ])
    kq = {h[0]: h[4] for h in truy_van(con, "cay_to_chuc.sql")}
    assert kq == {100: 6, 1: 1, 12: 3, 5: 0, 13: 0, 14: 1, 15: 0}
