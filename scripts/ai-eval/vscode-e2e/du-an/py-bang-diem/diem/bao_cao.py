from diem.cu import dinh_dang_diem
from diem.tinh import trung_binh
from diem.xep_loai import xep_loai


def bao_cao_lop(hoc_sinh):
    """Mỗi học sinh một dòng {ma, ho_ten, dtb, xep_loai, dtb_hien_thi}, giữ thứ tự đầu vào."""
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
    return ra
