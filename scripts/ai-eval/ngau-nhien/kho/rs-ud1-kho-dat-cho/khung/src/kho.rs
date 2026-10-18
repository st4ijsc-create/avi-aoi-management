use std::rc::Rc;

use crate::dong_ho::DongHo;
use crate::loi::{LoiKho, TrangThai};

pub struct Kho {
    dong_ho: Rc<dyn DongHo>,
    thoi_han_giu: u64,
}

impl Kho {
    pub fn moi(dong_ho: Rc<dyn DongHo>, thoi_han_giu: u64) -> Kho {
        Kho { dong_ho, thoi_han_giu }
    }

    pub fn nhap(&mut self, _ma: &str, _so_luong: u32) -> Result<(), LoiKho> {
        let _ = (self.dong_ho.bay_gio(), self.thoi_han_giu);
        todo!()
    }

    pub fn ton(&self, _ma: &str) -> u32 {
        todo!()
    }

    pub fn dang_giu(&self, _ma: &str) -> u32 {
        todo!()
    }

    pub fn kha_dung(&self, _ma: &str) -> u32 {
        todo!()
    }

    pub fn giu(&mut self, _ma: &str, _so_luong: u32) -> Result<u64, LoiKho> {
        todo!()
    }

    pub fn huy(&mut self, _id: u64) -> Result<(), LoiKho> {
        todo!()
    }

    pub fn xac_nhan(&mut self, _id: u64) -> Result<(), LoiKho> {
        todo!()
    }

    pub fn xuat(&mut self, _ma: &str, _so_luong: u32) -> Result<(), LoiKho> {
        todo!()
    }

    pub fn trang_thai(&self, _id: u64) -> Option<TrangThai> {
        todo!()
    }
}
