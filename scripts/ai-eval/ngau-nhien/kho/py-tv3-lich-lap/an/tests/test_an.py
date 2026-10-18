from datetime import datetime, timedelta, timezone

import pytest

from lich_lap import dinh_dang, phan_tich_iso, phan_tich_mui, sinh_lich


def test_ngay_31_ve_cuoi_thang_khong_troi():
    assert sinh_lich("2026-01-31T10:00:00+07:00", "thang", 5, "+07:00") == [
        "2026-01-31T10:00:00+07:00",
        "2026-02-28T10:00:00+07:00",
        "2026-03-31T10:00:00+07:00",
        "2026-04-30T10:00:00+07:00",
        "2026-05-31T10:00:00+07:00",
    ]


def test_nam_nhuan_va_qua_nam():
    assert sinh_lich("2027-11-30T00:00Z", "thang", 4, "Z") == [
        "2027-11-30T00:00:00Z",
        "2027-12-30T00:00:00Z",
        "2028-01-30T00:00:00Z",
        "2028-02-29T00:00:00Z",
    ]
    assert sinh_lich("2028-02-29T12:00:00Z", "thang", 2, "Z") == ["2028-02-29T12:00:00Z", "2028-03-29T12:00:00Z"]
    assert sinh_lich("2026-12-28T23:00:00Z", "tuan", 2, "+07:00") == [
        "2026-12-29T06:00:00+07:00",
        "2027-01-05T06:00:00+07:00",
    ]


def test_lap_theo_lich_tai_mui_cua_bat_dau():
    assert sinh_lich("2026-01-31T23:30:00-05:00", "thang", 3, "Z") == [
        "2026-02-01T04:30:00Z",
        "2026-03-01T04:30:00Z",
        "2026-04-01T04:30:00Z",
    ]


def test_mui_dich_le_phut_va_am_va_khong():
    assert sinh_lich("2026-06-01T00:00:00Z", "tuan", 1, "+05:45") == ["2026-06-01T05:45:00+05:45"]
    assert sinh_lich("2026-06-01T00:00:00Z", "tuan", 1, "-09:30") == ["2026-05-31T14:30:00-09:30"]
    assert sinh_lich("2026-06-01T00:00:00+02:00", "tuan", 1, "-00:00") == ["2026-05-31T22:00:00Z"]
    assert sinh_lich("2026-06-01T00:00:00+02:00", "tuan", 1, "+00:00") == ["2026-05-31T22:00:00Z"]


def test_phan_tich_iso_khong_giay_va_am():
    dt = phan_tich_iso("2026-03-05T07:05-03:30")
    assert dt.utcoffset() == timedelta(hours=-3, minutes=-30)
    assert (dt.hour, dt.minute, dt.second) == (7, 5, 0)
    assert dinh_dang(dt, "Z") == "2026-03-05T10:35:00Z"
    assert phan_tich_iso("2026-03-05T07:05:09Z").utcoffset() == timedelta(0)


def test_iso_hong_nem_value_error():
    for s in [
        "2026-10-18T08:30",
        "2026-10-18 08:30+07:00",
        "2026-10-18T08:30+0700",
        "2026-10-18T08:30:00.5Z",
        "2026-02-29T00:00Z",
        "2026-10-18T24:00Z",
        "2026-10-18t08:30Z",
        "2026-10-18T08:30z",
        "2026-10-18T08:30+15:00",
        "2026-10-18T08:30+07:60",
        "20261018T083000Z",
        "2026-10-18T8:30Z",
    ]:
        with pytest.raises(ValueError):
            phan_tich_iso(s)


def test_phan_tich_mui():
    assert phan_tich_mui("Z").utcoffset(None) == timedelta(0)
    assert phan_tich_mui("-00:00").utcoffset(None) == timedelta(0)
    assert phan_tich_mui("+14:00").utcoffset(None) == timedelta(hours=14)
    assert phan_tich_mui("-05:45").utcoffset(None) == timedelta(hours=-5, minutes=-45)
    for s in ["+7", "UTC", "+07", "07:00", "+07:00:00", "z", "+14:60", "-15:00", ""]:
        with pytest.raises(ValueError):
            phan_tich_mui(s)


def test_tham_so_sai():
    with pytest.raises(ValueError):
        sinh_lich("2026-01-01T00:00Z", "nam", 2, "Z")
    with pytest.raises(ValueError):
        sinh_lich("2026-01-01T00:00Z", "tuan", 0, "Z")
    with pytest.raises(ValueError):
        sinh_lich("2026-01-01T00:00Z", "tuan", 2, "+7")
    with pytest.raises(ValueError):
        sinh_lich("2026-01-01T00:00", "tuan", 2, "Z")


def test_dinh_dang_aware_va_naive():
    dt = datetime(2026, 1, 1, tzinfo=timezone(timedelta(hours=-5)))
    assert dinh_dang(dt, "+07:00") == "2026-01-01T12:00:00+07:00"
    assert dinh_dang(dt, "Z") == "2026-01-01T05:00:00Z"
    with pytest.raises(ValueError):
        dinh_dang(datetime(2026, 1, 1), "Z")
