use std::collections::HashMap;

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
        let con: &'a str = &self.nguon[self.vi_tri..];
        match con.char_indices().find(|&(_, c)| c.is_alphanumeric()) {
            None => {
                self.vi_tri = self.nguon.len();
                None
            }
            Some((bat_dau, _)) => {
                let sau = &con[bat_dau..];
                let dai = sau.char_indices().find(|&(_, c)| !c.is_alphanumeric()).map_or(sau.len(), |(i, _)| i);
                self.vi_tri += bat_dau + dai;
                Some(&sau[..dai])
            }
        }
    }
}

/// Khoá so sánh không phân biệt hoa thường (Unicode đầy đủ).
fn khoa(tu: &str) -> String {
    tu.to_lowercase()
}

pub fn tu_pho_bien<'a>(s: &'a str, k: usize) -> Vec<(&'a str, usize)> {
    // khoá ⇒ (số lần, thứ tự xuất hiện đầu, lát cắt gốc lần đầu)
    let mut dem: HashMap<String, (usize, usize, &'a str)> = HashMap::new();
    for (i, tu) in TachTu::moi(s).enumerate() {
        dem.entry(khoa(tu)).and_modify(|m| m.0 += 1).or_insert((1, i, tu));
    }
    let mut ds: Vec<(usize, usize, &'a str)> = dem.into_values().collect();
    ds.sort_by(|x, y| y.0.cmp(&x.0).then(x.1.cmp(&y.1)));
    ds.into_iter().take(k).map(|(n, _, tu)| (tu, n)).collect()
}

pub fn tu_dai_nhat<'a>(s: &'a str) -> Option<&'a str> {
    let mut tot: Option<(&'a str, usize)> = None;
    for tu in TachTu::moi(s) {
        let n = tu.chars().count();
        if tot.map_or(true, |(_, m)| n > m) {
            tot = Some((tu, n));
        }
    }
    tot.map(|(tu, _)| tu)
}

pub fn dong_chua<'a>(van_ban: &'a str, tu: &str) -> Vec<(usize, &'a str)> {
    let can_tim = khoa(tu);
    van_ban
        .lines()
        .enumerate()
        .filter(|(_, dong)| TachTu::moi(dong).any(|w| khoa(w) == can_tim))
        .map(|(i, dong)| (i + 1, dong))
        .collect()
}
