use std::cell::Cell;

/// Nguồn thời gian (giây) tiêm vào kho — KHÔNG đọc đồng hồ hệ thống trong kho.
pub trait DongHo {
    fn bay_gio(&self) -> u64;
}

/// Đồng hồ giả cho test: chỉ đổi khi gọi `tien`.
pub struct DongHoGia {
    t: Cell<u64>,
}

impl DongHoGia {
    pub fn moi(t: u64) -> DongHoGia {
        DongHoGia { t: Cell::new(t) }
    }

    pub fn tien(&self, giay: u64) {
        self.t.set(self.t.get() + giay);
    }
}

impl DongHo for DongHoGia {
    fn bay_gio(&self) -> u64 {
        self.t.get()
    }
}
