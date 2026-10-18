import json
import re
from urllib.parse import parse_qs

from .kho import KhoDonHang
from .xac_thuc import TRANG_THAI, kiem_tra_doi_trang_thai, kiem_tra_tao

LOAI_JSON = "application/json; charset=utf-8"

_DUONG_MOT_DON = re.compile(r"/don-hang/([0-9]+)")


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


def _khong_tim_thay(start_response):
    return _tra_json(start_response, "404 Not Found", {"loi": "khong_tim_thay"})


def _sai_phuong_thuc(start_response, cho_phep):
    return _tra_json(start_response, "405 Method Not Allowed", {"loi": "phuong_thuc_khong_ho_tro"},
                     [("Allow", cho_phep)])


def _du_lieu_sai(start_response, chi_tiet):
    return _tra_json(start_response, "400 Bad Request", {"loi": "du_lieu_khong_hop_le", "chi_tiet": chi_tiet})


def _json_hong(start_response):
    return _tra_json(start_response, "400 Bad Request", {"loi": "json_hong"})


def tao_ung_dung():
    kho = KhoDonHang()

    def danh_sach(environ, start_response):
        truy_van = parse_qs(environ.get("QUERY_STRING", ""))
        trang_thai = None
        if "trang_thai" in truy_van:
            trang_thai = truy_van["trang_thai"][0]
            if trang_thai not in TRANG_THAI:
                return _du_lieu_sai(start_response, [{"truong": "trang_thai", "loi": "khong_hop_le"}])
        return _tra_json(start_response, "200 OK", {"don_hang": kho.danh_sach(trang_thai)})

    def tao(environ, start_response):
        du_lieu = _doc_than(environ)
        if not isinstance(du_lieu, dict):
            return _json_hong(start_response)
        loi = kiem_tra_tao(du_lieu)
        if loi:
            return _du_lieu_sai(start_response, loi)
        don = kho.tao(du_lieu["khach"], du_lieu["dong"])
        return _tra_json(start_response, "201 Created", don, [("Location", f"/don-hang/{don['id']}")])

    def doi_trang_thai(environ, start_response, don):
        du_lieu = _doc_than(environ)
        if not isinstance(du_lieu, dict):
            return _json_hong(start_response)
        loi = kiem_tra_doi_trang_thai(don["trang_thai"], du_lieu)
        if loi:
            return _du_lieu_sai(start_response, loi)
        return _tra_json(start_response, "200 OK", kho.doi_trang_thai(don["id"], du_lieu["trang_thai"]))

    def ung_dung(environ, start_response):
        phuong_thuc = environ["REQUEST_METHOD"]
        duong = environ.get("PATH_INFO", "")
        if duong == "/don-hang":
            if phuong_thuc == "GET":
                return danh_sach(environ, start_response)
            if phuong_thuc == "POST":
                return tao(environ, start_response)
            return _sai_phuong_thuc(start_response, "GET, POST")
        m = _DUONG_MOT_DON.fullmatch(duong)
        if m is None:
            return _khong_tim_thay(start_response)
        if phuong_thuc not in ("GET", "PATCH"):
            return _sai_phuong_thuc(start_response, "GET, PATCH")
        don = kho.lay(int(m.group(1)))
        if don is None:
            return _khong_tim_thay(start_response)
        if phuong_thuc == "GET":
            return _tra_json(start_response, "200 OK", don)
        return doi_trang_thai(environ, start_response, don)

    return ung_dung
