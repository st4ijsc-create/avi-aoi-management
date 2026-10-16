from .kho import KhoBoNho
from .kiem_tra import chuan_hoa_sdt, kiem_tra
from .mo_hinh import NguoiDangKy
from .thong_diep import t


class LoiDangKy(Exception):
    def __init__(self, loi: list[dict]):
        self.loi = loi
        super().__init__("; ".join(l["thong_diep"] for l in loi))


class DichVuDangKy:
    def __init__(self, kho: KhoBoNho | None = None):
        self.kho = kho or KhoBoNho()

    def dang_ky(self, du_lieu: dict, ngon_ngu: str = "vi") -> str:
        loi = kiem_tra(du_lieu)
        if loi:
            raise LoiDangKy([
                {
                    "truong": l.truong,
                    "ma": l.ma,
                    "thong_diep": t(l.ma, ngon_ngu, ten_truong=t(f"truong.{l.truong}", ngon_ngu)),
                }
                for l in loi
            ])
        email = str(du_lieu["email"]).strip()
        if self.kho.tim_theo_email(email):
            raise LoiDangKy([{"truong": "email", "ma": "email_trung", "thong_diep": t("email_trung", ngon_ngu)}])
        sdt = du_lieu.get("so_dien_thoai")
        nguoi = NguoiDangKy(
            ho_ten=str(du_lieu["ho_ten"]).strip(),
            email=email,
            tuoi=int(str(du_lieu["tuoi"]).strip()),
            so_dien_thoai=chuan_hoa_sdt(sdt) if sdt not in (None, "") and str(sdt).strip() else None,
        )
        return self.kho.them(nguoi)

    def loi_chao(self, ma: str) -> str:
        return t("thanh_cong", ma=ma)
