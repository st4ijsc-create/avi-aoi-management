use bai::{CauHinh, LoiCauHinh};

#[test]
fn doc_gia_tri_co_ban() {
    let c = CauHinh::phan_tich("# cấu hình\nten = may-1\ncong = 8080\nbat = yes\n").unwrap();
    assert_eq!(c.chuoi("ten"), Ok("may-1"));
    assert_eq!(c.so_nguyen("cong"), Ok(8080));
    assert_eq!(c.logic("bat"), Ok(true));
}

#[test]
fn dong_hong() {
    assert_eq!(CauHinh::phan_tich("a = 1\nkhong co dau bang\n").err(), Some(LoiCauHinh::DongHong { dong: 2 }));
}

#[test]
fn thieu_khoa() {
    let c = CauHinh::phan_tich("a = 1").unwrap();
    assert_eq!(c.chuoi("b"), Err(LoiCauHinh::ThieuKhoa("b".to_string())));
}
