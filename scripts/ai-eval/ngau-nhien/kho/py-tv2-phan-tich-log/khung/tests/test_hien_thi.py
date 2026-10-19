from datetime import datetime, timezone

from phan_tich_log import DongLog, loc_trang, phan_tich, phan_tich_dong


def test_phan_tich_mot_dong_hop_le():
    d = phan_tich_dong("2026-10-18T08:15:30Z [INFO] api: đã khởi động")
    assert d == DongLog(datetime(2026, 10, 18, 8, 15, 30, tzinfo=timezone.utc), "INFO", "api", "đã khởi động")


def test_dong_sai_dinh_dang_tra_none():
    assert phan_tich_dong("không phải log") is None


def test_thong_ke_co_ban():
    bc = phan_tich([
        "2026-10-18T08:00:00Z [INFO] api: một",
        "2026-10-18T08:00:01Z [ERROR] db: hai",
        "hỏng",
        "2026-10-18T08:00:02Z [INFO] api: ba",
    ])
    assert len(bc.ban_ghi) == 3
    assert bc.theo_muc["INFO"] == 2
    assert bc.theo_nguon["db"] == 1
    assert bc.dong_hong == (3,)


def test_phan_trang_co_ban():
    bc = phan_tich([f"2026-10-18T08:00:{s:02d}Z [INFO] api: dòng {s}" for s in range(5)])
    trang2 = loc_trang(bc.ban_ghi, trang=2, co_trang=2)
    assert [d.thong_diep for d in trang2] == ["dòng 2", "dòng 3"]
