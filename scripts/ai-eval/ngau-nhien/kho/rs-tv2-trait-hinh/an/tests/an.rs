use bai::{
    loc_dien_tich_lon_hon, lon_nhat, sap_xep_theo_dien_tich, tong_dien_tich, ChuNhat, Hinh, LoiHinh, TamGiac, Tron,
};
use std::f64::consts::PI;

fn gan_dung(x: f64, y: f64) -> bool {
    (x - y).abs() < 1e-9
}

fn hop(ds: Vec<Box<dyn Hinh>>) -> Vec<Box<dyn Hinh>> {
    ds
}

fn mau_trung_dien_tich() -> Vec<Box<dyn Hinh>> {
    hop(vec![
        Box::new(ChuNhat::moi(1.0, 6.0).unwrap()),
        Box::new(Tron::moi(1.0).unwrap()),
        Box::new(ChuNhat::moi(2.0, 3.0).unwrap()),
        Box::new(ChuNhat::moi(1.0, 1.0).unwrap()),
        Box::new(TamGiac::moi(3.0, 4.0, 5.0).unwrap()),
    ])
}

#[test]
fn kich_thuoc_khong_hop_le() {
    let k = Some(LoiHinh::KichThuocKhongHopLe);
    assert_eq!(Tron::moi(0.0).err(), k);
    assert_eq!(Tron::moi(-0.0).err(), k);
    assert_eq!(Tron::moi(f64::NAN).err(), k);
    assert_eq!(Tron::moi(f64::INFINITY).err(), k);
    assert_eq!(ChuNhat::moi(1.0, 0.0).err(), k);
    assert_eq!(ChuNhat::moi(f64::NEG_INFINITY, 1.0).err(), k);
    assert_eq!(TamGiac::moi(1.0, -1.0, 1.0).err(), k);
    assert_eq!(TamGiac::moi(f64::NAN, 1.0, 1.0).err(), k);
}

#[test]
fn khong_phai_tam_giac() {
    let k = Some(LoiHinh::KhongPhaiTamGiac);
    assert_eq!(TamGiac::moi(1.0, 2.0, 3.0).err(), k);
    assert_eq!(TamGiac::moi(5.0, 1.0, 1.0).err(), k);
    assert_eq!(TamGiac::moi(1.0, 5.0, 1.0).err(), k);
    assert!(TamGiac::moi(2.0, 2.0, 3.0).is_ok());
}

#[test]
fn dien_tich_va_chu_vi() {
    let t = Tron::moi(2.0).unwrap();
    assert!(gan_dung(t.dien_tich(), 4.0 * PI) && gan_dung(t.chu_vi(), 4.0 * PI));
    let c = ChuNhat::moi(2.5, 4.0).unwrap();
    assert!(gan_dung(c.dien_tich(), 10.0) && gan_dung(c.chu_vi(), 13.0));
    let d = TamGiac::moi(2.0, 2.0, 2.0).unwrap();
    assert!(gan_dung(d.dien_tich(), 3f64.sqrt()) && gan_dung(d.chu_vi(), 6.0));
    let e = TamGiac::moi(5.0, 5.0, 6.0).unwrap();
    assert!(gan_dung(e.dien_tich(), 12.0) && gan_dung(e.chu_vi(), 16.0));
    assert_eq!((c.ten(), d.ten()), ("chữ nhật", "tam giác"));
}

#[test]
fn hien_thi_dyn_hinh() {
    let ds = hop(vec![
        Box::new(Tron::moi(1.0).unwrap()),
        Box::new(ChuNhat::moi(2.0, 3.0).unwrap()),
        Box::new(TamGiac::moi(3.0, 4.0, 5.0).unwrap()),
        Box::new(Tron::moi(0.5).unwrap()),
    ]);
    let chu: Vec<String> = ds.iter().map(|h| format!("{h}")).collect();
    assert_eq!(chu, ["tròn S=3.14 P=6.28", "chữ nhật S=6.00 P=10.00", "tam giác S=6.00 P=12.00", "tròn S=0.79 P=3.14"]);
    let r: &dyn Hinh = &ChuNhat::moi(2.5, 4.0).unwrap();
    assert_eq!(r.to_string(), "chữ nhật S=10.00 P=13.00");
}

