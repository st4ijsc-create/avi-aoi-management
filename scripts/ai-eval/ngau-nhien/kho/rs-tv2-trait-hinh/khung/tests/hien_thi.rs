use bai::{lon_nhat, sap_xep_theo_dien_tich, ChuNhat, Hinh, LoiHinh, TamGiac, Tron};

#[test]
fn hinh_tron_co_ban() {
    let t = Tron::moi(1.0).unwrap();
    assert!((t.dien_tich() - std::f64::consts::PI).abs() < 1e-9);
    assert_eq!(t.ten(), "tròn");
    assert_eq!(Tron::moi(-1.0), Err(LoiHinh::KichThuocKhongHopLe));
}

#[test]
fn sap_xep_hop_dyn() {
    let mut ds: Vec<Box<dyn Hinh>> = vec![
        Box::new(ChuNhat::moi(3.0, 4.0).unwrap()),
        Box::new(Tron::moi(1.0).unwrap()),
        Box::new(TamGiac::moi(3.0, 4.0, 5.0).unwrap()),
    ];
    sap_xep_theo_dien_tich(&mut ds);
    let ten: Vec<&str> = ds.iter().map(|h| h.ten()).collect();
    assert_eq!(ten, ["tròn", "tam giác", "chữ nhật"]);
}

#[test]
fn lon_nhat_generic() {
    let ds = [Tron::moi(1.0).unwrap(), Tron::moi(3.0).unwrap(), Tron::moi(2.0).unwrap()];
    assert_eq!(lon_nhat(&ds), Some(&Tron::moi(3.0).unwrap()));
}
