from .mo_hinh import LoiKho, SanPham


class DichVuKho:
    def __init__(self, repo):
        self.repo = repo

    def them_san_pham(self, ma: str, ten: str) -> SanPham:
        if self.repo.lay(ma) is not None:
            raise LoiKho(f"Sản phẩm {ma} đã tồn tại")
        sp = SanPham(ma=ma, ten=ten, so_luong=0)
        self.repo.luu(sp)
        return sp

    def _lay_bat_buoc(self, ma: str) -> SanPham:
        sp = self.repo.lay(ma)
        if sp is None:
            raise LoiKho(f"Không có sản phẩm {ma}")
        return sp

    def nhap(self, ma: str, so_luong: int) -> int:
        if so_luong <= 0:
            raise LoiKho("Số lượng nhập phải dương")
        sp = self._lay_bat_buoc(ma)
        sp.so_luong += so_luong
        self.repo.luu(sp)
        return sp.so_luong

    def xuat(self, ma: str, so_luong: int) -> int:
        if so_luong <= 0:
            raise LoiKho("Số lượng xuất phải dương")
        sp = self._lay_bat_buoc(ma)
        sp.so_luong -= so_luong
        if sp.so_luong < 0:
            raise LoiKho(f"Không đủ hàng {ma}: còn {sp.so_luong + so_luong}, cần {so_luong}")
        self.repo.luu(sp)
        return sp.so_luong

    def ton(self, ma: str) -> int:
        return self._lay_bat_buoc(ma).so_luong

    def ngung_kinh_doanh(self, ma: str) -> None:
        if not self.repo.xoa(ma):
            raise LoiKho(f"Không có sản phẩm {ma}")

    def bao_cao_ton_thap(self, nguong: int) -> list[str]:
        return [sp.ma for sp in self.repo.tat_ca() if sp.so_luong < nguong]
