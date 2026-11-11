"""Định dạng báo cáo đối soát."""


def _co_dau(n):
    return f"+{n}" if n > 0 else str(n)


def dinh_dang(ds):
    dong = ["MA|SO_SACH|KIEM_KE|CHENH"]
    dong += [f"{c.ma}|{c.so_sach}|{c.kiem_ke}|{_co_dau(c.chenh)}" for c in ds]
    dong.append(f"TONG|{len(ds)}|{_co_dau(sum(c.chenh for c in ds))}")
    return "\n".join(dong) + "\n"
