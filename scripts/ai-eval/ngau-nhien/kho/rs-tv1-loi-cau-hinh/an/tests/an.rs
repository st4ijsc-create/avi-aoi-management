use bai::{CauHinh, LoiCauHinh};
use std::error::Error;

#[test]
fn khoa_trung_bao_dong_thu_hai() {
    let r = CauHinh::phan_tich("a = 1\n\n# x\nb = 2\na = 3\n");
    assert_eq!(r.err(), Some(LoiCauHinh::KhoaTrung { khoa: "a".to_string(), dong: 5 }));
}

#[test]
fn khoa_ky_tu_khong_hop_le() {
    assert_eq!(CauHinh::phan_tich("Ten = x").err(), Some(LoiCauHinh::DongHong { dong: 1 }));
    assert_eq!(CauHinh::phan_tich("ok = 1\n = x").err(), Some(LoiCauHinh::DongHong { dong: 2 }));
    assert_eq!(CauHinh::phan_tich("may.so_1 = x").map(|c| c.chuoi("may.so_1").map(|s| s.to_string())).unwrap(), Ok("x".to_string()));
}

#[test]
fn gia_tri_trong_nhay_va_dau_bang() {
    let c = CauHinh::phan_tich("  url = \"a=b # c \"  \nrong =\nduong = x=y\n").unwrap();
    assert_eq!(c.chuoi("url"), Ok("a=b # c "));
    assert_eq!(c.chuoi("rong"), Ok(""));
    assert_eq!(c.chuoi("duong"), Ok("x=y"));
}

#[test]
fn so_nguyen_sai_kieu_va_am() {
    let c = CauHinh::phan_tich("a = -42\nb = 4x\nc = 99999999999999999999").unwrap();
    assert_eq!(c.so_nguyen("a"), Ok(-42));
    assert_eq!(c.so_nguyen("b"), Err(LoiCauHinh::SaiKieu { khoa: "b".to_string(), mong_doi: "so nguyen" }));
    assert_eq!(c.so_nguyen("c"), Err(LoiCauHinh::SaiKieu { khoa: "c".to_string(), mong_doi: "so nguyen" }));
    assert_eq!(c.so_nguyen("z"), Err(LoiCauHinh::ThieuKhoa("z".to_string())));
}

#[test]
fn logic_cac_dang() {
    let c = CauHinh::phan_tich("a = TRUE\nb = No\nc = 1\nd = 0\ne = có").unwrap();
    assert_eq!(c.logic("a"), Ok(true));
    assert_eq!(c.logic("b"), Ok(false));
    assert_eq!(c.logic("c"), Ok(true));
    assert_eq!(c.logic("d"), Ok(false));
    assert_eq!(c.logic("e"), Err(LoiCauHinh::SaiKieu { khoa: "e".to_string(), mong_doi: "logic" }));
}

#[test]
fn so_nguyen_hoac_mac_dinh() {
    let c = CauHinh::phan_tich("a = 5\nb = x").unwrap();
    assert_eq!(c.so_nguyen_hoac("a", 1), Ok(5));
    assert_eq!(c.so_nguyen_hoac("z", 7), Ok(7));
    assert!(matches!(c.so_nguyen_hoac("b", 7), Err(LoiCauHinh::SaiKieu { .. })));
}

#[test]
fn hien_thi_chinh_xac() {
    assert_eq!(LoiCauHinh::DongHong { dong: 3 }.to_string(), "dòng 3: không hợp lệ");
    assert_eq!(LoiCauHinh::KhoaTrung { khoa: "a".into(), dong: 9 }.to_string(), "dòng 9: khoá 'a' bị trùng");
    assert_eq!(LoiCauHinh::ThieuKhoa("x.y".into()).to_string(), "thiếu khoá 'x.y'");
    assert_eq!(LoiCauHinh::SaiKieu { khoa: "p".into(), mong_doi: "logic" }.to_string(), "khoá 'p': cần logic");
}

#[test]
fn la_std_error_va_dung_voi_dau_hoi() {
    fn doc() -> Result<i64, Box<dyn Error>> {
        let c = CauHinh::phan_tich("n = 3")?;
        Ok(c.so_nguyen("n")? + c.so_nguyen("m")?)
    }
    let e = doc().unwrap_err();
    assert_eq!(e.to_string(), "thiếu khoá 'm'");
}

#[test]
fn nhay_mot_ben_va_dong_trang() {
    let c = CauHinh::phan_tich("\n   \n# chú thích = có dấu bằng\na = \"x\nb = \"\"\n").unwrap();
    assert_eq!(c.chuoi("a"), Ok("\"x"));
    assert_eq!(c.chuoi("b"), Ok(""));
}
