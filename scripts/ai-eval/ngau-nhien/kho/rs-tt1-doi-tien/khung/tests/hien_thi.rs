use bai::{dem_so_cach, it_dong_nhat, LoiMenhGia};

#[test]
fn doi_co_ban() {
    assert_eq!(it_dong_nhat(&[1, 2, 5], 11), Ok(Some(vec![1, 5, 5])));
    assert_eq!(dem_so_cach(&[1, 2, 5], 5), Ok(4));
}

#[test]
fn khong_doi_duoc() {
    assert_eq!(it_dong_nhat(&[2], 3), Ok(None));
    assert_eq!(dem_so_cach(&[2], 3), Ok(0));
}

#[test]
fn menh_gia_loi() {
    assert_eq!(it_dong_nhat(&[], 4), Err(LoiMenhGia::Rong));
    assert_eq!(dem_so_cach(&[1, 0], 4), Err(LoiMenhGia::BangKhong));
}
