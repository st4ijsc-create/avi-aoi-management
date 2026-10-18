"""Đường đi rẻ nhất trên đồ thị có hướng, phá hoà tất định (chi phí ⇒ số cạnh ⇒ từ điển)."""
import heapq


def duong_re_nhat(canh, nguon, dich):
    ke = {}
    for u, v, w in canh:
        if w < 0:
            raise ValueError(f"trọng số âm: {u}->{v} = {w}")
        ke.setdefault(u, []).append((v, w))
    if nguon == dich:
        return (0, [nguon])
    # Khoá (chi phí, số cạnh, list đỉnh) tương thích với phép nối thêm một đỉnh ⇒ Dijkstra vẫn đúng.
    hang = [(0, 0, [nguon])]
    da_xong = set()
    while hang:
        chi_phi, so_canh, duong = heapq.heappop(hang)
        u = duong[-1]
        if u in da_xong:
            continue
        da_xong.add(u)
        if u == dich:
            return (chi_phi, duong)
        for v, w in ke.get(u, []):
            if v not in da_xong:
                heapq.heappush(hang, (chi_phi + w, so_canh + 1, duong + [v]))
    return None
