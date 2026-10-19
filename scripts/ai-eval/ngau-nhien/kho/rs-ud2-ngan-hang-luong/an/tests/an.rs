use bai::{xu_ly_lo, KetQuaLo, Lenh, LoiNganHang, NganHang};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;

fn ngan_hang(so_du: &[(u32, u64)]) -> NganHang {
    let nh = NganHang::moi();
    for &(id, s) in so_du {
        nh.mo_tai_khoan(id, s).unwrap();
    }
    nh
}

/// Chạy thân test trong một luồng tách rời; quá 20 s ⇒ coi là deadlock (test TRƯỢT thay vì treo cả bộ test).
fn trong_han(than: impl FnOnce() + Send + 'static) {
    let (gui, nhan) = mpsc::channel();
    thread::spawn(move || {
        than();
        let _ = gui.send(());
    });
    match nhan.recv_timeout(Duration::from_secs(20)) {
        Ok(()) => {}
        Err(mpsc::RecvTimeoutError::Timeout) => panic!("nghi deadlock: test không xong sau 20 s"),
        Err(mpsc::RecvTimeoutError::Disconnected) => panic!("thân test bị panic (xem thông báo phía trên)"),
    }
}

/// xorshift có hạt giống — tất định.
fn sinh(hat: u64) -> impl FnMut() -> u64 {
    let mut x = hat | 1;
    move || {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        x
    }
}

#[test]
fn thu_tu_kiem_loi() {
    trong_han(move || {
        let nh = ngan_hang(&[(1, 10)]);
        assert_eq!(nh.chuyen(1, 1, 0), Err(LoiNganHang::SoTienKhongHopLe));
        assert_eq!(nh.chuyen(1, 1, 5), Err(LoiNganHang::CungTaiKhoan));
        assert_eq!(nh.chuyen(9, 8, 5), Err(LoiNganHang::KhongCoTaiKhoan(9)));
        assert_eq!(nh.chuyen(1, 8, 5), Err(LoiNganHang::KhongCoTaiKhoan(8)));
        assert_eq!(nh.chuyen(8, 1, 500), Err(LoiNganHang::KhongCoTaiKhoan(8)));
        assert_eq!(nh.mo_tai_khoan(1, 0), Err(LoiNganHang::TaiKhoanDaCo(1)));
        assert_eq!(nh.so_du(7), Err(LoiNganHang::KhongCoTaiKhoan(7)));
        assert_eq!(nh.rut(1, 0), Err(LoiNganHang::SoTienKhongHopLe));
        assert_eq!(nh.nap(1, 0), Err(LoiNganHang::SoTienKhongHopLe));
        assert_eq!(nh.nap(3, 1), Err(LoiNganHang::KhongCoTaiKhoan(3)));
        assert_eq!(nh.rut(3, 1), Err(LoiNganHang::KhongCoTaiKhoan(3)));
        assert_eq!(nh.rut(1, 11), Err(LoiNganHang::KhongDuTien { id: 1, so_du: 10, can: 11 }));
        assert_eq!(nh.so_du(1), Ok(10));
    });
}

#[test]
fn lay_dung_bang_so_du() {
    trong_han(move || {
        let nh = ngan_hang(&[(1, 10), (2, 0)]);
        assert_eq!(nh.chuyen(1, 2, 10), Ok(()));
        assert_eq!((nh.so_du(1), nh.so_du(2)), (Ok(0), Ok(10)));
        assert_eq!(nh.rut(2, 10), Ok(0));
        assert_eq!(nh.nap(2, 7), Ok(7));
        assert_eq!(nh.tong_tien(), 7);
    });
}

#[test]
fn tran_so_va_tong_u128() {
    trong_han(move || {
        let nh = ngan_hang(&[(1, u64::MAX), (2, u64::MAX), (3, 5)]);
        assert_eq!(nh.nap(1, 1), Err(LoiNganHang::TranSo(1)));
        assert_eq!(nh.chuyen(3, 2, 1), Err(LoiNganHang::TranSo(2)));
        assert_eq!((nh.so_du(1), nh.so_du(2), nh.so_du(3)), (Ok(u64::MAX), Ok(u64::MAX), Ok(5)));
        assert_eq!(nh.tong_tien(), 2 * (u64::MAX as u128) + 5);
        assert_eq!(NganHang::moi().tong_tien(), 0);
    });
}

