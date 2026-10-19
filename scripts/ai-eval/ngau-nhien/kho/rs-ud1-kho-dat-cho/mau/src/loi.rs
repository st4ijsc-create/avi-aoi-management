use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrangThai {
    DangGiu,
    DaXacNhan,
    DaHuy,
    HetHan,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoiKho {
    SoLuongKhongHopLe,
    KhongCoHang(String),
    KhongDu { ma: String, can: u32, con: u32 },
    KhongCoDatCho(u64),
    DaKetThuc { id: u64, trang_thai: TrangThai },
}

impl fmt::Display for TrangThai {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            TrangThai::DangGiu => "đang giữ",
            TrangThai::DaXacNhan => "đã xác nhận",
            TrangThai::DaHuy => "đã huỷ",
            TrangThai::HetHan => "hết hạn",
        })
    }
}

impl fmt::Display for LoiKho {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LoiKho::SoLuongKhongHopLe => write!(f, "số lượng phải lớn hơn 0"),
            LoiKho::KhongCoHang(ma) => write!(f, "không có mặt hàng '{ma}'"),
            LoiKho::KhongDu { ma, can, con } => write!(f, "mặt hàng '{ma}' không đủ: cần {can}, còn {con}"),
            LoiKho::KhongCoDatCho(id) => write!(f, "không có đặt chỗ #{id}"),
            LoiKho::DaKetThuc { id, trang_thai } => write!(f, "đặt chỗ #{id} đã kết thúc ({trang_thai})"),
        }
    }
}

impl std::error::Error for LoiKho {}
