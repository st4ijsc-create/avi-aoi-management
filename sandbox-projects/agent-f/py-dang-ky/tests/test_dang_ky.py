import pytest

from dang_ky import DichVuDangKy, LoiDangKy


def hop_le(**ghi_de):
    du_lieu = {"ho_ten": "Nguyễn Văn An", "email": "an@vidu.vn", "tuoi": 30}
    du_lieu.update(ghi_de)
    return du_lieu


def test_dang_ky_thanh_cong_cap_ma_tang_dan():
    dv = DichVuDangKy()
    assert dv.dang_ky(hop_le()) == "DK-0001"
    assert dv.dang_ky(hop_le(email="binh@vidu.vn")) == "DK-0002"
    assert dv.loi_chao("DK-0002") == "Đăng ký thành công, mã của bạn là DK-0002"


def test_email_trung_khong_phan_biet_hoa_thuong():
    dv = DichVuDangKy()
    dv.dang_ky(hop_le())
    with pytest.raises(LoiDangKy, match="Email đã được đăng ký"):
        dv.dang_ky(hop_le(email="AN@vidu.vn", ho_ten="Người khác"))


def test_luu_du_lieu_da_chuan_hoa():
    dv = DichVuDangKy()
    ma = dv.dang_ky(hop_le(ho_ten="  Trần Thị Bình  ", tuoi="45"))
    nguoi = dv.kho.lay(ma)
    assert nguoi.ho_ten == "Trần Thị Bình"
    assert nguoi.tuoi == 45
    assert nguoi.so_dien_thoai is None
