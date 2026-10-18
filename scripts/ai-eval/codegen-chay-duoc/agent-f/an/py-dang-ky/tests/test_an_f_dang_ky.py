# TEST ẨN bộ F (py-dang-ky) — chép vào dự án lúc chấm, xoá sau khi chấm. Không phải tệp của dự án.
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
    assert t("email_trung") == "Email đã được đăng ký"
    assert t("email_trung", "en") == "Email is already registered"
    assert t("bat_buoc", "en", ten_truong="Age") == "Age is required"
    assert t("bat_buoc", "fr", ten_truong="Tuổi") == "Tuổi là bắt buộc"
    # khoá thiếu trong tiếng Anh ⇒ dùng tiếng Việt
    assert t("thanh_cong", "en", ma="DK-0001") == "Đăng ký thành công, mã của bạn là DK-0001"


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
