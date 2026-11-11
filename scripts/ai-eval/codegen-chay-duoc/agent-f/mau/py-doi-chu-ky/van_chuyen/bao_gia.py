"""Báo giá cho nhiều kiện hàng. Mỗi kiện là cặp (khối lượng kg, khoảng cách km)."""
from .phi import DonVanChuyen, tinh_phi


def bao_gia_nhieu(ds_kien):
    """Danh sách phí theo đúng thứ tự kiện."""
    return [tinh_phi(DonVanChuyen(kl, kc)) for kl, kc in ds_kien]


def _chon_re_nhat(ds_kien, ham_phi):
    tot = None
    for i, (kl, kc) in enumerate(ds_kien):
        phi = ham_phi(DonVanChuyen(kl, kc))
        if tot is None or phi < tot[1]:
            tot = (i, phi)
    return tot


def bao_gia_re_nhat(ds_kien):
    """(chỉ số, phí) của kiện rẻ nhất; hoà thì lấy kiện đứng trước; danh sách rỗng ⇒ None."""
    return _chon_re_nhat(ds_kien, tinh_phi)
