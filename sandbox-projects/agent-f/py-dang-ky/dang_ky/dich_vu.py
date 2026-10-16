from .kho import KhoBoNho
from .mo_hinh import NguoiDangKy
from .thong_diep import t


class LoiDangKy(Exception):
    pass


class DichVuDangKy:
    def __init__(self, kho: KhoBoNho | None = None):
        self.kho = kho or KhoBoNho()

    def dang_ky(self, du_lieu: dict) -> str:
        email = str(du_lieu.get("email", "")).strip()
        if self.kho.tim_theo_email(email):
            raise LoiDangKy(t("email_trung"))
        nguoi = NguoiDangKy(
            ho_ten=str(du_lieu.get("ho_ten", "")).strip(),
            email=email,
            tuoi=int(du_lieu.get("tuoi", 0)),
            so_dien_thoai=du_lieu.get("so_dien_thoai") or None,
        )
        return self.kho.them(nguoi)

    def loi_chao(self, ma: str) -> str:
        return t("thanh_cong", ma=ma)
