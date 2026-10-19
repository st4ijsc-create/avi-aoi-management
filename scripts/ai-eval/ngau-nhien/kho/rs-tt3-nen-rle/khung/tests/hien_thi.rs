use bai::{giai_nen, nen, LoiRle};

#[test]
fn nen_va_giai_nen_co_ban() {
    assert_eq!(nen("aaabcc"), "3ab2c");
    assert_eq!(giai_nen("3ab2c"), Ok("aaabcc".to_string()));
}

#[test]
fn chu_so_trong_du_lieu_phai_thoat() {
    assert_eq!(nen("a111"), "a3\\1");
    assert_eq!(giai_nen("a3\\1"), Ok("a111".to_string()));
}

#[test]
fn loi_co_vi_tri() {
    assert_eq!(giai_nen("3"), Err(LoiRle::ThieuKyTu { vi_tri: 1 }));
    assert_eq!(giai_nen("\\x"), Err(LoiRle::ThoatSai { vi_tri: 0 }));
}
