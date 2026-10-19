MUC_DO = ("DEBUG", "INFO", "WARN", "ERROR")


class DongLog:
    def __init__(self, *args, **kwargs):
        raise NotImplementedError


class BaoCao:
    def __init__(self, *args, **kwargs):
        raise NotImplementedError


def phan_tich_dong(dong):
    raise NotImplementedError


def phan_tich(cac_dong):
    raise NotImplementedError


def loc_trang(ban_ghi, *, muc_toi_thieu=None, nguon=None, sap_theo="thoi_diem", giam=False, trang=1, co_trang=10):
    raise NotImplementedError


def nguon_nhieu_nhat(bao_cao, n):
    raise NotImplementedError
