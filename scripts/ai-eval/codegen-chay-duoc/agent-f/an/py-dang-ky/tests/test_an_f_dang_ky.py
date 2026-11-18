# TEST ẨN bộ F (py-dang-ky) — chép vào dự án lúc chấm, xoá sau khi chấm. Không phải tệp của dự án.
import string
import types
from collections.abc import Mapping

import pytest

from dang_ky import DichVuDangKy, LoiDangKy
from dang_ky.kiem_tra import kiem_tra
from dang_ky.thong_diep import t


def hop_le(**ghi_de):
    du_lieu = {"ho_ten": "Nguyễn Văn An", "email": "an@vidu.vn", "tuoi": 30}
    du_lieu.update(ghi_de)
    return du_lieu


def cap(loi):
    return [(l.truong, l.ma) for l in loi]


VI_EMAIL_TRUNG = "Email đã được đăng ký"
EN_EMAIL_TRUNG = "Email is already registered"


def _nhu_bang(o, ten_module):
    """Xem `o` như bảng khoá → giá trị: Mapping bất kỳ (dict, MappingProxyType, lớp tự viết), hoặc lớp/đối tượng do chính module định nghĩa."""
    if isinstance(o, Mapping):
        return o
    if isinstance(o, types.ModuleType) or callable(o) and not isinstance(o, type):
        return None
    if getattr(o if isinstance(o, type) else type(o), "__module__", None) != ten_module:
        return None
    try:
        return {k: v for k, v in vars(o).items() if not k.startswith("__")}
    except TypeError:
        return None


def khoa_chi_tieng_viet():
    """Khoá có bản tiếng Việt mà KHÔNG có bản tiếng Anh, đọc từ bảng thật của lời giải, kèm mẫu tiếng Việt của khoá.

    Chỉ đọc, không sửa bảng. Tìm bảng theo NỘI DUNG (thông điệp `email_trung` của đề), không theo tên biến, kiểu hay bố cục:
    hai bảng theo ngôn ngữ (lồng `{"vi": …, "en": …}` hoặc hai biến riêng) hoặc một bảng theo khoá (`{khoa: {"vi": …, "en": …}}`).
    Không tìm thấy bảng hoặc mọi khoá đều có tiếng Anh ⇒ []: khi đó nhánh "thiếu khoá" không quan sát được qua `t`.
    """
    import dang_ky.thong_diep as td

    vi = en = theo_khoa = None
    da_xem, hang = set(), [(v, 0) for v in vars(td).values()]
    while hang:
        o, sau = hang.pop()
        if id(o) in da_xem or sau > 4:
            continue
        da_xem.add(id(o))
        b = _nhu_bang(o, td.__name__)
        if b is None:
            continue
        try:
            g = b.get("email_trung") if hasattr(b, "get") else None
            con = list(b.values())
        except Exception:
            continue
        if g == VI_EMAIL_TRUNG and vi is None:
            vi = b
        elif g == EN_EMAIL_TRUNG and en is None:
            en = b
        gb = _nhu_bang(g, td.__name__)
        if gb is not None and gb.get("vi") == VI_EMAIL_TRUNG and gb.get("en") == EN_EMAIL_TRUNG:
            theo_khoa = b
        hang.extend((v, sau + 1) for v in con)
    ra = []
    if vi is not None and en is not None:
        ra = [(k, vi[k]) for k in list(vi.keys()) if k not in en]
    elif theo_khoa is not None:
        for k, v in theo_khoa.items():
            vb = _nhu_bang(v, td.__name__)
            if vb is not None and "vi" in vb and "en" not in vb:
                ra.append((k, vb["vi"]))
    return [(k, m) for k, m in ra if isinstance(k, str) and isinstance(m, str)]


def test_an_hop_le_khong_loi():
    assert kiem_tra(hop_le()) == []
    assert kiem_tra(hop_le(tuoi="16", so_dien_thoai="+84 912.345.678")) == []
    assert kiem_tra(hop_le(so_dien_thoai="")) == []


def test_an_ho_ten():
    assert cap(kiem_tra(hop_le(ho_ten="   "))) == [("ho_ten", "bat_buoc")]
    d = hop_le()
    del d["ho_ten"]
    assert cap(kiem_tra(d)) == [("ho_ten", "bat_buoc")]
    assert cap(kiem_tra(hop_le(ho_ten=" A "))) == [("ho_ten", "do_dai")]
    assert cap(kiem_tra(hop_le(ho_ten="x" * 81))) == [("ho_ten", "do_dai")]
    assert kiem_tra(hop_le(ho_ten="x" * 80)) == []


def test_an_email():
    d = hop_le()
    del d["email"]
    assert cap(kiem_tra(d)) == [("email", "bat_buoc")]
    for sai in ["an.vidu.vn", "an@vidu", "a n@vidu.vn", "an@@vidu.vn", "an@vi@du.vn"]:
        assert cap(kiem_tra(hop_le(email=sai))) == [("email", "email_sai")], sai


