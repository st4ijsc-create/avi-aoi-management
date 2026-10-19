use std::cmp::Ordering;
use std::f64::consts::PI;
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

fn kich_thuoc(x: f64) -> Result<f64, LoiHinh> {
    let hop_le = x.is_finite() && x > 0.0;
    hop_le.then_some(x).ok_or(LoiHinh::KichThuocKhongHopLe)
}

fn gan(x: f64, y: f64) -> bool {
    (x - y).abs() <= SAI_SO
}

impl Tron {
    pub fn moi(ban_kinh: f64) -> Result<Tron, LoiHinh> {
        Ok(Tron { ban_kinh: kich_thuoc(ban_kinh)? })
    }
}

impl ChuNhat {
    pub fn moi(rong: f64, cao: f64) -> Result<ChuNhat, LoiHinh> {
        Ok(ChuNhat { rong: kich_thuoc(rong)?, cao: kich_thuoc(cao)? })
    }
}

impl TamGiac {
    pub fn moi(a: f64, b: f64, c: f64) -> Result<TamGiac, LoiHinh> {
        let (a, b, c) = (kich_thuoc(a)?, kich_thuoc(b)?, kich_thuoc(c)?);
        if !(a + b > c && a + c > b && b + c > a) {
            return Err(LoiHinh::KhongPhaiTamGiac);
        }
        Ok(TamGiac { a, b, c })
    }

    fn canh_sap_xep(&self) -> [f64; 3] {
        let mut k = [self.a, self.b, self.c];
        k.sort_by(f64::total_cmp);
        k
    }
}

impl Hinh for Tron {
    fn dien_tich(&self) -> f64 {
        PI * self.ban_kinh * self.ban_kinh
    }
    fn chu_vi(&self) -> f64 {
        2.0 * PI * self.ban_kinh
    }
    fn ten(&self) -> &'static str {
        "tròn"
    }
}

impl Hinh for ChuNhat {
    fn dien_tich(&self) -> f64 {
        self.rong * self.cao
    }
    fn chu_vi(&self) -> f64 {
        2.0 * (self.rong + self.cao)
    }
    fn ten(&self) -> &'static str {
        "chữ nhật"
    }
}

impl Hinh for TamGiac {
    fn dien_tich(&self) -> f64 {
        let s = self.chu_vi() / 2.0;
        (s * (s - self.a) * (s - self.b) * (s - self.c)).sqrt()
    }
    fn chu_vi(&self) -> f64 {
        self.a + self.b + self.c
    }
    fn ten(&self) -> &'static str {
        "tam giác"
    }
}

impl PartialEq for Tron {
    fn eq(&self, khac: &Self) -> bool {
        gan(self.ban_kinh, khac.ban_kinh)
    }
}

impl PartialEq for ChuNhat {
    fn eq(&self, khac: &Self) -> bool {
        (gan(self.rong, khac.rong) && gan(self.cao, khac.cao)) || (gan(self.rong, khac.cao) && gan(self.cao, khac.rong))
    }
}

impl PartialEq for TamGiac {
    fn eq(&self, khac: &Self) -> bool {
        let (x, y) = (self.canh_sap_xep(), khac.canh_sap_xep());
        x.iter().zip(y.iter()).all(|(p, q)| gan(*p, *q))
    }
}

impl fmt::Display for dyn Hinh + '_ {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} S={:.2} P={:.2}", self.ten(), self.dien_tich(), self.chu_vi())
    }
}

pub fn sap_xep_theo_dien_tich(ds: &mut [Box<dyn Hinh>]) {
    // sort_by ổn định ⇒ diện tích bằng nhau giữ thứ tự cũ
    ds.sort_by(|x, y| x.dien_tich().total_cmp(&y.dien_tich()));
}

pub fn tong_dien_tich(ds: &[Box<dyn Hinh>]) -> f64 {
    ds.iter().map(|h| h.dien_tich()).sum()
}

pub fn lon_nhat<T: Hinh>(ds: &[T]) -> Option<&T> {
    let mut tot: Option<&T> = None;
    for h in ds {
        match tot {
            Some(t) if h.dien_tich().total_cmp(&t.dien_tich()) != Ordering::Greater => {}
            _ => tot = Some(h),
        }
    }
    tot
}

pub fn loc_dien_tich_lon_hon<'a>(ds: &'a [Box<dyn Hinh>], nguong: f64) -> impl Iterator<Item = &'a dyn Hinh> + 'a {
    ds.iter().map(|h| h.as_ref()).filter(move |h| h.dien_tich() > nguong)
}
