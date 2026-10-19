pub struct TachTu<'a> {
    nguon: &'a str,
    vi_tri: usize,
}

impl<'a> TachTu<'a> {
    pub fn moi(s: &'a str) -> TachTu<'a> {
        TachTu { nguon: s, vi_tri: 0 }
    }
}

impl<'a> Iterator for TachTu<'a> {
    type Item = &'a str;

    fn next(&mut self) -> Option<&'a str> {
        let _ = (self.nguon, self.vi_tri);
        todo!()
    }
}

pub fn tu_pho_bien<'a>(_s: &'a str, _k: usize) -> Vec<(&'a str, usize)> {
    todo!()
}

pub fn tu_dai_nhat<'a>(_s: &'a str) -> Option<&'a str> {
    todo!()
}

pub fn dong_chua<'a>(_van_ban: &'a str, _tu: &str) -> Vec<(usize, &'a str)> {
    todo!()
}
