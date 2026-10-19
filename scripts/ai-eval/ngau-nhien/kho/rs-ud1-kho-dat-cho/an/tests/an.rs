use bai::{DongHoGia, Kho, LoiKho, TrangThai};
use std::collections::HashMap;
use std::error::Error;
use std::rc::Rc;

fn tao(t: u64, han: u64) -> (Rc<DongHoGia>, Kho) {
    let dh = Rc::new(DongHoGia::moi(t));
    let kho = Kho::moi(dh.clone(), han);
    (dh, kho)
}

fn khong_du(ma: &str, can: u32, con: u32) -> LoiKho {
    LoiKho::KhongDu { ma: ma.to_string(), can, con }
}

#[test]
fn het_han_dung_moc_thoi_gian() {
    let (dh, mut kho) = tao(1000, 60);
    kho.nhap("a", 4).unwrap();
    let id = kho.giu("a", 3).unwrap();
    dh.tien(59);
    assert_eq!(kho.trang_thai(id), Some(TrangThai::DangGiu));
    assert_eq!(kho.kha_dung("a"), 1);
    dh.tien(1);
    assert_eq!(kho.trang_thai(id), Some(TrangThai::HetHan));
    assert_eq!((kho.dang_giu("a"), kho.kha_dung("a"), kho.ton("a")), (0, 4, 4));
    assert_eq!(kho.huy(id), Err(LoiKho::DaKetThuc { id, trang_thai: TrangThai::HetHan }));
}

#[test]
fn so_luong_khong_va_hang_la() {
    let (_dh, mut kho) = tao(0, 10);
    assert_eq!(kho.nhap("x", 0), Err(LoiKho::SoLuongKhongHopLe));
    assert_eq!(kho.giu("khong", 0), Err(LoiKho::SoLuongKhongHopLe));
    assert_eq!(kho.giu("khong", 1), Err(LoiKho::KhongCoHang("khong".to_string())));
    assert_eq!(kho.xuat("khong", 1), Err(LoiKho::KhongCoHang("khong".to_string())));
    assert_eq!(kho.xuat("khong", 0), Err(LoiKho::SoLuongKhongHopLe));
    assert_eq!((kho.ton("khong"), kho.dang_giu("khong"), kho.kha_dung("khong")), (0, 0, 0));
    assert_eq!(kho.ton("x"), 0);
}

#[test]
fn id_chi_tang_khi_giu_thanh_cong() {
    let (_dh, mut kho) = tao(0, 10);
    kho.nhap("a", 2).unwrap();
    kho.nhap("b", 2).unwrap();
    assert_eq!(kho.giu("a", 1), Ok(1));
    assert_eq!(kho.giu("a", 5), Err(khong_du("a", 5, 1)));
    assert_eq!(kho.giu("zz", 1), Err(LoiKho::KhongCoHang("zz".to_string())));
    assert_eq!(kho.giu("b", 2), Ok(2));
    assert_eq!(kho.giu("a", 1), Ok(3));
}

#[test]
fn huy_va_trang_thai_ket_thuc() {
    let (_dh, mut kho) = tao(0, 100);
    kho.nhap("a", 5).unwrap();
    let h = kho.giu("a", 2).unwrap();
    let x = kho.giu("a", 1).unwrap();
    assert_eq!(kho.huy(h), Ok(()));
    assert_eq!((kho.ton("a"), kho.dang_giu("a"), kho.kha_dung("a")), (5, 1, 4));
    assert_eq!(kho.huy(h), Err(LoiKho::DaKetThuc { id: h, trang_thai: TrangThai::DaHuy }));
    assert_eq!(kho.xac_nhan(h), Err(LoiKho::DaKetThuc { id: h, trang_thai: TrangThai::DaHuy }));
    assert_eq!(kho.xac_nhan(x), Ok(()));
    assert_eq!(kho.huy(x), Err(LoiKho::DaKetThuc { id: x, trang_thai: TrangThai::DaXacNhan }));
    assert_eq!(kho.xac_nhan(x), Err(LoiKho::DaKetThuc { id: x, trang_thai: TrangThai::DaXacNhan }));
    assert_eq!((kho.ton("a"), kho.kha_dung("a")), (4, 4));
    assert_eq!(kho.trang_thai(h), Some(TrangThai::DaHuy));
}

#[test]
fn dat_cho_khong_ton_tai() {
    let (_dh, mut kho) = tao(0, 100);
    assert_eq!(kho.huy(99), Err(LoiKho::KhongCoDatCho(99)));
    assert_eq!(kho.xac_nhan(0), Err(LoiKho::KhongCoDatCho(0)));
    assert_eq!(kho.trang_thai(1), None);
    kho.nhap("a", 1).unwrap();
    kho.giu("a", 1).unwrap();
    assert_eq!(kho.trang_thai(0), None);
    assert_eq!(kho.trang_thai(2), None);
}