#[test]
fn ngan_hang_send_sync() {
    trong_han(move || {
        fn can<T: Send + Sync>() {}
        can::<NganHang>();
        can::<KetQuaLo>();
    });
}

#[test]
fn nap_rut_dong_thoi_khong_mat_cap_nhat() {
    trong_han(move || {
        let nh = ngan_hang(&[(1, 10_000)]);
        thread::scope(|s| {
            for _ in 0..8 {
                s.spawn(|| {
                    for _ in 0..1000 {
                        nh.nap(1, 1).unwrap();
                    }
                });
                s.spawn(|| {
                    for _ in 0..500 {
                        nh.rut(1, 1).unwrap();
                    }
                });
            }
        });
        assert_eq!(nh.so_du(1), Ok(14_000));
    });
}

#[test]
fn tu_choi_vuot_so_du_khi_dong_thoi() {
    trong_han(move || {
        let nh = ngan_hang(&[(1, 100), (2, 0)]);
        let ok = AtomicUsize::new(0);
        let loi = AtomicUsize::new(0);
        thread::scope(|s| {
            for _ in 0..10 {
                s.spawn(|| {
                    for _ in 0..50 {
                        match nh.chuyen(1, 2, 1) {
                            Ok(()) => {
                                ok.fetch_add(1, Ordering::SeqCst);
                            }
                            Err(e) => {
                                assert_eq!(e, LoiNganHang::KhongDuTien { id: 1, so_du: 0, can: 1 });
                                loi.fetch_add(1, Ordering::SeqCst);
                            }
                        }
                    }
                });
            }
        });
        assert_eq!((ok.load(Ordering::SeqCst), loi.load(Ordering::SeqCst)), (100, 400));
        assert_eq!((nh.so_du(1), nh.so_du(2)), (Ok(0), Ok(100)));
    });
}

#[test]
fn khong_deadlock_khi_chuyen_cheo() {
    trong_han(move || {
        const N: u64 = 20_000;
        let nh = Arc::new(ngan_hang(&[(1, 1_000_000), (2, 1_000_000), (3, 1_000_000)]));
        let (xong, cho) = mpsc::channel();
        for (tu, den) in [(1, 2), (2, 1), (2, 3), (3, 1)] {
            let nh = Arc::clone(&nh);
            let xong = xong.clone();
            thread::spawn(move || {
                for _ in 0..N {
                    nh.chuyen(tu, den, 1).unwrap();
                }
                xong.send(()).unwrap();
            });
        }
        for _ in 0..4 {
            cho.recv().expect("luồng chuyển khoản bị panic");
        }
        assert_eq!((nh.so_du(1), nh.so_du(2), nh.so_du(3)), (Ok(1_020_000), Ok(980_000), Ok(1_000_000)));
    });
}

#[test]
fn tong_tien_la_anh_chup_nhat_quan() {
    trong_han(move || {
        let nh = ngan_hang(&(0..8).map(|id| (id, 1000)).collect::<Vec<_>>());
        let xong = AtomicBool::new(false);
        let so_lan_doc = AtomicUsize::new(0);
        thread::scope(|s| {
            s.spawn(|| {
                while !xong.load(Ordering::SeqCst) {
                    assert_eq!(nh.tong_tien(), 8000);
                    so_lan_doc.fetch_add(1, Ordering::SeqCst);
                }
            });
            let ghi: Vec<_> = (0..4u64)
                .map(|k| {
                    let nh = &nh;
                    s.spawn(move || {
                        let mut r = sinh(0x9E37_79B9_7F4A_7C15 ^ (k + 1));
                        for _ in 0..20_000 {
                            let tu = (r() % 8) as u32;
                            let den = (tu + 1 + (r() % 7) as u32) % 8;
                            let _ = nh.chuyen(tu, den, r() % 50 + 1);
                        }
                    })
                })
                .collect();
            for g in ghi {
                g.join().unwrap();
            }
            xong.store(true, Ordering::SeqCst);
        });
        assert!(so_lan_doc.load(Ordering::SeqCst) >= 1);
        assert_eq!(nh.tong_tien(), 8000);
    });
}

