use std::collections::HashMap;
use std::rc::Rc;

use crate::dong_ho::DongHo;
use crate::loi::{LoiKho, TrangThai};

struct DatCho {
    ma: String,
    so_luong: u32,
    het_han: u64,
    /// Trạng thái đã ghi (DangGiu/DaXacNhan/DaHuy); HetHan được suy ra từ đồng hồ.
    ghi: TrangThai,
}

pub struct Kho {
    dong_ho: Rc<dyn DongHo>,
    thoi_han_giu: u64,
    ton: HashMap<String, u32>,
    /// đặt chỗ thứ i có id = i + 1
    dat_cho: Vec<DatCho>,
}

impl Kho {
    pub fn moi(dong_ho: Rc<dyn DongHo>, thoi_han_giu: u64) -> Kho {
        Kho { dong_ho, thoi_han_giu, ton: HashMap::new(), dat_cho: Vec::new() }
    }

    fn hien_tai(&self, d: &DatCho) -> TrangThai {
        if d.ghi == TrangThai::DangGiu && self.dong_ho.bay_gio() >= d.het_han {
            TrangThai::HetHan
        } else {
            d.ghi
        }
    }

    fn tim(&self, id: u64) -> Result<usize, LoiKho> {
        if id == 0 || id > self.dat_cho.len() as u64 {
            return Err(LoiKho::KhongCoDatCho(id));
        }
        Ok((id - 1) as usize)
    }

    /// Kiểm số lượng, mặt hàng và số khả dụng chung cho `giu`/`xuat`.
    fn kiem_lay(&self, ma: &str, so_luong: u32) -> Result<(), LoiKho> {
        if so_luong == 0 {
            return Err(LoiKho::SoLuongKhongHopLe);
        }
        if !self.ton.contains_key(ma) {
            return Err(LoiKho::KhongCoHang(ma.to_string()));
        }
        let con = self.kha_dung(ma);
        if so_luong > con {
            return Err(LoiKho::KhongDu { ma: ma.to_string(), can: so_luong, con });
        }
        Ok(())
    }

    pub fn nhap(&mut self, ma: &str, so_luong: u32) -> Result<(), LoiKho> {
        if so_luong == 0 {
            return Err(LoiKho::SoLuongKhongHopLe);
        }
        *self.ton.entry(ma.to_string()).or_insert(0) += so_luong;
        Ok(())
    }

    pub fn ton(&self, ma: &str) -> u32 {
        self.ton.get(ma).copied().unwrap_or(0)
    }

    pub fn dang_giu(&self, ma: &str) -> u32 {
        self.dat_cho
            .iter()
            .filter(|d| d.ma == ma && self.hien_tai(d) == TrangThai::DangGiu)
            .map(|d| d.so_luong)
            .sum()
    }

    pub fn kha_dung(&self, ma: &str) -> u32 {
        self.ton(ma) - self.dang_giu(ma)
    }

    pub fn giu(&mut self, ma: &str, so_luong: u32) -> Result<u64, LoiKho> {
        self.kiem_lay(ma, so_luong)?;
        let het_han = self.dong_ho.bay_gio() + self.thoi_han_giu;
        self.dat_cho.push(DatCho { ma: ma.to_string(), so_luong, het_han, ghi: TrangThai::DangGiu });
        Ok(self.dat_cho.len() as u64)
    }

    /// Đặt chỗ còn hiệu lực ⇒ chỉ số; đã kết thúc ⇒ DaKetThuc.
    fn con_giu(&self, id: u64) -> Result<usize, LoiKho> {
        let i = self.tim(id)?;
        match self.hien_tai(&self.dat_cho[i]) {
            TrangThai::DangGiu => Ok(i),
            trang_thai => Err(LoiKho::DaKetThuc { id, trang_thai }),
        }
    }

    pub fn huy(&mut self, id: u64) -> Result<(), LoiKho> {
        let i = self.con_giu(id)?;
        self.dat_cho[i].ghi = TrangThai::DaHuy;
        Ok(())
    }

    pub fn xac_nhan(&mut self, id: u64) -> Result<(), LoiKho> {
        let i = self.con_giu(id)?;
        let d = &mut self.dat_cho[i];
        d.ghi = TrangThai::DaXacNhan;
        let so_luong = d.so_luong;
        let ma = d.ma.clone();
        *self.ton.get_mut(&ma).expect("mặt hàng của đặt chỗ") -= so_luong;
        Ok(())
    }

    pub fn xuat(&mut self, ma: &str, so_luong: u32) -> Result<(), LoiKho> {
        self.kiem_lay(ma, so_luong)?;
        *self.ton.get_mut(ma).expect("đã kiểm") -= so_luong;
        Ok(())
    }

    pub fn trang_thai(&self, id: u64) -> Option<TrangThai> {
        let i = self.tim(id).ok()?;
        Some(self.hien_tai(&self.dat_cho[i]))
    }
}
