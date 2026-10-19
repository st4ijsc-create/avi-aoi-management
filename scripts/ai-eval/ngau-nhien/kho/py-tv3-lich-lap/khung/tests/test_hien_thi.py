from datetime import datetime, timedelta, timezone

from lich_lap import phan_tich_iso, sinh_lich


def test_phan_tich_iso_co_do_lech():
    dt = phan_tich_iso("2026-10-18T08:30:15+07:00")
    assert dt == datetime(2026, 10, 18, 1, 30, 15, tzinfo=timezone.utc)
    assert dt.utcoffset() == timedelta(hours=7)
    assert (dt.hour, dt.minute) == (8, 30)


def test_hang_tuan_cung_mui():
    assert sinh_lich("2026-10-18T08:30:00+07:00", "tuan", 3, "+07:00") == [
        "2026-10-18T08:30:00+07:00",
        "2026-10-25T08:30:00+07:00",
        "2026-11-01T08:30:00+07:00",
    ]


def test_hang_thang_doi_sang_utc():
    assert sinh_lich("2026-01-15T09:00:00+07:00", "thang", 3, "Z") == [
        "2026-01-15T02:00:00Z",
        "2026-02-15T02:00:00Z",
        "2026-03-15T02:00:00Z",
    ]
