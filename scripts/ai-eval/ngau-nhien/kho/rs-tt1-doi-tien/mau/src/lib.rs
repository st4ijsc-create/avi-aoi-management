#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoiMenhGia {
    Rong,
    BangKhong,
    Trung(u32),
}

/// Kiểm tra bộ mệnh giá; trả về các mệnh giá đã sắp TĂNG dần (kiểu usize để làm chỉ số).
fn chuan_hoa(menh_gia: &[u32]) -> Result<Vec<usize>, LoiMenhGia> {
    if menh_gia.is_empty() {
        return Err(LoiMenhGia::Rong);
    }
    if menh_gia.contains(&0) {
        return Err(LoiMenhGia::BangKhong);
    }
    let mut ds: Vec<u32> = menh_gia.to_vec();
    ds.sort_unstable();
    if let Some(cap) = ds.windows(2).find(|w| w[0] == w[1]) {
        return Err(LoiMenhGia::Trung(cap[0]));
    }
    Ok(ds.into_iter().map(|c| c as usize).collect())
}

const VO_CUC: u32 = u32::MAX;

pub fn it_dong_nhat(menh_gia: &[u32], so_tien: u32) -> Result<Option<Vec<u32>>, LoiMenhGia> {
    let mg = chuan_hoa(menh_gia)?;
    let n = so_tien as usize;
    // dp[x] = số đồng ít nhất để tạo đúng x (VO_CUC nếu không tạo được)
    let mut dp = vec![VO_CUC; n + 1];
    dp[0] = 0;
    for x in 1..=n {
        for &c in &mg {
            if c > x {
                break;
            }
            let truoc = dp[x - c];
            if truoc != VO_CUC && truoc + 1 < dp[x] {
                dp[x] = truoc + 1;
            }
        }
    }
    if dp[n] == VO_CUC {
        return Ok(None);
    }
    // Dựng lại: luôn lấy đồng NHỎ NHẤT còn giữ được tối ưu ⇒ danh sách tăng dần nhỏ nhất theo từ điển.
    let mut kq = Vec::with_capacity(dp[n] as usize);
    let mut x = n;
    while x > 0 {
        let c = mg
            .iter()
            .copied()
            .find(|&c| c <= x && dp[x - c] != VO_CUC && dp[x - c] + 1 == dp[x])
            .expect("dp nhất quán");
        kq.push(c as u32);
        x -= c;
    }
    kq.sort_unstable();
    Ok(Some(kq))
}

pub fn dem_so_cach(menh_gia: &[u32], so_tien: u32) -> Result<u128, LoiMenhGia> {
    let mg = chuan_hoa(menh_gia)?;
    let n = so_tien as usize;
    let mut cach = vec![0u128; n + 1];
    cach[0] = 1;
    for &c in &mg {
        for x in c..=n {
            cach[x] += cach[x - c];
        }
    }
    Ok(cach[n])
}
