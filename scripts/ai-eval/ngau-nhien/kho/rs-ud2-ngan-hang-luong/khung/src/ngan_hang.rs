use crate::loi::LoiNganHang;

pub struct NganHang {
    // TODO: trạng thái dùng chung giữa các luồng (Mutex/RwLock…)
}

impl NganHang {
    pub fn moi() -> NganHang {
        todo!()
    }

    pub fn mo_tai_khoan(&self, _id: u32, _so_du: u64) -> Result<(), LoiNganHang> {
        todo!()
    }

    pub fn so_du(&self, _id: u32) -> Result<u64, LoiNganHang> {
        todo!()
    }

    pub fn nap(&self, _id: u32, _so_tien: u64) -> Result<u64, LoiNganHang> {
        todo!()
    }

    pub fn rut(&self, _id: u32, _so_tien: u64) -> Result<u64, LoiNganHang> {
        todo!()
    }

    pub fn chuyen(&self, _tu: u32, _den: u32, _so_tien: u64) -> Result<(), LoiNganHang> {
        todo!()
    }

    pub fn tong_tien(&self) -> u128 {
        todo!()
    }
}
