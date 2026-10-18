use std::cmp::Reverse;
use std::collections::BinaryHeap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoiDoThi {
    DinhKhongHopLe { canh: usize },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThuGon {
    pub thanh_phan: Vec<Vec<usize>>,
    pub thuoc: Vec<usize>,
    pub canh: Vec<(usize, usize)>,
    pub thu_tu_topo: Vec<usize>,
}

const CHUA_THAM: usize = usize::MAX;

fn danh_sach_ke(n: usize, canh: &[(usize, usize)]) -> Result<Vec<Vec<usize>>, LoiDoThi> {
    let mut ke = vec![Vec::new(); n];
    for (i, &(u, v)) in canh.iter().enumerate() {
        if u >= n || v >= n {
            return Err(LoiDoThi::DinhKhongHopLe { canh: i });
        }
        ke[u].push(v);
    }
    Ok(ke)
}

/// Tarjan KHÔNG đệ quy: ngăn xếp lời gọi tường minh (đỉnh, vị trí cạnh kế tiếp).
fn tarjan(ke: &[Vec<usize>]) -> Vec<Vec<usize>> {
    let n = ke.len();
    let mut chi_so = vec![CHUA_THAM; n];
    let mut low = vec![0usize; n];
    let mut tren_ngan = vec![false; n];
    let mut ngan: Vec<usize> = Vec::new();
    let mut goi: Vec<(usize, usize)> = Vec::new();
    let mut dem = 0usize;
    let mut kq: Vec<Vec<usize>> = Vec::new();

    for goc in 0..n {
        if chi_so[goc] != CHUA_THAM {
            continue;
        }
        chi_so[goc] = dem;
        low[goc] = dem;
        dem += 1;
        ngan.push(goc);
        tren_ngan[goc] = true;
        goi.push((goc, 0));
        while let Some(dinh) = goi.last_mut() {
            let v = dinh.0;
            if dinh.1 < ke[v].len() {
                let w = ke[v][dinh.1];
                dinh.1 += 1;
                if chi_so[w] == CHUA_THAM {
                    chi_so[w] = dem;
                    low[w] = dem;
                    dem += 1;
                    ngan.push(w);
                    tren_ngan[w] = true;
                    goi.push((w, 0));
                } else if tren_ngan[w] {
                    low[v] = low[v].min(chi_so[w]);
                }
            } else {
                goi.pop();
                if let Some(&(cha, _)) = goi.last() {
                    low[cha] = low[cha].min(low[v]);
                }
                if low[v] == chi_so[v] {
                    let mut tp = Vec::new();
                    loop {
                        let x = ngan.pop().expect("ngăn xếp Tarjan");
                        tren_ngan[x] = false;
                        tp.push(x);
                        if x == v {
                            break;
                        }
                    }
                    kq.push(tp);
                }
            }
        }
    }
    for tp in kq.iter_mut() {
        tp.sort_unstable();
    }
    kq.sort_unstable_by_key(|tp| tp[0]);
    kq
}

pub fn thanh_phan_manh(n: usize, canh: &[(usize, usize)]) -> Result<Vec<Vec<usize>>, LoiDoThi> {
    let ke = danh_sach_ke(n, canh)?;
    Ok(tarjan(&ke))
}

pub fn thu_gon(n: usize, canh: &[(usize, usize)]) -> Result<ThuGon, LoiDoThi> {
    let ke = danh_sach_ke(n, canh)?;
    let thanh_phan = tarjan(&ke);
    let mut thuoc = vec![0usize; n];
    for (i, tp) in thanh_phan.iter().enumerate() {
        for &v in tp {
            thuoc[v] = i;
        }
    }
    let mut canh_gon: Vec<(usize, usize)> = canh
        .iter()
        .map(|&(u, v)| (thuoc[u], thuoc[v]))
        .filter(|&(a, b)| a != b)
        .collect();
    canh_gon.sort_unstable();
    canh_gon.dedup();

    // Kahn, luôn lấy thành phần sẵn sàng có chỉ số NHỎ NHẤT.
    let k = thanh_phan.len();
    let mut bac_vao = vec![0usize; k];
    let mut ra: Vec<Vec<usize>> = vec![Vec::new(); k];
    for &(a, b) in &canh_gon {
        bac_vao[b] += 1;
        ra[a].push(b);
    }
    let mut san_sang: BinaryHeap<Reverse<usize>> = (0..k).filter(|&i| bac_vao[i] == 0).map(Reverse).collect();
    let mut thu_tu_topo = Vec::with_capacity(k);
    while let Some(Reverse(a)) = san_sang.pop() {
        thu_tu_topo.push(a);
        for &b in &ra[a] {
            bac_vao[b] -= 1;
            if bac_vao[b] == 0 {
                san_sang.push(Reverse(b));
            }
        }
    }
    Ok(ThuGon { thanh_phan, thuoc, canh: canh_gon, thu_tu_topo })
}
