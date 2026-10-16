import copy
import time


class RepoCoCache:
    """Bọc một repo (lay/luu/xoa/tat_ca) bằng cache có TTL cho `lay`; ghi xuyên (write-through)."""

    def __init__(self, nguon, ttl_giay: float = 30.0, dong_ho=time.monotonic):
        self.nguon = nguon
        self.ttl_giay = ttl_giay
        self.dong_ho = dong_ho
        self._cache: dict = {}  # ma -> (thoi_diem_nap, gia_tri hoặc None)
        self._trung = 0
        self._truot = 0

    def lay(self, ma):
        muc = self._cache.get(ma)
        if muc is not None and self.dong_ho() - muc[0] < self.ttl_giay:
            self._trung += 1
            return copy.deepcopy(muc[1])
        self._truot += 1
        gia_tri = self.nguon.lay(ma)
        self._cache[ma] = (self.dong_ho(), copy.deepcopy(gia_tri))
        return gia_tri

    def luu(self, sp) -> None:
        self.nguon.luu(sp)
        self._cache[sp.ma] = (self.dong_ho(), copy.deepcopy(sp))

    def xoa(self, ma) -> bool:
        ket_qua = self.nguon.xoa(ma)
        self._cache.pop(ma, None)
        return ket_qua

    def tat_ca(self):
        return self.nguon.tat_ca()

    def thong_ke(self) -> dict:
        return {"trung": self._trung, "truot": self._truot}

    def xoa_cache(self) -> None:
        self._cache.clear()
