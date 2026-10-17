from diem.cu import dinh_dang_diem
from diem.tinh import trung_binh
from diem.xep_loai import xep_loai


def bao_cao_lop(hoc_sinh):
    """Mỗi học sinh một dòng {ma, ho_ten, dtb, xep_loai, dtb_hien_thi, hang}, giữ thứ tự đầu vào.

    `hang`: theo dtb giảm dần, đồng điểm đồng hạng (1, 2, 2, 4); dtb None ⇒ hang None.
    """
    ra = []
    for hs in hoc_sinh:
        dtb = trung_binh(hs.bai)
        ra.append(
            {
                "ma": hs.ma,
                "ho_ten": hs.ho_ten,
                "dtb": dtb,
                "xep_loai": xep_loai(dtb),
                "dtb_hien_thi": dinh_dang_diem(dtb),
            }
        )
    co_diem = sorted((d["dtb"] for d in ra if d["dtb"] is not None), reverse=True)
    hang_cua_diem = {}
    for i, d in enumerate(co_diem):
        hang_cua_diem.setdefault(d, i + 1)
    for d in ra:
        d["hang"] = None if d["dtb"] is None else hang_cua_diem[d["dtb"]]
    return ra
