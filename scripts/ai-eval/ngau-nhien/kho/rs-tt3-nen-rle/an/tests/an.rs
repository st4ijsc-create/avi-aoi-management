use bai::{giai_nen, nen, LoiRle};

fn ok(s: &str) -> Result<String, LoiRle> {
    Ok(s.to_string())
}

#[test]
fn chuoi_rong() {
    assert_eq!(nen(""), "");
    assert_eq!(giai_nen(""), ok(""));
}

#[test]
fn luot_unicode() {
    assert_eq!(nen("ééé🦀🦀x"), "3é2🦀x");
    assert_eq!(giai_nen("3é2🦀x"), ok("ééé🦀🦀x"));
    assert_eq!(nen("đường"), "đường");
}

#[test]
fn chu_so_khong_ascii_khong_thoat() {
    assert_eq!(nen("٣٣٣"), "3٣");
    assert_eq!(nen("²²"), "2²");
    assert_eq!(nen("½"), "½");
    assert_eq!(giai_nen("2٣"), ok("٣٣"));
    assert_eq!(giai_nen("\\٣"), Err(LoiRle::ThoatSai { vi_tri: 0 }));
}

#[test]
fn dau_gach_nguoc() {
    assert_eq!(nen("\\"), "\\\\");
    assert_eq!(nen("\\\\\\"), "3\\\\");
    assert_eq!(giai_nen("2\\\\"), ok("\\\\"));
    assert_eq!(giai_nen("3\\0"), ok("000"));
    // `\1` là ký tự '1', sau đó "2a" là hai chữ 'a'
    assert_eq!(giai_nen("\\12a"), ok("1aa"));
}

#[test]
fn so_dem_nhieu_chu_so() {
    assert_eq!(nen(&"z".repeat(12)), "12z");
    assert_eq!(nen(&"1".repeat(10)), "10\\1");
    assert_eq!(giai_nen("10\\1"), ok("1111111111"));
    assert_eq!(giai_nen("999999é"), Ok("é".repeat(999_999)));
}

#[test]
fn luot_dai_bi_chia() {
    assert_eq!(nen(&"b".repeat(1_000_000)), "1000000b");
    assert_eq!(nen(&"b".repeat(1_000_001)), "1000000bb");
    let dai = "a".repeat(2_000_001);
    assert_eq!(nen(&dai), "1000000a1000000aa");
    assert_eq!(giai_nen("1000000a1000000aa"), Ok(dai));
}

#[test]
fn so_dem_khong_hop_le() {
    assert_eq!(giai_nen("0a"), Err(LoiRle::SoKhongHopLe { vi_tri: 0 }));
    assert_eq!(giai_nen("0"), Err(LoiRle::SoKhongHopLe { vi_tri: 0 }));
    assert_eq!(giai_nen("x01a"), Err(LoiRle::SoKhongHopLe { vi_tri: 1 }));
    assert_eq!(giai_nen("1a"), Err(LoiRle::SoKhongHopLe { vi_tri: 0 }));
    assert_eq!(giai_nen("ab1000001c"), Err(LoiRle::SoKhongHopLe { vi_tri: 2 }));
    assert_eq!(giai_nen("99999999999999999999999a"), Err(LoiRle::SoKhongHopLe { vi_tri: 0 }));
    assert_eq!(giai_nen("1"), Err(LoiRle::SoKhongHopLe { vi_tri: 0 }));
}

#[test]
fn thieu_ky_tu_o_cuoi() {
    assert_eq!(giai_nen("ab12"), Err(LoiRle::ThieuKyTu { vi_tri: 4 }));
    assert_eq!(giai_nen("3\\"), Err(LoiRle::ThieuKyTu { vi_tri: 2 }));
    assert_eq!(giai_nen("x\\"), Err(LoiRle::ThieuKyTu { vi_tri: 2 }));
}

#[test]
fn vi_tri_tinh_theo_ky_tu_khong_theo_byte() {
    assert_eq!(giai_nen("éé\\q"), Err(LoiRle::ThoatSai { vi_tri: 2 }));
    assert_eq!(giai_nen("日本3"), Err(LoiRle::ThieuKyTu { vi_tri: 3 }));
    assert_eq!(giai_nen("🦀0x"), Err(LoiRle::SoKhongHopLe { vi_tri: 1 }));
}

#[test]
fn khu_hoi() {
    let mau = [
        "a",
        "0",
        "\\0\\",
        "x9y99z999",
        "  \t\n\n",
        "a\\\\1\\2",
        "e\u{301}e\u{301}",
        "Ááá111\\\\٣٣ 🦀🦀🦀",
        "00000000000000000000000",
    ];
    for s in mau {
        assert_eq!(giai_nen(&nen(s)), ok(s), "khứ hồi hỏng với {s:?}");
    }
    assert_eq!(nen("0000000000000"), "13\\0");
}
