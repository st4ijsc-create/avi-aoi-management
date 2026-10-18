import argparse
import json
import sys
from decimal import ROUND_HALF_UP, Decimal

from .doc import LoiDuLieu, doc_ban_ghi
from .tong_hop import tong_hop


def tao_parser():
    p = argparse.ArgumentParser(prog="bao_cao_csv", description="Tổng hợp một cột số của tệp CSV theo nhóm.")
    p.add_argument("tep", help="đường tệp CSV")
    p.add_argument("--nhom", required=True, help="tên cột dùng để nhóm")
    p.add_argument("--cot-so", required=True, help="tên cột số cần tổng hợp")
    p.add_argument("--dinh-dang", choices=["bang", "json"], default="bang")
    p.add_argument("--sap-xep", choices=["ten", "tong"], default="ten")
    return p


def _hai_so_le(x):
    return str(Decimal(x).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _bang(ten_cot_nhom, cac_nhom):
    tieu_de = [ten_cot_nhom, "so_dong", "tong", "trung_binh"]
    hang = [[n["nhom"], str(n["so_dong"]), _hai_so_le(n["tong"]), _hai_so_le(n["trung_binh"])] for n in cac_nhom]
    rong = [max([len(tieu_de[c])] + [len(h[c]) for h in hang]) for c in range(4)]

    def dong(o):
        return " | ".join(o[c].ljust(rong[c]) if c == 0 else o[c].rjust(rong[c]) for c in range(4))

    ra = [dong(tieu_de), "-+-".join("-" * w for w in rong)] + [dong(h) for h in hang]
    return "".join(l + "\n" for l in ra)


def _json(cac_nhom):
    du_lieu = [{"nhom": n["nhom"], "so_dong": n["so_dong"], "tong": _hai_so_le(n["tong"]),
                "trung_binh": _hai_so_le(n["trung_binh"])} for n in cac_nhom]
    return json.dumps(du_lieu, ensure_ascii=False, indent=2) + "\n"


def main(argv):
    try:
        ts = tao_parser().parse_args(argv)
    except SystemExit as e:  # argparse đã in thông báo ra stderr
        return e.code if isinstance(e.code, int) else 2
    try:
        ban_ghi, canh_bao = doc_ban_ghi(ts.tep, ts.nhom, ts.cot_so)
    except LoiDuLieu as e:
        sys.stderr.write(f"loi: {e}\n")
        return 1
    for c in canh_bao:
        sys.stderr.write(c + "\n")
    cac_nhom = tong_hop(ban_ghi, ts.sap_xep)
    sys.stdout.write(_bang(ts.nhom, cac_nhom) if ts.dinh_dang == "bang" else _json(cac_nhom))
    return 0
