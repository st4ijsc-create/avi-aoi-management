class LoiDuLieu(Exception):
    """Lỗi làm dừng chương trình (tệp không mở được, tệp rỗng, thiếu cột)."""


def doc_ban_ghi(duong, cot_nhom, cot_so):
    """Đọc tệp CSV ⇒ (list[(tên nhóm, Decimal)], list[chuỗi cảnh báo]); lỗi nghiêm trọng ⇒ LoiDuLieu."""
    raise NotImplementedError