#[test]
fn xuat_chi_lay_phan_kha_dung() {
    let (_dh, mut kho) = tao(0, 100);
    kho.nhap("a", 10).unwrap();
    let id = kho.giu("a", 4).unwrap();
    assert_eq!(kho.xuat("a", 7), Err(khong_du("a", 7, 6)));
    assert_eq!(kho.xuat("a", 6), Ok(()));
    assert_eq!((kho.ton("a"), kho.dang_giu("a"), kho.kha_dung("a")), (4, 4, 0));
    kho.xac_nhan(id).unwrap();
    assert_eq!(kho.ton("a"), 0);
    // mặt hàng đã từng nhập vẫn tồn tại dù tồn bằng 0
    assert_eq!(kho.giu("a", 1), Err(khong_du("a", 1, 0)));
    kho.nhap("a", 3).unwrap();
    kho.nhap("a", 2).unwrap();
    assert_eq!(kho.kha_dung("a"), 5);
}

#[test]
fn het_han_tinh_tu_luc_giu_cua_tung_dat_cho() {
    let (dh, mut kho) = tao(0, 60);
    kho.nhap("a", 3).unwrap();
    let dau = kho.giu("a", 3).unwrap();
    dh.tien(30);
    assert_eq!(kho.giu("a", 1), Err(khong_du("a", 1, 0)));
    dh.tien(30);
    let sau = kho.giu("a", 2).unwrap();
    assert_eq!(kho.trang_thai(dau), Some(TrangThai::HetHan));
    assert_eq!(kho.dang_giu("a"), 2);
    dh.tien(59);
    assert_eq!(kho.trang_thai(sau), Some(TrangThai::DangGiu));
    assert_eq!(kho.xac_nhan(sau), Ok(()));
    dh.tien(1000);
    assert_eq!(kho.trang_thai(sau), Some(TrangThai::DaXacNhan));
    assert_eq!((kho.ton("a"), kho.kha_dung("a")), (1, 1));
}

#[test]
fn hien_thi_loi_chinh_xac() {
    assert_eq!(LoiKho::SoLuongKhongHopLe.to_string(), "số lượng phải lớn hơn 0");
    assert_eq!(LoiKho::KhongCoHang("tao".into()).to_string(), "không có mặt hàng 'tao'");
    assert_eq!(khong_du("le", 5, 2).to_string(), "mặt hàng 'le' không đủ: cần 5, còn 2");
    assert_eq!(LoiKho::KhongCoDatCho(7).to_string(), "không có đặt chỗ #7");
    assert_eq!(
        LoiKho::DaKetThuc { id: 3, trang_thai: TrangThai::HetHan }.to_string(),
        "đặt chỗ #3 đã kết thúc (hết hạn)"
    );
    let ten: Vec<String> =
        [TrangThai::DangGiu, TrangThai::DaXacNhan, TrangThai::DaHuy, TrangThai::HetHan].iter().map(|t| t.to_string()).collect();
    assert_eq!(ten, ["đang giữ", "đã xác nhận", "đã huỷ", "hết hạn"]);
}

#[test]
fn loi_dung_voi_dau_hoi() {
    fn dat(kho: &mut Kho) -> Result<u64, Box<dyn Error>> {
        kho.nhap("a", 1)?;
        let id = kho.giu("a", 1)?;
        kho.giu("a", 1)?;
        Ok(id)
    }
    let (_dh, mut kho) = tao(0, 10);
    assert_eq!(dat(&mut kho).unwrap_err().to_string(), "mặt hàng 'a' không đủ: cần 1, còn 0");
}

#[test]
fn bat_bien_qua_chuoi_thao_tac_gia_ngau_nhien() {
    let (dh, mut kho) = tao(0, 7);
    let ma = ["a", "b", "c"];
    let mut hat: u64 = 0x2545_F491_4F6C_DD1D;
    let mut so = move || {
        hat ^= hat << 13;
        hat ^= hat >> 7;
        hat ^= hat << 17;
        hat
    };
    let mut ton_mong: HashMap<&str, u32> = HashMap::new();
    let mut giu_ok: HashMap<u64, (&str, u32)> = HashMap::new();
    for _ in 0..3000 {
        let m = ma[(so() % 3) as usize];
        let n = (so() % 5) as u32 + 1;
        match so() % 6 {
            0 => {
                kho.nhap(m, n).unwrap();
                *ton_mong.entry(m).or_insert(0) += n;
            }
            1 | 2 => {
                if let Ok(id) = kho.giu(m, n) {
                    giu_ok.insert(id, (m, n));
                }
            }
            3 => {
                if kho.xuat(m, n).is_ok() {
                    *ton_mong.get_mut(m).unwrap() -= n;
                }
            }
            4 => {
                let id = so() % (giu_ok.len() as u64 + 2);
                if kho.xac_nhan(id).is_ok() {
                    let (mm, nn) = giu_ok[&id];
                    *ton_mong.get_mut(mm).unwrap() -= nn;
                }
            }
            _ => {
                let id = so() % (giu_ok.len() as u64 + 2);
                let _ = kho.huy(id);
            }
        }
        if so() % 4 == 0 {
            dh.tien(so() % 3);
        }
        for m in ma {
            let t = kho.ton(m);
            assert_eq!(t, ton_mong.get(m).copied().unwrap_or(0));
            assert!(t >= kho.dang_giu(m));
            assert_eq!(kho.kha_dung(m), t - kho.dang_giu(m));
        }
    }
    assert!(giu_ok.len() > 100);
}
