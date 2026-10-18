use std::fmt;

pub const SAI_SO: f64 = 1e-9;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoiHinh {
    KichThuocKhongHopLe,
    KhongPhaiTamGiac,
}

pub trait Hinh {
    fn dien_tich(&self) -> f64;
    fn chu_vi(&self) -> f64;
    fn ten(&self) -> &'static str;
}

#[derive(Debug, Clone, Copy)]
pub struct Tron {
    pub ban_kinh: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct ChuNhat {
    pub rong: f64,
    pub cao: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct TamGiac {
    pub a: f64,
    pub b: f64,
    pub c: f64,
}

impl Tron {
    pub fn moi(_ban_kinh: f64) -> Result<Tron, LoiHinh> {
        todo!()
    }
}

impl ChuNhat {
    pub fn moi(_rong: f64, _cao: f64) -> Result<ChuNhat, LoiHinh> {
        todo!()
    }
}

impl TamGiac {
    pub fn moi(_a: f64, _b: f64, _c: f64) -> Result<TamGiac, LoiHinh> {
        todo!()
    }
}

impl Hinh for Tron {
    fn dien_tich(&self) -> f64 {
        todo!()
    }
    fn chu_vi(&self) -> f64 {
        todo!()
    }
    fn ten(&self) -> &'static str {
        todo!()
    }
}

impl Hinh for ChuNhat {
    fn dien_tich(&self) -> f64 {
        todo!()
    }
    fn chu_vi(&self) -> f64 {
        todo!()
    }
    fn ten(&self) -> &'static str {
        todo!()
    }
}

impl Hinh for TamGiac {
    fn dien_tich(&self) -> f64 {
        todo!()
    }
    fn chu_vi(&self) -> f64 {
        todo!()
    }
    fn ten(&self) -> &'static str {
        todo!()
    }
}

impl PartialEq for Tron {
    fn eq(&self, _khac: &Self) -> bool {
        todo!()
    }
}

impl PartialEq for ChuNhat {
    fn eq(&self, _khac: &Self) -> bool {
        todo!()
    }
}

impl PartialEq for TamGiac {
    fn eq(&self, _khac: &Self) -> bool {
        todo!()
    }
}

impl fmt::Display for dyn Hinh + '_ {
    fn fmt(&self, _f: &mut fmt::Formatter<'_>) -> fmt::Result {
        todo!()
    }
}

pub fn sap_xep_theo_dien_tich(_ds: &mut [Box<dyn Hinh>]) {
    todo!()
}

pub fn tong_dien_tich(_ds: &[Box<dyn Hinh>]) -> f64 {
    todo!()
}

pub fn lon_nhat<T: Hinh>(_ds: &[T]) -> Option<&T> {
    todo!()
}

pub fn loc_dien_tich_lon_hon<'a>(_ds: &'a [Box<dyn Hinh>], _nguong: f64) -> impl Iterator<Item = &'a dyn Hinh> + 'a {
    todo!();
    #[allow(unreachable_code)]
    std::iter::empty()
}
