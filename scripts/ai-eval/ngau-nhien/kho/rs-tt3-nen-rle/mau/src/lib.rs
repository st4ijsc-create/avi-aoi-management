#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoiRle {
    ThieuKyTu { vi_tri: usize },
    SoKhongHopLe { vi_tri: usize },
    ThoatSai { vi_tri: usize },
}

/// Độ dài tối đa của MỘT lượt (một số đếm) trong dạng nén.
pub const LUOT_TOI_DA: usize = 1_000_000;

/// Ký tự phải viết dạng `\c` trong dữ liệu nén: chữ số ASCII và chính dấu `\`.
fn can_thoat(c: char) -> bool {
    c == '\\' || c.is_ascii_digit()
}

fn ghi_luot(ra: &mut String, c: char, so: usize) {
    if so >= 2 {
        ra.push_str(&so.to_string());
    }
    if can_thoat(c) {
        ra.push('\\');
    }
    ra.push(c);
}

pub fn nen(s: &str) -> String {
    let mut ra = String::new();
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        let mut dai = 1usize;
        while it.peek() == Some(&c) {
            it.next();
            dai += 1;
        }
        while dai > 0 {
            let phan = dai.min(LUOT_TOI_DA);
            ghi_luot(&mut ra, c, phan);
            dai -= phan;
        }
    }
    ra
}

pub fn giai_nen(s: &str) -> Result<String, LoiRle> {
    let ky: Vec<char> = s.chars().collect();
    let n = ky.len();
    let mut ra = String::new();
    let mut i = 0usize;
    while i < n {
        // 1. số đếm (tuỳ chọn)
        let mut so = 1usize;
        if ky[i].is_ascii_digit() {
            let dau = i;
            if ky[i] == '0' {
                return Err(LoiRle::SoKhongHopLe { vi_tri: dau });
            }
            let mut gia_tri: usize = 0;
            while i < n && ky[i].is_ascii_digit() {
                let chu_so = ky[i] as usize - '0' as usize;
                gia_tri = gia_tri.saturating_mul(10).saturating_add(chu_so);
                i += 1;
            }
            if !(2..=LUOT_TOI_DA).contains(&gia_tri) {
                return Err(LoiRle::SoKhongHopLe { vi_tri: dau });
            }
            so = gia_tri;
        }
        // 2. ký tự (có thể thoát)
        if i >= n {
            return Err(LoiRle::ThieuKyTu { vi_tri: n });
        }
        let c = if ky[i] == '\\' {
            if i + 1 >= n {
                return Err(LoiRle::ThieuKyTu { vi_tri: n });
            }
            let sau = ky[i + 1];
            if !can_thoat(sau) {
                return Err(LoiRle::ThoatSai { vi_tri: i });
            }
            i += 2;
            sau
        } else {
            i += 1;
            ky[i - 1]
        };
        ra.extend(std::iter::repeat(c).take(so));
    }
    Ok(ra)
}
