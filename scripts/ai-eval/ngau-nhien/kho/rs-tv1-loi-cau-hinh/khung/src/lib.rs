#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoiCauHinh {
    DongHong { dong: usize },
    KhoaTrung { khoa: String, dong: usize },
    ThieuKhoa(String),
    SaiKieu { khoa: String, mong_doi: &'static str },
}

pub struct CauHinh {}

impl CauHinh {
    pub fn phan_tich(_s: &str) -> Result<CauHinh, LoiCauHinh> {
        todo!()
    }
    pub fn chuoi(&self, _khoa: &str) -> Result<&str, LoiCauHinh> {
        todo!()
    }
    pub fn so_nguyen(&self, _khoa: &str) -> Result<i64, LoiCauHinh> {
        todo!()
    }
    pub fn logic(&self, _khoa: &str) -> Result<bool, LoiCauHinh> {
        todo!()
    }
    pub fn so_nguyen_hoac(&self, _khoa: &str, _mac_dinh: i64) -> Result<i64, LoiCauHinh> {
        todo!()
    }
}
