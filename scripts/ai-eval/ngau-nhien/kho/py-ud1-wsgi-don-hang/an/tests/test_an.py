import io
import json
from wsgiref.util import setup_testing_defaults
from wsgiref.validate import validator

from don_hang import tao_ung_dung


def goi(app, phuong_thuc, duong, than=None, truy_van="", tho=None):
    """Gọi ứng dụng WSGI (bọc wsgiref.validate) ⇒ (mã trạng thái, dict header, thân JSON đã giải mã)."""
    du_lieu = tho if tho is not None else (b"" if than is None else json.dumps(than).encode("utf-8"))
    environ = {}
    setup_testing_defaults(environ)
    environ.update({
        "REQUEST_METHOD": phuong_thuc,
        "PATH_INFO": duong,
        "QUERY_STRING": truy_van,
        "CONTENT_TYPE": "application/json",
        "CONTENT_LENGTH": str(len(du_lieu)),
        "wsgi.input": io.BytesIO(du_lieu),
    })
    ket = {}

    def start_response(trang_thai, header, exc_info=None):
        ket["ma"] = int(trang_thai.split(" ", 1)[0])
        ket["header"] = dict(header)
        return lambda _: None

    it = validator(app)(environ, start_response)
    try:
        than_ra = b"".join(it)
    finally:
        it.close()
    return ket["ma"], ket["header"], json.loads(than_ra.decode("utf-8"))


def mot_dong(ma="A", so_luong=1, don_gia=1000):
    return {"khach": "Khách", "dong": [{"ma": ma, "so_luong": so_luong, "don_gia": don_gia}]}


def test_vong_doi_trang_thai_hop_le():
    app = tao_ung_dung()
    goi(app, "POST", "/don-hang", mot_dong())
    ma, _, than = goi(app, "PATCH", "/don-hang/1", {"trang_thai": "da_xac_nhan"})
    assert (ma, than["trang_thai"], than["id"]) == (200, "da_xac_nhan", 1)
    ma, _, than = goi(app, "PATCH", "/don-hang/1", {"trang_thai": "da_huy"})
    assert (ma, than["trang_thai"]) == (200, "da_huy")
    assert goi(app, "GET", "/don-hang/1")[2]["trang_thai"] == "da_huy"
    goi(app, "POST", "/don-hang", mot_dong())
    ma, _, than = goi(app, "PATCH", "/don-hang/2", {"trang_thai": "da_huy"})
    assert (ma, than["trang_thai"]) == (200, "da_huy")


def test_chuyen_trang_thai_sai():
    app = tao_ung_dung()
    for _ in range(3):
        goi(app, "POST", "/don-hang", mot_dong())
    goi(app, "PATCH", "/don-hang/2", {"trang_thai": "da_xac_nhan"})
    goi(app, "PATCH", "/don-hang/3", {"trang_thai": "da_huy"})
    for so, gia_tri in [(1, "moi"), (2, "moi"), (2, "da_xac_nhan"), (3, "moi"), (3, "da_xac_nhan"), (3, "da_huy")]:
        ma, _, than = goi(app, "PATCH", f"/don-hang/{so}", {"trang_thai": gia_tri})
        assert (ma, than) == (400, {"loi": "du_lieu_khong_hop_le",
                                    "chi_tiet": [{"truong": "trang_thai", "loi": "chuyen_khong_hop_le"}]}), (so, gia_tri)
    for than_gui, ma_loi in [({"trang_thai": "xong"}, "khong_hop_le"), ({"trang_thai": 5}, "khong_hop_le"),
                             ({"ghi_chu": "x"}, "bat_buoc")]:
        ma, _, than = goi(app, "PATCH", "/don-hang/1", than_gui)
        assert (ma, than["chi_tiet"]) == (400, [{"truong": "trang_thai", "loi": ma_loi}])
    trang_thai = [d["trang_thai"] for d in goi(app, "GET", "/don-hang")[2]["don_hang"]]
    assert trang_thai == ["moi", "da_xac_nhan", "da_huy"]


def test_loi_xac_thuc_theo_truong_dung_thu_tu():
    app = tao_ung_dung()
    ma, _, than = goi(app, "POST", "/don-hang", {
        "khach": "   ",
        "dong": [{"ma": "A", "so_luong": 0, "don_gia": -1}, "x", {"so_luong": True, "don_gia": 5},
                 {"ma": "", "so_luong": 1.5, "don_gia": None}],
    })
    assert ma == 400
    assert than == {"loi": "du_lieu_khong_hop_le", "chi_tiet": [
        {"truong": "khach", "loi": "khong_hop_le"},
        {"truong": "dong[0].so_luong", "loi": "khong_hop_le"},
        {"truong": "dong[0].don_gia", "loi": "khong_hop_le"},
        {"truong": "dong[1]", "loi": "khong_hop_le"},
        {"truong": "dong[2].ma", "loi": "bat_buoc"},
        {"truong": "dong[2].so_luong", "loi": "khong_hop_le"},
        {"truong": "dong[3].ma", "loi": "khong_hop_le"},
        {"truong": "dong[3].so_luong", "loi": "khong_hop_le"},
        {"truong": "dong[3].don_gia", "loi": "khong_hop_le"},
    ]}
    assert goi(app, "POST", "/don-hang", {})[2]["chi_tiet"] == [
        {"truong": "khach", "loi": "bat_buoc"}, {"truong": "dong", "loi": "bat_buoc"}]
    assert goi(app, "POST", "/don-hang", {"khach": None, "dong": []})[2]["chi_tiet"] == [
        {"truong": "khach", "loi": "khong_hop_le"}, {"truong": "dong", "loi": "khong_hop_le"}]
    assert goi(app, "POST", "/don-hang", {"khach": 7, "dong": {"ma": "A"}})[2]["chi_tiet"] == [
        {"truong": "khach", "loi": "khong_hop_le"}, {"truong": "dong", "loi": "khong_hop_le"}]
    assert goi(app, "GET", "/don-hang")[2] == {"don_hang": []}


