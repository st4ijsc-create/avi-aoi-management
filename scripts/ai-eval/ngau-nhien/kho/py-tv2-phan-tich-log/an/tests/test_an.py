import dataclasses
from collections import Counter
from datetime import datetime, timezone

import pytest

from phan_tich_log import DongLog, loc_trang, nguon_nhieu_nhat, phan_tich, phan_tich_dong

NHAT_KY = [
    "2026-10-18T08:00:05Z [WARN] db: chậm 1200ms",
    "2026-10-18T08:00:00Z [INFO] api: khởi động",
    "",
    "2026-10-18T07:59:59Z [ERROR] api: lỗi: kết nối",
    "rác không đúng định dạng",
    "2026-10-18T08:01:00Z [DEBUG] cache.v2: miss key=a",
    "2026-10-18T08:01:00Z [info] api: chữ thường",
    "2026-02-30T08:00:00Z [INFO] api: ngày sai",
    "2026-10-18T08:02:00Z [ERROR] db: mất kết nối\r\n",
    "2026-10-18T08:03:00Z [INFO] Api: nguồn viết hoa",
    "2026-10-18T08:04:00Z [INFO] api:   ",
    "   \t",
    "2026-10-18T24:00:00Z [INFO] api: giờ 24",
]


def utc(*a):
    return datetime(*a, tzinfo=timezone.utc)


def thong_diep(ds):
    return [d.thong_diep for d in ds]


def test_bao_cao_day_du():
    bc = phan_tich(NHAT_KY)
    assert bc.ban_ghi == (
        DongLog(utc(2026, 10, 18, 8, 0, 5), "WARN", "db", "chậm 1200ms"),
        DongLog(utc(2026, 10, 18, 8, 0, 0), "INFO", "api", "khởi động"),
        DongLog(utc(2026, 10, 18, 7, 59, 59), "ERROR", "api", "lỗi: kết nối"),
        DongLog(utc(2026, 10, 18, 8, 1, 0), "DEBUG", "cache.v2", "miss key=a"),
        DongLog(utc(2026, 10, 18, 8, 2, 0), "ERROR", "db", "mất kết nối"),
    )
    assert bc.dong_hong == (5, 7, 8, 10, 11, 13)
    assert bc.theo_muc == Counter({"ERROR": 2, "WARN": 1, "INFO": 1, "DEBUG": 1})
    assert bc.theo_nguon == Counter({"db": 2, "api": 2, "cache.v2": 1})


def test_dong_hop_le_bien():
    assert phan_tich_dong("2026-10-18T08:00:00Z [ERROR] a.b_c-d9:\tx  ") == DongLog(
        utc(2026, 10, 18, 8, 0, 0), "ERROR", "a.b_c-d9", "x")
    d = phan_tich_dong("2028-02-29T23:59:59Z [DEBUG] q:  một: hai \n")
    assert d.thoi_diem == utc(2028, 2, 29, 23, 59, 59)
    assert d.thoi_diem.utcoffset().total_seconds() == 0
    assert d.thong_diep == "một: hai"


def test_dong_hong_tra_none():
    for dong in [
        "2026-10-18T08:00:00Z [TRACE] api: mức lạ",
        "2026-10-18T08:00:00 [INFO] api: thiếu Z",
        "2026-10-18T08:00:00+07:00 [INFO] api: có offset",
        "2026-10-18 08:00:00Z [INFO] api: cách thay T",
        "2026-10-18T08:00:00Z  [INFO] api: hai dấu cách",
        " 2026-10-18T08:00:00Z [INFO] api: thụt đầu dòng",
        "2026-10-18T08:00:00Z [INFO] api:không cách",
        "2026-10-18T08:00:00Z [INFO] : thiếu nguồn",
        "2026-10-18T08:00:00Z [INFO] dịch_vụ: nguồn có dấu",
        "2026-10-18T08:60:00Z [INFO] api: phút 60",
        "2026-1-18T08:00:00Z [INFO] api: tháng một chữ số",
    ]:
        assert phan_tich_dong(dong) is None, dong


def test_dataclass_frozen_order_hash():
    assert [f.name for f in dataclasses.fields(DongLog)] == ["thoi_diem", "muc", "nguon", "thong_diep"]
    a = DongLog(utc(2026, 1, 1, 0, 0, 1), "INFO", "x", "a")
    b = DongLog(utc(2026, 1, 1, 0, 0, 0), "WARN", "x", "b")
    c = DongLog(utc(2026, 1, 1, 0, 0, 1), "ERROR", "x", "c")
    with pytest.raises(dataclasses.FrozenInstanceError):
        a.muc = "ERROR"
    assert sorted([a, b, c]) == [b, c, a]
    assert len({a, DongLog(utc(2026, 1, 1, 0, 0, 1), "INFO", "x", "a")}) == 1


def test_loc_muc_toi_thieu_va_nguon():
    bg = phan_tich(NHAT_KY).ban_ghi
    assert thong_diep(loc_trang(bg, muc_toi_thieu="WARN")) == ["lỗi: kết nối", "chậm 1200ms", "mất kết nối"]
    assert thong_diep(loc_trang(bg, nguon="api")) == ["lỗi: kết nối", "khởi động"]
    assert thong_diep(loc_trang(bg, muc_toi_thieu="ERROR", nguon="db")) == ["mất kết nối"]
    assert loc_trang(bg, nguon="khong-co") == []


def test_sap_xep_on_dinh_ca_khi_giam():
    bg = phan_tich(NHAT_KY).ban_ghi
    assert thong_diep(loc_trang(bg, sap_theo="muc", giam=True)) == [
        "lỗi: kết nối", "mất kết nối", "chậm 1200ms", "khởi động", "miss key=a"]
    assert thong_diep(loc_trang(bg, sap_theo="muc")) == [
        "miss key=a", "khởi động", "chậm 1200ms", "lỗi: kết nối", "mất kết nối"]
    assert thong_diep(loc_trang(bg, sap_theo="nguon")) == [
        "khởi động", "lỗi: kết nối", "miss key=a", "chậm 1200ms", "mất kết nối"]
    cung_luc = phan_tich([
        "2026-10-18T09:00:00Z [INFO] s: A",
        "2026-10-18T08:00:00Z [INFO] s: truoc",
        "2026-10-18T09:00:00Z [INFO] s: B",
        "2026-10-18T09:00:00Z [INFO] s: C",
    ]).ban_ghi
    assert thong_diep(loc_trang(cung_luc, giam=True)) == ["A", "B", "C", "truoc"]


def test_phan_trang_bien_va_tham_so_sai():
    bg = phan_tich(NHAT_KY).ban_ghi
    assert thong_diep(loc_trang(bg, trang=3, co_trang=2)) == ["mất kết nối"]
    assert loc_trang(bg, trang=4, co_trang=2) == []
    assert thong_diep(loc_trang(bg, giam=True, trang=1, co_trang=2)) == ["mất kết nối", "miss key=a"]
    for kw in [{"trang": 0}, {"co_trang": 0}, {"sap_theo": "thong_diep"}, {"muc_toi_thieu": "TRACE"}]:
        with pytest.raises(ValueError):
            loc_trang(bg, **kw)


def test_nguon_nhieu_nhat_hoa_xep_theo_ten():
    bc = phan_tich(NHAT_KY)
    assert nguon_nhieu_nhat(bc, 2) == [("api", 2), ("db", 2)]
    assert nguon_nhieu_nhat(bc, 10) == [("api", 2), ("db", 2), ("cache.v2", 1)]
    assert nguon_nhieu_nhat(bc, 0) == []
