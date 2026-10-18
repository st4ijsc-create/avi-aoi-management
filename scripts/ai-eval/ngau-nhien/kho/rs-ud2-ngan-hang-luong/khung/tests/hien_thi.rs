use bai::{xu_ly_lo, KetQuaLo, Lenh, LoiNganHang, NganHang};

#[test]
fn chuyen_co_ban() {
    let nh = NganHang::moi();
    nh.mo_tai_khoan(1, 100).unwrap();
    nh.mo_tai_khoan(2, 50).unwrap();
    assert_eq!(nh.chuyen(1, 2, 30), Ok(()));
    assert_eq!((nh.so_du(1), nh.so_du(2)), (Ok(70), Ok(80)));
    assert_eq!(nh.tong_tien(), 150);
}

#[test]
fn chuyen_vuot_so_du() {
    let nh = NganHang::moi();
    nh.mo_tai_khoan(1, 100).unwrap();
    nh.mo_tai_khoan(2, 50).unwrap();
    assert_eq!(nh.chuyen(2, 1, 500), Err(LoiNganHang::KhongDuTien { id: 2, so_du: 50, can: 500 }));
    assert_eq!((nh.so_du(1), nh.so_du(2)), (Ok(100), Ok(50)));
}

#[test]
fn xu_ly_lo_don_gian() {
    let nh = NganHang::moi();
    for id in 1..=3 {
        nh.mo_tai_khoan(id, 1000).unwrap();
    }
    let lenh = [
        Lenh { tu: 1, den: 2, so_tien: 10 },
        Lenh { tu: 2, den: 3, so_tien: 20 },
        Lenh { tu: 3, den: 9, so_tien: 5 },
        Lenh { tu: 3, den: 1, so_tien: 40 },
    ];
    let kq = xu_ly_lo(&nh, &lenh, 2);
    assert_eq!(kq, KetQuaLo { thanh_cong: 3, that_bai: vec![(2, LoiNganHang::KhongCoTaiKhoan(9))] });
    assert_eq!((nh.so_du(1), nh.so_du(2), nh.so_du(3)), (Ok(1030), Ok(990), Ok(980)));
}
