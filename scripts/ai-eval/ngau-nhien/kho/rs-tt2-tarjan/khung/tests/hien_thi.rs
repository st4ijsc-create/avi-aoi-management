use bai::{thanh_phan_manh, thu_gon, LoiDoThi, ThuGon};

#[test]
fn hai_chu_trinh_va_mot_dinh_le() {
    let canh = [(0, 1), (1, 0), (1, 2), (2, 3), (3, 2), (3, 4)];
    assert_eq!(thanh_phan_manh(5, &canh), Ok(vec![vec![0, 1], vec![2, 3], vec![4]]));
    assert_eq!(
        thu_gon(5, &canh),
        Ok(ThuGon {
            thanh_phan: vec![vec![0, 1], vec![2, 3], vec![4]],
            thuoc: vec![0, 0, 1, 1, 2],
            canh: vec![(0, 1), (1, 2)],
            thu_tu_topo: vec![0, 1, 2],
        })
    );
}

#[test]
fn khong_co_canh() {
    assert_eq!(thanh_phan_manh(3, &[]), Ok(vec![vec![0], vec![1], vec![2]]));
}

#[test]
fn canh_ra_ngoai_pham_vi() {
    assert_eq!(thanh_phan_manh(3, &[(0, 1), (1, 3)]), Err(LoiDoThi::DinhKhongHopLe { canh: 1 }));
}
