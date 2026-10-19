use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoiNganHang {
    KhongCoTaiKhoan(u32),
    TaiKhoanDaCo(u32),
    SoTienKhongHopLe,
    KhongDuTien { id: u32, so_du: u64, can: u64 },
    CungTaiKhoan,
    TranSo(u32),
}

impl fmt::Display for LoiNganHang {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LoiNganHang::KhongCoTaiKhoan(id) => write!(f, "không có tài khoản {id}"),
            LoiNganHang::TaiKhoanDaCo(id) => write!(f, "tài khoản {id} đã có"),
            LoiNganHang::SoTienKhongHopLe => write!(f, "số tiền phải lớn hơn 0"),
            LoiNganHang::KhongDuTien { id, so_du, can } => write!(f, "tài khoản {id} chỉ còn {so_du}, cần {can}"),
            LoiNganHang::CungTaiKhoan => write!(f, "không chuyển cho chính mình"),
            LoiNganHang::TranSo(id) => write!(f, "số dư tài khoản {id} bị tràn"),
        }
    }
}

impl std::error::Error for LoiNganHang {}
