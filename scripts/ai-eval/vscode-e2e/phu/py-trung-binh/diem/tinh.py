def trung_binh(bai):
    """Điểm trung bình của danh sách BaiKiemTra, làm tròn 2 chữ số."""
    if not bai:
        return 0
    return round(sum(b.diem for b in bai) / len(bai), 2)
