import csv
import re
from decimal import Decimal

_SO = re.compile(r"-?[0-9]+(\.[0-9]+)?")


class LoiDuLieu(Exception):
    """Lỗi làm dừng chương trình (tệp không mở được, tệp rỗng, thiếu cột)."""


def doc_ban_ghi(duong, cot_nhom, cot_so):
    """Đọc tệp CSV ⇒ (list[(tên nhóm, Decimal)], list[chuỗi cảnh báo]); lỗi nghiêm trọng ⇒ LoiDuLieu."""
    try:
        # utf-8-sig: bỏ BOM đầu tệp (Excel hay ghi) — nếu không, tên cột đầu dính "﻿"
        with open(duong, encoding="utf-8-sig", newline="") as f:
            ban_ghi_tho = list(csv.reader(f))
    except OSError:
        raise LoiDuLieu(f"khong mo duoc tep: {duong}") from None
    if not ban_ghi_tho:
        raise LoiDuLieu("tep rong")
    tieu_de = [o.strip() for o in ban_ghi_tho[0]]
    vi_tri = []
    for ten in (cot_nhom, cot_so):
        if ten not in tieu_de:
            raise LoiDuLieu(f"khong co cot '{ten}'")
        vi_tri.append(tieu_de.index(ten))
    i_nhom, i_so = vi_tri

    ket_qua, canh_bao = [], []
    for so, hang in enumerate(ban_ghi_tho[1:], start=2):
        if all(not o.strip() for o in hang):
            continue
        if len(hang) <= max(i_nhom, i_so):
            canh_bao.append(f"canh bao: ban ghi {so}: thieu cot")
            continue
        o_so = hang[i_so].strip()
        if not _SO.fullmatch(o_so):
            canh_bao.append(f"canh bao: ban ghi {so}: gia tri '{o_so}' khong phai so")
            continue
        ket_qua.append((hang[i_nhom].strip(), Decimal(o_so)))
    return ket_qua, canh_bao
