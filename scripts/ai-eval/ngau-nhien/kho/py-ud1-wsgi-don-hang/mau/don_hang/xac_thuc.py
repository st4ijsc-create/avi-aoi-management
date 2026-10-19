TRANG_THAI = ("moi", "da_xac_nhan", "da_huy")

# trạng thái hiện tại ⇒ các trạng thái được phép chuyển sang
_CHUYEN = {
    "moi": ("da_xac_nhan", "da_huy"),
    "da_xac_nhan": ("da_huy",),
    "da_huy": (),
}


def _la_so_nguyen(x):
    return isinstance(x, int) and not isinstance(x, bool)


def _chuoi_co_noi_dung(x):
    return isinstance(x, str) and x.strip() != ""


def kiem_tra_tao(du_lieu):
    """Danh sách lỗi [{"truong": ..., "loi": ...}] của thân POST (dict); rỗng = hợp lệ."""
    loi = []

    def them(truong, ma_loi):
        loi.append({"truong": truong, "loi": ma_loi})

    if "khach" not in du_lieu:
        them("khach", "bat_buoc")
    elif not _chuoi_co_noi_dung(du_lieu["khach"]):
        them("khach", "khong_hop_le")

    if "dong" not in du_lieu:
        them("dong", "bat_buoc")
    elif not isinstance(du_lieu["dong"], list) or not du_lieu["dong"]:
        them("dong", "khong_hop_le")
    else:
        for i, d in enumerate(du_lieu["dong"]):
            goc = f"dong[{i}]"
            if not isinstance(d, dict):
                them(goc, "khong_hop_le")
                continue
            for truong, hop_le in (
                ("ma", _chuoi_co_noi_dung),
                ("so_luong", lambda x: _la_so_nguyen(x) and x >= 1),
                ("don_gia", lambda x: _la_so_nguyen(x) and x >= 0),
            ):
                if truong not in d:
                    them(f"{goc}.{truong}", "bat_buoc")
                elif not hop_le(d[truong]):
                    them(f"{goc}.{truong}", "khong_hop_le")
    return loi


def kiem_tra_doi_trang_thai(hien_tai, du_lieu):
    """Danh sách lỗi của thân PATCH (dict) khi đơn đang ở trạng thái `hien_tai`; rỗng = hợp lệ."""
    if "trang_thai" not in du_lieu:
        return [{"truong": "trang_thai", "loi": "bat_buoc"}]
    moi = du_lieu["trang_thai"]
    if not isinstance(moi, str) or moi not in TRANG_THAI:
        return [{"truong": "trang_thai", "loi": "khong_hop_le"}]
    if moi not in _CHUYEN[hien_tai]:
        return [{"truong": "trang_thai", "loi": "chuyen_khong_hop_le"}]
    return []
