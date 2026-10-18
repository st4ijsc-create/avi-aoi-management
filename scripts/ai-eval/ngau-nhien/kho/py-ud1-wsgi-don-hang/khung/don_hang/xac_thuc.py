TRANG_THAI = ("moi", "da_xac_nhan", "da_huy")


def kiem_tra_tao(du_lieu):
    """Danh sách lỗi [{"truong": ..., "loi": ...}] của thân POST (dict); rỗng = hợp lệ."""
    raise NotImplementedError


def kiem_tra_doi_trang_thai(hien_tai, du_lieu):
    """Danh sách lỗi của thân PATCH (dict) khi đơn đang ở trạng thái `hien_tai`; rỗng = hợp lệ."""
    raise NotImplementedError
