"""So khớp sổ sách với kiểm kê."""
from dataclasses import dataclass


@dataclass(frozen=True)
class ChenhLech:
    ma: str
    so_sach: int
    kiem_ke: int

    @property
    def chenh(self):
        return self.kiem_ke - self.so_sach


def so_khop(so_sach, kiem_ke):
    """Các mã có chênh lệch khác 0, xếp theo mã. Mã chỉ có ở một phía thì phía kia tính 0."""
    ds = []
    for ma in sorted(set(so_sach) | set(kiem_ke)):
        c = ChenhLech(ma, so_sach.get(ma, 0), kiem_ke.get(ma, 0))
        if c.chenh != 0:
            ds.append(c)
    return ds
