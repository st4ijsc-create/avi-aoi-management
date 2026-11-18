"""Đọc tệp tồn kho CSV."""
import csv

from chuan_hoa import chuan_hoa_ma

COT = ("ma", "ten", "so_luong")


def doc_ton(duong):
    """{mã đã chuẩn hoá: tổng số lượng}. Mã trùng trong tệp thì cộng dồn."""
    with open(duong, encoding="utf-8", newline="") as f:
        doc = csv.DictReader(f)
        for cot in COT:
            if cot not in (doc.fieldnames or []):
                raise ValueError(f"thiếu cột: {cot}")
        ton = {}
        for so_dong, hang in enumerate(doc, start=2):
            try:
                sl = int(hang["so_luong"].strip())
            except (ValueError, AttributeError):
                raise ValueError(f"dòng {so_dong}: so_luong không phải số nguyên") from None
            ma = chuan_hoa_ma(hang["ma"])
            ton[ma] = ton.get(ma, 0) + sl
        return ton
