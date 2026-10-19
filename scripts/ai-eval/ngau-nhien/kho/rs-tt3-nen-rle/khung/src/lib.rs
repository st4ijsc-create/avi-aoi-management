#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoiRle {
    ThieuKyTu { vi_tri: usize },
    SoKhongHopLe { vi_tri: usize },
    ThoatSai { vi_tri: usize },
}

/// Độ dài tối đa của MỘT lượt (một số đếm) trong dạng nén.
pub const LUOT_TOI_DA: usize = 1_000_000;

pub fn nen(_s: &str) -> String {
    todo!()
}

pub fn giai_nen(_s: &str) -> Result<String, LoiRle> {
    todo!()
}
