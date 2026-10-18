from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class KetQua:
    """Kết quả của MỘT tác vụ. `trang_thai` là "ok", "loi" hoặc "het_gio"."""

    chi_so: int
    trang_thai: str
    gia_tri: Any = None
    loi: BaseException | None = None
