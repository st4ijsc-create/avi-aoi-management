#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoiMenhGia {
    Rong,
    BangKhong,
    Trung(u32),
}

pub fn it_dong_nhat(_menh_gia: &[u32], _so_tien: u32) -> Result<Option<Vec<u32>>, LoiMenhGia> {
    todo!()
}

pub fn dem_so_cach(_menh_gia: &[u32], _so_tien: u32) -> Result<u128, LoiMenhGia> {
    todo!()
}
