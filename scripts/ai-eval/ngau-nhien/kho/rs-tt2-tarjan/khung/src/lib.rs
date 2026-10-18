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

pub fn thanh_phan_manh(_n: usize, _canh: &[(usize, usize)]) -> Result<Vec<Vec<usize>>, LoiDoThi> {
    todo!()
}

pub fn thu_gon(_n: usize, _canh: &[(usize, usize)]) -> Result<ThuGon, LoiDoThi> {
    todo!()
}
