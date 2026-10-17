COT = ["ma", "ho_ten", "dtb", "xep_loai", "hang"]


def _o(v):
    if v is None:
        return ""
    s = str(v)
    if any(c in s for c in ',"\n\r'):
        s = '"' + s.replace('"', '""') + '"'
    return s


def xuat_csv(dong):
    """CSV từ kết quả bao_cao_lop: tiêu đề ma,ho_ten,dtb,xep_loai,hang; dtb 2 chữ số thập phân; None ⇒ ô trống."""
    ra = [",".join(COT)]
    for d in dong:
        dtb = "" if d.get("dtb") is None else f"{d['dtb']:.2f}"
        ra.append(",".join([_o(d.get("ma")), _o(d.get("ho_ten")), dtb, _o(d.get("xep_loai")), _o(d.get("hang"))]))
    return "".join(x + "\n" for x in ra)
