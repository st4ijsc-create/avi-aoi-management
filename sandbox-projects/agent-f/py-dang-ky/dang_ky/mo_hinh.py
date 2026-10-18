from dataclasses import dataclass


@dataclass
class NguoiDangKy:
    ho_ten: str
    email: str
    tuoi: int
    so_dien_thoai: str | None = None
