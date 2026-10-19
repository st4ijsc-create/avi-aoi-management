use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, RwLock};

use crate::loi::LoiNganHang;

type TaiKhoan = Arc<Mutex<u64>>;

pub struct NganHang {
    /// RwLock cho danh bạ tài khoản; mỗi tài khoản một Mutex riêng.
    tai_khoan: RwLock<HashMap<u32, TaiKhoan>>,
}

fn khoa(tk: &TaiKhoan) -> MutexGuard<'_, u64> {
    tk.lock().unwrap_or_else(|e| e.into_inner())
}

/// Số dư có đủ để lấy ra `so_tien` không.
fn kiem_du(id: u32, so_du: u64, so_tien: u64) -> Result<(), LoiNganHang> {
    if so_du < so_tien {
        return Err(LoiNganHang::KhongDuTien { id, so_du, can: so_tien });
    }
    Ok(())
}

impl NganHang {
    pub fn moi() -> NganHang {
        NganHang { tai_khoan: RwLock::new(HashMap::new()) }
    }

    fn lay(&self, id: u32) -> Result<TaiKhoan, LoiNganHang> {
        let bang = self.tai_khoan.read().unwrap_or_else(|e| e.into_inner());
        bang.get(&id).cloned().ok_or(LoiNganHang::KhongCoTaiKhoan(id))
    }

    pub fn mo_tai_khoan(&self, id: u32, so_du: u64) -> Result<(), LoiNganHang> {
        let mut bang = self.tai_khoan.write().unwrap_or_else(|e| e.into_inner());
        if bang.contains_key(&id) {
            return Err(LoiNganHang::TaiKhoanDaCo(id));
        }
        bang.insert(id, Arc::new(Mutex::new(so_du)));
        Ok(())
    }

    pub fn so_du(&self, id: u32) -> Result<u64, LoiNganHang> {
        let tk = self.lay(id)?;
        let g = khoa(&tk);
        Ok(*g)
    }

    pub fn nap(&self, id: u32, so_tien: u64) -> Result<u64, LoiNganHang> {
        if so_tien == 0 {
            return Err(LoiNganHang::SoTienKhongHopLe);
        }
        let tk = self.lay(id)?;
        let mut g = khoa(&tk);
        *g = g.checked_add(so_tien).ok_or(LoiNganHang::TranSo(id))?;
        Ok(*g)
    }

    pub fn rut(&self, id: u32, so_tien: u64) -> Result<u64, LoiNganHang> {
        if so_tien == 0 {
            return Err(LoiNganHang::SoTienKhongHopLe);
        }
        let tk = self.lay(id)?;
        let mut g = khoa(&tk);
        kiem_du(id, *g, so_tien)?;
        *g -= so_tien;
        Ok(*g)
    }

    pub fn chuyen(&self, tu: u32, den: u32, so_tien: u64) -> Result<(), LoiNganHang> {
        if so_tien == 0 {
            return Err(LoiNganHang::SoTienKhongHopLe);
        }
        if tu == den {
            return Err(LoiNganHang::CungTaiKhoan);
        }
        let a = self.lay(tu)?;
        let b = self.lay(den)?;
        // Khoá theo thứ tự id TĂNG dần ⇒ không thể có chu trình chờ (deadlock).
        let (mut g_tu, mut g_den) = if tu < den {
            let x = khoa(&a);
            let y = khoa(&b);
            (x, y)
        } else {
            let y = khoa(&b);
            let x = khoa(&a);
            (x, y)
        };
        kiem_du(tu, *g_tu, so_tien)?;
        let moi = g_den.checked_add(so_tien).ok_or(LoiNganHang::TranSo(den))?;
        *g_tu -= so_tien;
        *g_den = moi;
        Ok(())
    }

    pub fn tong_tien(&self) -> u128 {
        // Giữ khoá đọc danh bạ + khoá MỌI tài khoản theo id tăng dần cùng lúc ⇒ ảnh chụp nhất quán.
        let bang = self.tai_khoan.read().unwrap_or_else(|e| e.into_inner());
        let mut ids: Vec<&u32> = bang.keys().collect();
        ids.sort_unstable();
        let khoa_het: Vec<MutexGuard<'_, u64>> = ids.iter().map(|id| khoa(&bang[*id])).collect();
        khoa_het.iter().map(|g| **g as u128).sum()
    }
}
