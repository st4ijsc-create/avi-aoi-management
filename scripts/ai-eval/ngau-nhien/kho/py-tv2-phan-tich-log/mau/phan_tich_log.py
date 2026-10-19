"""Phân tích log định dạng cố định: re + dataclasses (frozen, order) + collections."""
import re
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone

MUC_DO = ("DEBUG", "INFO", "WARN", "ERROR")
_BAC = {m: i for i, m in enumerate(MUC_DO)}

_MAU_DONG = re.compile(
    r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})Z \[(DEBUG|INFO|WARN|ERROR)\] ([a-z0-9_.-]+):[ \t]+(.*)"
)


@dataclass(frozen=True, order=True)
class DongLog:
    thoi_diem: datetime
    muc: str
    nguon: str
    thong_diep: str


@dataclass(frozen=True)
class BaoCao:
    ban_ghi: tuple
    theo_muc: Counter
    theo_nguon: Counter
    dong_hong: tuple


def phan_tich_dong(dong):
    dong = dong.rstrip("\r\n")
    m = _MAU_DONG.fullmatch(dong)
    if not m:
        return None
    try:
        thoi_diem = datetime.strptime(m.group(1), "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    thong_diep = m.group(4).strip()
    if not thong_diep:
        return None
    return DongLog(thoi_diem, m.group(2), m.group(3), thong_diep)


def phan_tich(cac_dong):
    ban_ghi, hong = [], []
    for so, dong in enumerate(cac_dong, start=1):
        if not dong.strip():
            continue
        d = phan_tich_dong(dong)
        if d is None:
            hong.append(so)
        else:
            ban_ghi.append(d)
    return BaoCao(
        ban_ghi=tuple(ban_ghi),
        theo_muc=Counter(d.muc for d in ban_ghi),
        theo_nguon=Counter(d.nguon for d in ban_ghi),
        dong_hong=tuple(hong),
    )


_KHOA_SAP = {
    "thoi_diem": lambda d: d.thoi_diem,
    "muc": lambda d: _BAC[d.muc],
    "nguon": lambda d: d.nguon,
}


def loc_trang(ban_ghi, *, muc_toi_thieu=None, nguon=None, sap_theo="thoi_diem", giam=False, trang=1, co_trang=10):
    if muc_toi_thieu is not None and muc_toi_thieu not in _BAC:
        raise ValueError(f"mức lạ: {muc_toi_thieu!r}")
    if sap_theo not in _KHOA_SAP:
        raise ValueError(f"không sắp được theo {sap_theo!r}")
    if trang < 1 or co_trang < 1:
        raise ValueError("trang và co_trang phải >= 1")
    ds = [
        d for d in ban_ghi
        if (muc_toi_thieu is None or _BAC[d.muc] >= _BAC[muc_toi_thieu]) and (nguon is None or d.nguon == nguon)
    ]
    # sorted ổn định, kể cả reverse=True: phần tử bằng khoá giữ thứ tự đầu vào
    ds = sorted(ds, key=_KHOA_SAP[sap_theo], reverse=giam)
    dau = (trang - 1) * co_trang
    return ds[dau:dau + co_trang]


def nguon_nhieu_nhat(bao_cao, n):
    if n <= 0:
        return []
    return sorted(bao_cao.theo_nguon.items(), key=lambda p: (-p[1], p[0]))[:n]