#[test]
fn sap_xep_on_dinh_khi_bang_dien_tich() {
    let mut ds = mau_trung_dien_tich();
    sap_xep_theo_dien_tich(&mut ds);
    let chu: Vec<String> = ds.iter().map(|h| h.to_string()).collect();
    assert_eq!(
        chu,
        [
            "chữ nhật S=1.00 P=4.00",
            "tròn S=3.14 P=6.28",
            "chữ nhật S=6.00 P=14.00",
            "chữ nhật S=6.00 P=10.00",
            "tam giác S=6.00 P=12.00",
        ]
    );
}

#[test]
fn lon_nhat_hoa_lay_phan_tu_dau() {
    let ds = [ChuNhat::moi(1.0, 6.0).unwrap(), ChuNhat::moi(2.0, 3.0).unwrap(), ChuNhat::moi(3.0, 2.0).unwrap()];
    assert!(std::ptr::eq(lon_nhat(&ds).unwrap(), &ds[0]));
    let tr = [Tron::moi(2.0).unwrap(), Tron::moi(1.0).unwrap(), Tron::moi(2.0).unwrap()];
    assert!(std::ptr::eq(lon_nhat(&tr).unwrap(), &tr[0]));
    let tg = [TamGiac::moi(3.0, 4.0, 5.0).unwrap(), TamGiac::moi(5.0, 5.0, 6.0).unwrap()];
    assert!(std::ptr::eq(lon_nhat(&tg).unwrap(), &tg[1]));
}

#[test]
fn lon_nhat_rong() {
    let rong: [Tron; 0] = [];
    assert_eq!(lon_nhat(&rong), None);
}

#[test]
fn loc_lon_hon_nghiem_ngat_giu_thu_tu() {
    let mut ds = mau_trung_dien_tich();
    ds.push(Box::new(ChuNhat::moi(2.0, 5.0).unwrap()));
    let tren6: Vec<String> = loc_dien_tich_lon_hon(&ds, 6.0).map(|h| h.to_string()).collect();
    assert_eq!(tren6, ["chữ nhật S=10.00 P=14.00"]);
    let tren3: Vec<&str> = loc_dien_tich_lon_hon(&ds, 3.0).map(|h| h.ten()).collect();
    assert_eq!(tren3, ["chữ nhật", "tròn", "chữ nhật", "tam giác", "chữ nhật"]);
    assert_eq!(loc_dien_tich_lon_hon(&ds, 100.0).count(), 0);
    assert_eq!(ds.len(), 6);
}

#[test]
fn tong_dien_tich_hop() {
    assert_eq!(tong_dien_tich(&[]), 0.0);
    let ds = hop(vec![
        Box::new(ChuNhat::moi(2.0, 3.0).unwrap()),
        Box::new(TamGiac::moi(3.0, 4.0, 5.0).unwrap()),
        Box::new(Tron::moi(1.0).unwrap()),
    ]);
    assert!(gan_dung(tong_dien_tich(&ds), 12.0 + PI));
}

#[test]
fn bang_nhau_co_dung_sai_hinh_tron() {
    assert_eq!(Tron::moi(0.1 + 0.2).unwrap(), Tron::moi(0.3).unwrap());
    assert_eq!(Tron::moi(1.0).unwrap(), Tron::moi(1.0 + 1e-12).unwrap());
    assert_ne!(Tron::moi(1.0).unwrap(), Tron::moi(1.0 + 1e-6).unwrap());
}

#[test]
fn bang_nhau_khong_phu_thuoc_thu_tu_canh() {
    assert_eq!(ChuNhat::moi(2.0, 3.0).unwrap(), ChuNhat::moi(3.0, 2.0).unwrap());
    assert_ne!(ChuNhat::moi(2.0, 3.0).unwrap(), ChuNhat::moi(2.0, 4.0).unwrap());
    let g = TamGiac::moi(3.0, 4.0, 5.0).unwrap();
    assert_eq!(g, TamGiac::moi(5.0, 3.0, 4.0).unwrap());
    assert_eq!(g, TamGiac::moi(4.0, 5.0, 3.0 + 1e-12).unwrap());
    assert_ne!(g, TamGiac::moi(3.0, 4.0, 6.0).unwrap());
}
