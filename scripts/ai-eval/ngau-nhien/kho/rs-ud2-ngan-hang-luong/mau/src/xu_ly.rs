use std::sync::mpsc;
use std::thread;

use crate::loi::LoiNganHang;
use crate::ngan_hang::NganHang;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Lenh {
    pub tu: u32,
    pub den: u32,
    pub so_tien: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KetQuaLo {
    pub thanh_cong: usize,
    pub that_bai: Vec<(usize, LoiNganHang)>,
}

pub fn xu_ly_lo(nh: &NganHang, lenh: &[Lenh], so_luong: usize) -> KetQuaLo {
    let so_luong = so_luong.max(1);
    let (gui, nhan) = mpsc::channel::<(usize, Result<(), LoiNganHang>)>();
    thread::scope(|pham_vi| {
        for i in 0..so_luong {
            let gui = gui.clone();
            pham_vi.spawn(move || {
                // luồng i xử lý các lệnh có chỉ số j ≡ i (mod so_luong), theo thứ tự tăng dần
                for j in (i..lenh.len()).step_by(so_luong) {
                    let l = lenh[j];
                    gui.send((j, nh.chuyen(l.tu, l.den, l.so_tien))).expect("kênh kết quả");
                }
            });
        }
    });
    drop(gui);
    let mut kq = KetQuaLo { thanh_cong: 0, that_bai: Vec::new() };
    for (j, r) in nhan {
        match r {
            Ok(()) => kq.thanh_cong += 1,
            Err(e) => kq.that_bai.push((j, e)),
        }
    }
    kq.that_bai.sort_by_key(|(j, _)| *j);
    kq
}
