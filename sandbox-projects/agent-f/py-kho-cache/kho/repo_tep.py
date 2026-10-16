import json
import os
from dataclasses import asdict

from .mo_hinh import SanPham


class RepoTep:
    """Lưu sản phẩm trong một tệp JSON {ma: {...}}. Mỗi thao tác đọc lại tệp từ đĩa."""

    def __init__(self, duong: str):
        self.duong = duong
        self.so_lan_doc = 0

    def _doc(self) -> dict:
        self.so_lan_doc += 1
        if not os.path.exists(self.duong):
            return {}
        with open(self.duong, encoding="utf-8") as f:
            return json.load(f)

    def _ghi(self, du_lieu: dict) -> None:
        with open(self.duong, "w", encoding="utf-8") as f:
            json.dump(du_lieu, f, ensure_ascii=False, indent=2)

    def lay(self, ma: str) -> SanPham | None:
        ban_ghi = self._doc().get(ma)
        return SanPham(**ban_ghi) if ban_ghi else None

    def luu(self, sp: SanPham) -> None:
        du_lieu = self._doc()
        du_lieu[sp.ma] = asdict(sp)
        self._ghi(du_lieu)

    def xoa(self, ma: str) -> bool:
        du_lieu = self._doc()
        if ma not in du_lieu:
            return False
        del du_lieu[ma]
        self._ghi(du_lieu)
        return True

    def tat_ca(self) -> list[SanPham]:
        return [SanPham(**v) for _, v in sorted(self._doc().items())]
