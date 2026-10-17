def xep_loai(dtb):
    """Giỏi ≥ 8 · Khá ≥ 6,5 · Trung bình ≥ 5 · Yếu; None ⇒ None."""
    if dtb is None:
        return None
    if dtb >= 8:
        return "Giỏi"
    if dtb >= 6.5:
        return "Khá"
    if dtb >= 5:
        return "Trung bình"
    return "Yếu"
