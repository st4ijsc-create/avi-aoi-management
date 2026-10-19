import json

from .kho import KhoDonHang

LOAI_JSON = "application/json; charset=utf-8"


def _tra_json(start_response, trang_thai, du_lieu, them_header=()):
    than = json.dumps(du_lieu, ensure_ascii=False).encode("utf-8")
    start_response(trang_thai, [("Content-Type", LOAI_JSON), ("Content-Length", str(len(than))), *them_header])
    return [than]


def _doc_than(environ):
    """Thân yêu cầu đã giải mã JSON; None nếu rỗng, không phải UTF-8 hoặc JSON hỏng."""
    try:
        do_dai = int(environ.get("CONTENT_LENGTH") or 0)
    except ValueError:
        do_dai = 0
    if do_dai <= 0:
        return None
    tho = environ["wsgi.input"].read(do_dai)
    try:
        return json.loads(tho.decode("utf-8"))
    except ValueError:
        return None


def tao_ung_dung():
    kho = KhoDonHang()

    def ung_dung(environ, start_response):
        phuong_thuc = environ["REQUEST_METHOD"]
        duong = environ.get("PATH_INFO", "")
        if duong == "/don-hang" and phuong_thuc == "GET":
            return _tra_json(start_response, "200 OK", {"don_hang": kho.danh_sach()})
        # TODO: lọc ?trang_thai=, POST /don-hang, GET/PATCH /don-hang/<id>, 404, 405 (+ Allow)
        return _tra_json(start_response, "404 Not Found", {"loi": "khong_tim_thay"})

    return ung_dung