#[test]
fn xu_ly_lo_loi_xac_dinh() {
    trong_han(move || {
        let nh = ngan_hang(&[(1, 500), (2, 500), (3, 500)]);
        let lenh = [
            Lenh { tu: 1, den: 2, so_tien: 0 },
            Lenh { tu: 2, den: 2, so_tien: 1 },
            Lenh { tu: 1, den: 3, so_tien: 100 },
            Lenh { tu: 4, den: 1, so_tien: 1 },
            Lenh { tu: 3, den: 2, so_tien: 50 },
            Lenh { tu: 2, den: 5, so_tien: 1 },
            Lenh { tu: 2, den: 1, so_tien: 25 },
        ];
        let kq = xu_ly_lo(&nh, &lenh, 3);
        assert_eq!(
            kq,
            KetQuaLo {
                thanh_cong: 3,
                that_bai: vec![
                    (0, LoiNganHang::SoTienKhongHopLe),
                    (1, LoiNganHang::CungTaiKhoan),
                    (3, LoiNganHang::KhongCoTaiKhoan(4)),
                    (5, LoiNganHang::KhongCoTaiKhoan(5)),
                ],
            }
        );
        assert_eq!((nh.so_du(1), nh.so_du(2), nh.so_du(3)), (Ok(425), Ok(525), Ok(550)));
    });
}

#[test]
fn xu_ly_lo_cung_luong_theo_thu_tu_chi_so() {
    trong_han(move || {
        let lenh = [
            Lenh { tu: 1, den: 2, so_tien: 10 },
            Lenh { tu: 3, den: 4, so_tien: 1 },
            Lenh { tu: 3, den: 4, so_tien: 1 },
            Lenh { tu: 3, den: 4, so_tien: 1 },
            Lenh { tu: 1, den: 2, so_tien: 10 },
        ];
        let mong = KetQuaLo { thanh_cong: 4, that_bai: vec![(4, LoiNganHang::KhongDuTien { id: 1, so_du: 0, can: 10 })] };
        for so_luong in [4, 0, 1] {
            let nh = ngan_hang(&[(1, 10), (2, 0), (3, 100), (4, 0)]);
            assert_eq!(xu_ly_lo(&nh, &lenh, so_luong), mong, "so_luong = {so_luong}");
            assert_eq!(nh.so_du(4), Ok(3));
        }
        let nh = ngan_hang(&[(1, 10)]);
        assert_eq!(xu_ly_lo(&nh, &[], 4), KetQuaLo { thanh_cong: 0, that_bai: vec![] });
    });
}

#[test]
fn xu_ly_lo_bao_toan_tong_tien() {
    trong_han(move || {
        let nh = ngan_hang(&(1..=6).map(|id| (id, 100)).collect::<Vec<_>>());
        let mut r = sinh(42);
        let lenh: Vec<Lenh> = (0..2000)
            .map(|_| {
                let tu = (r() % 6) as u32 + 1;
                let den = (tu + (r() % 5) as u32) % 6 + 1;
                Lenh { tu, den, so_tien: r() % 120 + 1 }
            })
            .collect();
        let kq = xu_ly_lo(&nh, &lenh, 8);
        assert_eq!(kq.thanh_cong + kq.that_bai.len(), lenh.len());
        assert!(kq.that_bai.windows(2).all(|w| w[0].0 < w[1].0));
        for (j, e) in &kq.that_bai {
            match e {
                LoiNganHang::KhongDuTien { id, so_du, can } => {
                    assert_eq!((*id, *can), (lenh[*j].tu, lenh[*j].so_tien));
                    assert!(so_du < can);
                }
                khac => panic!("lệnh {j}: lỗi không mong đợi {khac:?}"),
            }
        }
        assert!(kq.thanh_cong > 0 && !kq.that_bai.is_empty());
        assert_eq!(nh.tong_tien(), 600);
    });
}
