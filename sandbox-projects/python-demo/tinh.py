def ty_le_loi(tong: int, loi: int) -> float:
    if tong <= 0:
        return 0.0
    return round(loi / tong * 100, 2)
