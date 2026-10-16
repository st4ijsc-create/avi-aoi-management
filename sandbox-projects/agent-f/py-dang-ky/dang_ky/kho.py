from .mo_hinh import NguoiDangKy


class KhoBoNho:
    def __init__(self):
        self._ds: dict[str, NguoiDangKy] = {}

    def them(self, nguoi: NguoiDangKy) -> str:
        ma = f"DK-{len(self._ds) + 1:04d}"
        self._ds[ma] = nguoi
        return ma

    def lay(self, ma: str) -> NguoiDangKy | None:
        return self._ds.get(ma)

    def tim_theo_email(self, email: str) -> NguoiDangKy | None:
        email = email.lower()
        return next((n for n in self._ds.values() if n.email.lower() == email), None)

    def danh_sach(self) -> list[tuple[str, NguoiDangKy]]:
        return list(self._ds.items())