def test_json_hong():
    app = tao_ung_dung()
    for tho in [b"{khach", b"[1, 2]", b"\xff\xfe{}", b"", b"null", b"\"chuoi\""]:
        ma, _, than = goi(app, "POST", "/don-hang", tho=tho)
        assert (ma, than) == (400, {"loi": "json_hong"}), tho
    goi(app, "POST", "/don-hang", mot_dong())
    ma, _, than = goi(app, "PATCH", "/don-hang/1", tho=b"{trang_thai")
    assert (ma, than) == (400, {"loi": "json_hong"})
    assert goi(app, "GET", "/don-hang/1")[2]["trang_thai"] == "moi"


def test_phuong_thuc_khong_ho_tro_co_allow():
    app = tao_ung_dung()
    goi(app, "POST", "/don-hang", mot_dong())
    for phuong_thuc, duong, cho_phep in [("PUT", "/don-hang", "GET, POST"), ("DELETE", "/don-hang", "GET, POST"),
                                         ("PATCH", "/don-hang", "GET, POST"), ("POST", "/don-hang/1", "GET, PATCH"),
                                         ("DELETE", "/don-hang/1", "GET, PATCH"), ("PUT", "/don-hang/42", "GET, PATCH")]:
        ma, header, than = goi(app, phuong_thuc, duong, tho=b"{}")
        assert (ma, header.get("Allow"), than) == (405, cho_phep, {"loi": "phuong_thuc_khong_ho_tro"}), (phuong_thuc, duong)
    assert goi(app, "GET", "/don-hang")[2]["don_hang"][0]["id"] == 1
    assert len(goi(app, "GET", "/don-hang")[2]["don_hang"]) == 1


def test_khong_tim_thay_cac_duong():
    app = tao_ung_dung()
    goi(app, "POST", "/don-hang", mot_dong())
    for phuong_thuc, duong in [("GET", "/don-hang/abc"), ("GET", "/don-hang/"), ("GET", "/khac"), ("GET", "/"),
                               ("GET", "/don-hang/1/dong"), ("GET", "/don-hang/2"), ("DELETE", "/khac"),
                               ("PATCH", "/don-hang/2")]:
        ma, _, than = goi(app, phuong_thuc, duong, {"trang_thai": "da_huy"} if phuong_thuc == "PATCH" else None)
        assert (ma, than) == (404, {"loi": "khong_tim_thay"}), (phuong_thuc, duong)


def test_loc_theo_trang_thai():
    app = tao_ung_dung()
    for _ in range(3):
        goi(app, "POST", "/don-hang", mot_dong())
    goi(app, "PATCH", "/don-hang/2", {"trang_thai": "da_huy"})
    assert [d["id"] for d in goi(app, "GET", "/don-hang", truy_van="trang_thai=da_huy")[2]["don_hang"]] == [2]
    assert [d["id"] for d in goi(app, "GET", "/don-hang", truy_van="trang_thai=moi")[2]["don_hang"]] == [1, 3]
    assert goi(app, "GET", "/don-hang", truy_van="trang_thai=da_xac_nhan")[2] == {"don_hang": []}
    ma, _, than = goi(app, "GET", "/don-hang", truy_van="trang_thai=xyz")
    assert (ma, than) == (400, {"loi": "du_lieu_khong_hop_le", "chi_tiet": [{"truong": "trang_thai", "loi": "khong_hop_le"}]})


def test_chuan_hoa_tong_va_header():
    app = tao_ung_dung()
    ma, header, than = goi(app, "POST", "/don-hang", {
        "khach": "  Nguyễn Văn Ân  ",
        "ghi_chu": "bỏ qua",
        "dong": [{"ma": " SP-1 ", "so_luong": 3, "don_gia": 0, "mau": "đỏ"}, {"ma": "SP-2", "so_luong": 4, "don_gia": 2500}],
    })
    assert ma == 201
    assert header["Content-Type"] == "application/json; charset=utf-8"
    assert than == {"id": 1, "khach": "Nguyễn Văn Ân", "trang_thai": "moi", "tong": 10000,
                    "dong": [{"ma": "SP-1", "so_luong": 3, "don_gia": 0}, {"ma": "SP-2", "so_luong": 4, "don_gia": 2500}]}
    assert goi(app, "GET", "/don-hang/1")[2] == than


def test_moi_ung_dung_mot_kho_rieng():
    a, b = tao_ung_dung(), tao_ung_dung()
    goi(a, "POST", "/don-hang", mot_dong())
    goi(a, "POST", "/don-hang", mot_dong())
    ma, header, than = goi(b, "POST", "/don-hang", mot_dong())
    assert (ma, header["Location"], than["id"]) == (201, "/don-hang/1", 1)
    assert len(goi(a, "GET", "/don-hang")[2]["don_hang"]) == 2
    assert len(goi(b, "GET", "/don-hang")[2]["don_hang"]) == 1