def test_an_tuoi():
    d = hop_le()
    del d["tuoi"]
    assert cap(kiem_tra(d)) == [("tuoi", "bat_buoc")]
    assert cap(kiem_tra(hop_le(tuoi="ba mươi"))) == [("tuoi", "khong_phai_so")]
    assert cap(kiem_tra(hop_le(tuoi="30.5"))) == [("tuoi", "khong_phai_so")]
    assert cap(kiem_tra(hop_le(tuoi=15))) == [("tuoi", "ngoai_khoang")]
    assert cap(kiem_tra(hop_le(tuoi="101"))) == [("tuoi", "ngoai_khoang")]
    assert kiem_tra(hop_le(tuoi=100)) == []


def test_an_so_dien_thoai():
    for dung in ["0912345678", "0912 345 678", "+84912345678", "091.234.5678"]:
        assert kiem_tra(hop_le(so_dien_thoai=dung)) == [], dung
    for sai in ["912345678", "09123456789", "+8491234567", "0912-345-678", "abc"]:
        assert cap(kiem_tra(hop_le(so_dien_thoai=sai))) == [("so_dien_thoai", "sdt_sai")], sai


def test_an_nhieu_loi_theo_thu_tu_truong():
    loi = kiem_tra({"ho_ten": "", "email": "x", "tuoi": 5, "so_dien_thoai": "123"})
    assert cap(loi) == [("ho_ten", "bat_buoc"), ("email", "email_sai"), ("tuoi", "ngoai_khoang"), ("so_dien_thoai", "sdt_sai")]


def test_an_thong_diep_hai_ngon_ngu_va_du_phong():
    assert t("email_trung") == VI_EMAIL_TRUNG
    assert t("email_trung", "en") == EN_EMAIL_TRUNG
    assert t("bat_buoc", "en", ten_truong="Age") == "Age is required"
    assert t("bat_buoc", "fr", ten_truong="Tuổi") == "Tuổi là bắt buộc"
    # Khoá thiếu trong tiếng Anh ⇒ dùng tiếng Việt: thử bằng hành vi trên mọi khoá mà CHÍNH lời giải để thiếu tiếng Anh.
    # (10/11: bản đầu đòi `thanh_cong` thiếu tiếng Anh — đề không nói; bản c99b21d79 monkeypatch vào dict cấp module — trượt
    # lời giải đúng dùng MappingProxyType. Bản này không sửa bảng, không phụ thuộc kiểu bảng.)
    for khoa, mau in khoa_chi_tieng_viet():
        ten = [f for _, f, _, _ in string.Formatter().parse(mau) if f is not None]
        if any(not f or not f.isidentifier() for f in ten):
            continue
        tham_so = {f: f"<{f}>" for f in ten}
        assert t(khoa, "en", **tham_so) == mau.format(**tham_so), khoa


def test_an_dang_ky_loi_tieng_viet():
    dv = DichVuDangKy()
    with pytest.raises(LoiDangKy) as e:
        dv.dang_ky({"ho_ten": "A", "email": "an@vidu.vn", "tuoi": "abc"})
    assert e.value.loi == [
        {"truong": "ho_ten", "ma": "do_dai", "thong_diep": "Họ tên phải dài từ 2 đến 80 ký tự"},
        {"truong": "tuoi", "ma": "khong_phai_so", "thong_diep": "Tuổi phải là số nguyên"},
    ]
    assert str(e.value) == "Họ tên phải dài từ 2 đến 80 ký tự; Tuổi phải là số nguyên"
    assert dv.kho.danh_sach() == []


def test_an_dang_ky_loi_tieng_anh():
    dv = DichVuDangKy()
    with pytest.raises(LoiDangKy) as e:
        dv.dang_ky({"email": "sai", "tuoi": 12, "so_dien_thoai": "12"}, ngon_ngu="en")
    assert [l["thong_diep"] for l in e.value.loi] == [
        "Full name is required",
        "Invalid email address",
        "Age must be between 16 and 100",
        "Invalid phone number",
    ]


def test_an_email_trung_theo_ngon_ngu():
    dv = DichVuDangKy()
    dv.dang_ky(hop_le())
    with pytest.raises(LoiDangKy) as e:
        dv.dang_ky(hop_le(ho_ten="Người khác"), ngon_ngu="en")
    assert e.value.loi == [{"truong": "email", "ma": "email_trung", "thong_diep": "Email is already registered"}]
    assert str(e.value) == "Email is already registered"


def test_an_luu_sdt_da_chuan_hoa():
    dv = DichVuDangKy()
    ma = dv.dang_ky(hop_le(so_dien_thoai="0912 345.678", tuoi="20"))
    nguoi = dv.kho.lay(ma)
    assert nguoi.so_dien_thoai == "0912345678"
    assert nguoi.tuoi == 20
