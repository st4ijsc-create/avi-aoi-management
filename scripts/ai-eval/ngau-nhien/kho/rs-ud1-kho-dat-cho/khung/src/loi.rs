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
    fn fmt(&self, _f: &mut fmt::Formatter<'_>) -> fmt::Result {
        todo!()
    }
}

impl fmt::Display for LoiKho {
    fn fmt(&self, _f: &mut fmt::Formatter<'_>) -> fmt::Result {
        todo!()
    }
}

impl std::error::Error for LoiKho {}
