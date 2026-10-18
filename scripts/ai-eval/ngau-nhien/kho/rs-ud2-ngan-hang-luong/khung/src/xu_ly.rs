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

pub fn xu_ly_lo(_nh: &NganHang, _lenh: &[Lenh], _so_luong: usize) -> KetQuaLo {
    todo!()
}
