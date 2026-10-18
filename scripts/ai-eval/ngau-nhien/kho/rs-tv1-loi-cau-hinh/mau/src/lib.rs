use std::collections::HashMap;
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoiCauHinh {
    DongHong { dong: usize },
    KhoaTrung { khoa: String, dong: usize },
    ThieuKhoa(String),
    SaiKieu { khoa: String, mong_doi: &'static str },
}

impl fmt::Display for LoiCauHinh {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LoiCauHinh::DongHong { dong } => write!(f, "dòng {dong}: không hợp lệ"),
            LoiCauHinh::KhoaTrung { khoa, dong } => write!(f, "dòng {dong}: khoá '{khoa}' bị trùng"),
            LoiCauHinh::ThieuKhoa(k) => write!(f, "thiếu khoá '{k}'"),
            LoiCauHinh::SaiKieu { khoa, mong_doi } => write!(f, "khoá '{khoa}': cần {mong_doi}"),
        }
    }
}

impl std::error::Error for LoiCauHinh {}

pub struct CauHinh {
    /// khoá ⇒ (giá trị, dòng)
    muc: HashMap<String, (String, usize)>,
}

fn khoa_hop_le(k: &str) -> bool {
    !k.is_empty() && k.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '.')
}

impl CauHinh {
    pub fn phan_tich(s: &str) -> Result<CauHinh, LoiCauHinh> {
        let mut map: HashMap<String, (String, usize)> = HashMap::new();
        for (i, tho) in s.lines().enumerate() {
            let so_dong = i + 1;
            let dong = tho.trim();
            if dong.is_empty() || dong.starts_with('#') {
                continue;
            }
            let (k, v) = dong.split_once('=').ok_or(LoiCauHinh::DongHong { dong: so_dong })?;
            let khoa = k.trim();
            if !khoa_hop_le(khoa) {
                return Err(LoiCauHinh::DongHong { dong: so_dong });
            }
            let mut gia_tri = v.trim();
            if gia_tri.len() >= 2 && gia_tri.starts_with('"') && gia_tri.ends_with('"') {
                gia_tri = &gia_tri[1..gia_tri.len() - 1];
            }
            if map.contains_key(khoa) {
                return Err(LoiCauHinh::KhoaTrung { khoa: khoa.to_string(), dong: so_dong });
            }
            map.insert(khoa.to_string(), (gia_tri.to_string(), so_dong));
        }
        Ok(CauHinh { muc: map })
    }

    pub fn chuoi(&self, khoa: &str) -> Result<&str, LoiCauHinh> {
        self.muc
            .get(khoa)
            .map(|(v, _)| v.as_str())
            .ok_or_else(|| LoiCauHinh::ThieuKhoa(khoa.to_string()))
    }

    pub fn so_nguyen(&self, khoa: &str) -> Result<i64, LoiCauHinh> {
        self.chuoi(khoa)?
            .parse::<i64>()
            .map_err(|_| LoiCauHinh::SaiKieu { khoa: khoa.to_string(), mong_doi: "so nguyen" })
    }

    pub fn logic(&self, khoa: &str) -> Result<bool, LoiCauHinh> {
        match self.chuoi(khoa)?.to_ascii_lowercase().as_str() {
            "true" | "yes" | "1" => Ok(true),
            "false" | "no" | "0" => Ok(false),
            _ => Err(LoiCauHinh::SaiKieu { khoa: khoa.to_string(), mong_doi: "logic" }),
        }
    }

    pub fn so_nguyen_hoac(&self, khoa: &str, mac_dinh: i64) -> Result<i64, LoiCauHinh> {
        match self.so_nguyen(khoa) {
            Err(LoiCauHinh::ThieuKhoa(_)) => Ok(mac_dinh),
            r => r,
        }
    }
}
