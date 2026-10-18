use bai::{dem_so_cach, it_dong_nhat, LoiMenhGia};

#[test]
fn so_tien_bang_khong() {
    assert_eq!(it_dong_nhat(&[7], 0), Ok(Some(vec![])));
    assert_eq!(dem_so_cach(&[7], 0), Ok(1));
    assert_eq!(dem_so_cach(&[3, 1], 0), Ok(1));
}

#[test]
fn menh_gia_trung_va_thu_tu_kiem() {
    assert_eq!(it_dong_nhat(&[5, 3, 5, 3], 8), Err(LoiMenhGia::Trung(3)));
    assert_eq!(dem_so_cach(&[4, 4], 8), Err(LoiMenhGia::Trung(4)));
    assert_eq!(it_dong_nhat(&[2, 2, 0], 4), Err(LoiMenhGia::BangKhong));
    assert_eq!(dem_so_cach(&[], 0), Err(LoiMenhGia::Rong));
    assert_eq!(it_dong_nhat(&[9, 9], 0), Err(LoiMenhGia::Trung(9)));
}

#[test]
fn tham_lam_khong_toi_uu() {
    assert_eq!(it_dong_nhat(&[1, 3, 4], 6), Ok(Some(vec![3, 3])));
    assert_eq!(dem_so_cach(&[1, 3, 4], 6), Ok(4));
}

#[test]
fn pha_hoa_lay_danh_sach_nho_nhat() {
    // 11 = 1+5+5 = 2+2+7 (đều 3 đồng) ⇒ [1,5,5] < [2,2,7]
    assert_eq!(it_dong_nhat(&[1, 2, 5, 7], 11), Ok(Some(vec![1, 5, 5])));
    // 13 = 1+6+6 = 2+2+9
    assert_eq!(it_dong_nhat(&[9, 2, 6, 1], 13), Ok(Some(vec![1, 6, 6])));
    // 22 = 1+7+7+7 = 2+2+9+9
    assert_eq!(it_dong_nhat(&[9, 7, 2, 1], 22), Ok(Some(vec![1, 7, 7, 7])));
    assert_eq!(dem_so_cach(&[9, 7, 2, 1], 22), Ok(40));
}

#[test]
fn dau_vao_chua_sap_xep() {
    assert_eq!(it_dong_nhat(&[5, 1, 2], 11), Ok(Some(vec![1, 5, 5])));
    assert_eq!(dem_so_cach(&[5, 2, 1], 5), Ok(4));
}

#[test]
fn frobenius_6_10_15() {
    assert_eq!(it_dong_nhat(&[6, 10, 15], 29), Ok(None));
    assert_eq!(it_dong_nhat(&[15, 10, 6], 30), Ok(Some(vec![15, 15])));
    assert_eq!(it_dong_nhat(&[6, 10, 15], 31), Ok(Some(vec![6, 10, 15])));
    assert_eq!(dem_so_cach(&[6, 10, 15], 31), Ok(1));
    assert_eq!(it_dong_nhat(&[6, 10, 15], 1), Ok(None));
}

#[test]
fn so_tien_lon() {
    let kq = it_dong_nhat(&[13, 7], 100_000).unwrap().unwrap();
    assert_eq!(kq.len(), 7696);
    assert!(kq[..8].iter().all(|&c| c == 7));
    assert!(kq[8..].iter().all(|&c| c == 13));
    assert_eq!(dem_so_cach(&[7, 13], 100_000), Ok(1099));
}

#[test]
fn dem_tien_xu_anh() {
    assert_eq!(dem_so_cach(&[200, 100, 50, 20, 10, 5, 2, 1], 200), Ok(73682));
}

#[test]
fn dem_vuot_u64() {
    let mg: Vec<u32> = (1..=1000).collect();
    assert_eq!(dem_so_cach(&mg, 1000), Ok(24061467864032622473692149727991u128));
}
