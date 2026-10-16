import re
from dataclasses import dataclass

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_SDT = re.compile(r"^(0|\+84)\d{9}$")


@dataclass
class LoiTruong:
    truong: str
    ma: str


def chuan_hoa_sdt(gia_tri) -> str:
    return re.sub(r"[ .]", "", str(gia_tri))


def _rong(gia_tri) -> bool:
    return gia_tri is None or (isinstance(gia_tri, str) and gia_tri.strip() == "")


def kiem_tra(du_lieu: dict) -> list[LoiTruong]:
    loi: list[LoiTruong] = []

    ho_ten = du_lieu.get("ho_ten")
    if _rong(ho_ten):
        loi.append(LoiTruong("ho_ten", "bat_buoc"))
    elif not 2 <= len(str(ho_ten).strip()) <= 80:
        loi.append(LoiTruong("ho_ten", "do_dai"))

    email = du_lieu.get("email")
    if _rong(email):
        loi.append(LoiTruong("email", "bat_buoc"))
    elif not _EMAIL.match(str(email).strip()):
        loi.append(LoiTruong("email", "email_sai"))

    tuoi = du_lieu.get("tuoi")
    if _rong(tuoi):
        loi.append(LoiTruong("tuoi", "bat_buoc"))
    else:
        if isinstance(tuoi, bool):
            so = None
        elif isinstance(tuoi, int):
            so = tuoi
        elif isinstance(tuoi, str) and tuoi.strip().isdigit():
            so = int(tuoi.strip())
        else:
            so = None
        if so is None:
            loi.append(LoiTruong("tuoi", "khong_phai_so"))
        elif not 16 <= so <= 100:
            loi.append(LoiTruong("tuoi", "ngoai_khoang"))

    sdt = du_lieu.get("so_dien_thoai")
    if not _rong(sdt) and not _SDT.match(chuan_hoa_sdt(sdt)):
        loi.append(LoiTruong("so_dien_thoai", "sdt_sai"))

    return loi
