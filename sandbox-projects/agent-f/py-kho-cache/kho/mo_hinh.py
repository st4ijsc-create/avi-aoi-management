from dataclasses import dataclass


@dataclass
class SanPham:
    ma: str
    ten: str
    so_luong: int = 0


class LoiKho(Exception):
    """Lỗi nghiệp vụ kho (không đủ hàng, sản phẩm không tồn tại, ...)."""
