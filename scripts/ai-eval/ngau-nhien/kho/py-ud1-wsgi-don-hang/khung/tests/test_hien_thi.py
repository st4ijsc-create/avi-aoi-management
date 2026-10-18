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


DON = {"khach": "Lan", "dong": [{"ma": "SP1", "so_luong": 2, "don_gia": 15000}, {"ma": "SP2", "so_luong": 1, "don_gia": 5000}]}


def test_tao_don_hang():
    app = tao_ung_dung()
    ma, header, than = goi(app, "POST", "/don-hang", DON)
    assert ma == 201
    assert header["Location"] == "/don-hang/1"
    assert than == {"id": 1, "khach": "Lan", "dong": DON["dong"], "trang_thai": "moi", "tong": 35000}


def test_lay_mot_don_va_danh_sach():
    app = tao_ung_dung()
    goi(app, "POST", "/don-hang", DON)
    ma, _, than = goi(app, "GET", "/don-hang/1")
    assert ma == 200
    assert than["tong"] == 35000
    ma, _, than = goi(app, "GET", "/don-hang")
    assert ma == 200
    assert [d["id"] for d in than["don_hang"]] == [1]


def test_khong_tim_thay():
    app = tao_ung_dung()
    ma, _, than = goi(app, "GET", "/don-hang/99")
    assert ma == 404
    assert than == {"loi": "khong_tim_thay"}
