"""Trie gợi ý từ theo tiền tố: tần suất cộng dồn, xếp hạng (tần suất giảm, từ tăng), không phân biệt hoa thường."""
import heapq


class _Nut:
    __slots__ = ("con", "tan_suat")

    def __init__(self):
        self.con = {}
        self.tan_suat = 0  # 0 ⇒ nút này không kết thúc một từ


class TrieGoiY:
    def __init__(self):
        self._goc = _Nut()
        self._so_tu = 0

    def _tim(self, chuoi):
        nut = self._goc
        for ky_tu in chuoi:
            nut = nut.con.get(ky_tu)
            if nut is None:
                return None
        return nut

    def them(self, tu, tan_suat=1):
        tu = tu.lower()
        if not tu:
            raise ValueError("từ rỗng")
        if tan_suat < 1:
            raise ValueError("tần suất phải >= 1")
        nut = self._goc
        for ky_tu in tu:
            nut = nut.con.setdefault(ky_tu, _Nut())
        if nut.tan_suat == 0:
            self._so_tu += 1
        nut.tan_suat += tan_suat

    def tan_suat(self, tu):
        nut = self._tim(tu.lower())
        return 0 if nut is None else nut.tan_suat

    def xoa(self, tu):
        tu = tu.lower()
        if not tu:
            return False
        duong = [self._goc]
        for ky_tu in tu:
            nut = duong[-1].con.get(ky_tu)
            if nut is None:
                return False
            duong.append(nut)
        if duong[-1].tan_suat == 0:
            return False
        duong[-1].tan_suat = 0
        self._so_tu -= 1
        # tỉa các nút không còn dùng, từ dưới lên
        for i in range(len(tu), 0, -1):
            nut = duong[i]
            if nut.tan_suat or nut.con:
                break
            del duong[i - 1].con[tu[i - 1]]
        return True

    def goi_y(self, tien_to, k):
        if k <= 0:
            return []
        tien_to = tien_to.lower()
        dau = self._tim(tien_to)
        if dau is None:
            return []
        ung_vien = []
        ngan_xep = [(dau, tien_to)]
        while ngan_xep:
            nut, chuoi = ngan_xep.pop()
            if nut.tan_suat:
                ung_vien.append((chuoi, nut.tan_suat))
            for ky_tu, con in nut.con.items():
                ngan_xep.append((con, chuoi + ky_tu))
        return heapq.nsmallest(k, ung_vien, key=lambda p: (-p[1], p[0]))

    def __len__(self):
        return self._so_tu
