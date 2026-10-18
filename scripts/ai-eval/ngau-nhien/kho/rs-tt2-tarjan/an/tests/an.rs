use bai::{thanh_phan_manh, thu_gon, LoiDoThi, ThuGon};

const N: usize = 100_000;

#[test]
fn do_thi_rong() {
    assert_eq!(thanh_phan_manh(0, &[]), Ok(Vec::<Vec<usize>>::new()));
    assert_eq!(
        thu_gon(0, &[]),
        Ok(ThuGon { thanh_phan: vec![], thuoc: vec![], canh: vec![], thu_tu_topo: vec![] })
    );
}

#[test]
fn loi_canh_dau_tien_va_thu_gon() {
    assert_eq!(thanh_phan_manh(2, &[(0, 5), (7, 0)]), Err(LoiDoThi::DinhKhongHopLe { canh: 0 }));
    assert_eq!(thu_gon(2, &[(0, 1), (1, 0), (2, 0)]), Err(LoiDoThi::DinhKhongHopLe { canh: 2 }));
    assert_eq!(thu_gon(0, &[(0, 0)]), Err(LoiDoThi::DinhKhongHopLe { canh: 0 }));
}

#[test]
fn canh_khuyen_va_canh_lap() {
    let canh = [(0, 0), (0, 1), (0, 1), (1, 2), (2, 1), (2, 1)];
    let g = thu_gon(3, &canh).unwrap();
    assert_eq!(g.thanh_phan, vec![vec![0], vec![1, 2]]);
    assert_eq!(g.thuoc, vec![0, 1, 1]);
    assert_eq!(g.canh, vec![(0, 1)]);
    assert_eq!(g.thu_tu_topo, vec![0, 1]);
}

#[test]
fn canh_cheo_toi_thanh_phan_da_xong() {
    // DFS từ 0 xong {0,1}; sau đó 2 có cạnh sang 1 (đã xong, không còn trên ngăn xếp)
    let canh = [(0, 1), (1, 0), (2, 1), (2, 3), (3, 2)];
    assert_eq!(thanh_phan_manh(4, &canh), Ok(vec![vec![0, 1], vec![2, 3]]));
    let g = thu_gon(4, &canh).unwrap();
    assert_eq!(g.canh, vec![(1, 0)]);
    assert_eq!(g.thu_tu_topo, vec![1, 0]);
}

#[test]
fn ba_thanh_phan_kinh_dien() {
    let canh = [(0, 1), (1, 2), (2, 0), (2, 3), (3, 4), (4, 5), (5, 3), (6, 5), (6, 7), (7, 6)];
    assert_eq!(
        thu_gon(8, &canh),
        Ok(ThuGon {
            thanh_phan: vec![vec![0, 1, 2], vec![3, 4, 5], vec![6, 7]],
            thuoc: vec![0, 0, 0, 1, 1, 1, 2, 2],
            canh: vec![(0, 1), (2, 1)],
            thu_tu_topo: vec![0, 2, 1],
        })
    );
}

#[test]
fn topo_lay_chi_so_nho_nhat_san_sang() {
    let g = thu_gon(5, &[(4, 0), (3, 1), (1, 0)]).unwrap();
    assert_eq!(g.thanh_phan, vec![vec![0], vec![1], vec![2], vec![3], vec![4]]);
    assert_eq!(g.canh, vec![(1, 0), (3, 1), (4, 0)]);
    assert_eq!(g.thu_tu_topo, vec![2, 3, 1, 4, 0]);
}

#[test]
fn chuoi_dai_khong_tran_ngan_xep() {
    let canh: Vec<(usize, usize)> = (0..N - 1).map(|i| (i, i + 1)).collect();
    let g = thu_gon(N, &canh).unwrap();
    assert_eq!(g.thanh_phan.len(), N);
    assert!(g.thanh_phan.iter().enumerate().all(|(i, tp)| tp == &vec![i]));
    assert_eq!(g.canh.len(), N - 1);
    assert_eq!(g.thu_tu_topo, (0..N).collect::<Vec<_>>());
}

#[test]
fn chuoi_nguoc_dai() {
    let canh: Vec<(usize, usize)> = (0..N - 1).map(|i| (i + 1, i)).collect();
    let g = thu_gon(N, &canh).unwrap();
    assert_eq!(g.thuoc, (0..N).collect::<Vec<_>>());
    assert_eq!(g.canh[0], (1, 0));
    assert_eq!(g.canh[N - 2], (N - 1, N - 2));
    assert_eq!(g.thu_tu_topo, (0..N).rev().collect::<Vec<_>>());
}

#[test]
fn chu_trinh_lon_mot_thanh_phan() {
    let canh: Vec<(usize, usize)> = (0..N).map(|i| (i, (i + 1) % N)).collect();
    let tp = thanh_phan_manh(N, &canh).unwrap();
    assert_eq!(tp.len(), 1);
    assert_eq!(tp[0], (0..N).collect::<Vec<_>>());
    let g = thu_gon(N, &canh).unwrap();
    assert!(g.canh.is_empty());
    assert_eq!(g.thu_tu_topo, vec![0]);
}

#[test]
fn cap_noi_tiep_dai() {
    // (2k <-> 2k+1) và 2k+1 -> 2k+2
    let mut canh = Vec::new();
    for k in 0..N / 2 {
        canh.push((2 * k + 1, 2 * k));
        canh.push((2 * k, 2 * k + 1));
        if 2 * k + 2 < N {
            canh.push((2 * k + 1, 2 * k + 2));
        }
    }
    let g = thu_gon(N, &canh).unwrap();
    assert_eq!(g.thanh_phan.len(), N / 2);
    assert_eq!(g.thanh_phan[123], vec![246, 247]);
    assert_eq!(g.thuoc[N - 1], N / 2 - 1);
    assert_eq!(g.canh, (0..N / 2 - 1).map(|k| (k, k + 1)).collect::<Vec<_>>());
    assert_eq!(g.thu_tu_topo, (0..N / 2).collect::<Vec<_>>());
}
