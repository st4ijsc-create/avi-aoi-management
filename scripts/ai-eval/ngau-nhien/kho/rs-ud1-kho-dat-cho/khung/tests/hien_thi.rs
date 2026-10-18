use bai::{DongHoGia, Kho, LoiKho, TrangThai};
use std::rc::Rc;

#[test]
fn giu_roi_xac_nhan() {
    let dh = Rc::new(DongHoGia::moi(1000));
    let mut kho = Kho::moi(dh.clone(), 60);
    kho.nhap("tao", 10).unwrap();
    assert_eq!(kho.giu("tao", 3), Ok(1));
    assert_eq!((kho.ton("tao"), kho.dang_giu("tao"), kho.kha_dung("tao")), (10, 3, 7));
    assert_eq!(kho.xac_nhan(1), Ok(()));
    assert_eq!((kho.ton("tao"), kho.dang_giu("tao"), kho.kha_dung("tao")), (7, 0, 7));
    assert_eq!(kho.trang_thai(1), Some(TrangThai::DaXacNhan));
}

#[test]
fn giu_qua_so_kha_dung() {
    let dh = Rc::new(DongHoGia::moi(0));
    let mut kho = Kho::moi(dh, 60);
    kho.nhap("le", 2).unwrap();
    assert_eq!(kho.giu("le", 5), Err(LoiKho::KhongDu { ma: "le".to_string(), can: 5, con: 2 }));
}

#[test]
fn het_han_tra_lai_hang() {
    let dh = Rc::new(DongHoGia::moi(500));
    let mut kho = Kho::moi(dh.clone(), 60);
    kho.nhap("cam", 5).unwrap();
    let id = kho.giu("cam", 5).unwrap();
    assert_eq!(kho.kha_dung("cam"), 0);
    dh.tien(100);
    assert_eq!(kho.kha_dung("cam"), 5);
    assert_eq!(kho.trang_thai(id), Some(TrangThai::HetHan));
    assert_eq!(kho.xac_nhan(id), Err(LoiKho::DaKetThuc { id, trang_thai: TrangThai::HetHan }));
}
