"""Lịch lặp hằng tuần/hằng tháng trên múi giờ LỆCH CỐ ĐỊNH (không cần tzdata)."""
import calendar
import re
from datetime import datetime, timedelta, timezone

_MUI = re.compile(r"Z|([+-])([0-9]{2}):([0-9]{2})")
_ISO = re.compile(
    r"([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?(Z|[+-][0-9]{2}:[0-9]{2})"
)


def phan_tich_mui(s):
    m = _MUI.fullmatch(s)
    if not m:
        raise ValueError(f"múi lạ: {s!r}")
    if s == "Z":
        return timezone.utc
    gio, phut = int(m.group(2)), int(m.group(3))
    if gio > 14 or phut > 59:
        raise ValueError(f"độ lệch ngoài phạm vi: {s!r}")
    lech = timedelta(hours=gio, minutes=phut)
    return timezone(-lech if m.group(1) == "-" else lech)


def phan_tich_iso(s):
    m = _ISO.fullmatch(s)
    if not m:
        raise ValueError(f"không phải ISO 8601 có độ lệch: {s!r}")
    nam, thang, ngay, gio, phut = (int(m.group(i)) for i in range(1, 6))
    giay = int(m.group(6) or 0)
    return datetime(nam, thang, ngay, gio, phut, giay, tzinfo=phan_tich_mui(m.group(7)))


def dinh_dang(dt, mui):
    if dt.tzinfo is None or dt.utcoffset() is None:
        raise ValueError("datetime không có múi giờ")
    dich = phan_tich_mui(mui)
    t = dt.astimezone(dich)
    phut = int(dich.utcoffset(None).total_seconds()) // 60
    if phut == 0:
        hau_to = "Z"
    else:
        dau = "-" if phut < 0 else "+"
        g, p = divmod(abs(phut), 60)
        hau_to = f"{dau}{g:02d}:{p:02d}"
    return t.strftime("%Y-%m-%dT%H:%M:%S") + hau_to


def _cong_thang(dt, so_thang, ngay_goc):
    tong = dt.month - 1 + so_thang
    nam, thang = dt.year + tong // 12, tong % 12 + 1
    ngay = min(ngay_goc, calendar.monthrange(nam, thang)[1])
    return dt.replace(year=nam, month=thang, day=ngay)


def sinh_lich(bat_dau, kieu, so_lan, mui_dich):
    if kieu not in ("tuan", "thang"):
        raise ValueError(f"kiểu lặp lạ: {kieu!r}")
    if so_lan < 1:
        raise ValueError("so_lan phải >= 1")
    phan_tich_mui(mui_dich)
    bd = phan_tich_iso(bat_dau)
    ra = []
    hien = bd
    for _ in range(so_lan):
        ra.append(dinh_dang(hien, mui_dich))
        if kieu == "tuan":
            hien = hien + timedelta(days=7)
        else:
            # luôn neo vào NGÀY GỐC của bat_dau (31 ⇒ 28/29 ⇒ 31), không trôi theo lần trước
            hien = _cong_thang(hien, 1, bd.day)
    return ra
