def xep_hang(dtb_theo_ma):
    """Hạng theo điểm trung bình giảm dần, đồng điểm đồng hạng, hạng kế tiếp nhảy (1, 2, 2, 4).

    Học sinh có dtb None không được xếp hạng (giá trị None). Dict rỗng ⇒ {}.
    """
    co_diem = sorted((d for d in dtb_theo_ma.values() if d is not None), reverse=True)
    hang_cua_diem = {}
    for i, d in enumerate(co_diem):
        hang_cua_diem.setdefault(d, i + 1)
    return {ma: (None if d is None else hang_cua_diem[d]) for ma, d in dtb_theo_ma.items()}
