use bai::{dong_chua, tu_dai_nhat, tu_pho_bien, TachTu};

fn nam_trong(con: &str, cha: &str) -> bool {
    let (p, q) = (con.as_ptr() as usize, cha.as_ptr() as usize);
    q <= p && p + con.len() <= q + cha.len()
}

#[test]
fn tach_unicode_va_dau_cau() {
    let s = "Xin chào, thế-giới! 123abc  ";
    let tu: Vec<&str> = TachTu::moi(s).collect();
    assert_eq!(tu, ["Xin", "chào", "thế", "giới", "123abc"]);
    assert!(tu.iter().all(|w| nam_trong(w, s)));
    assert_eq!(TachTu::moi(s).map(|w| w.chars().count()).sum::<usize>(), 3 + 4 + 3 + 4 + 6);
}

#[test]
fn tach_khong_co_tu() {
    assert_eq!(TachTu::moi("").next(), None);
    assert_eq!(TachTu::moi("  ,.!  ").count(), 0);
    let mut it = TachTu::moi("don't");
    assert_eq!(it.next(), Some("don"));
    assert_eq!(it.next(), Some("t"));
    assert_eq!(it.next(), None);
    assert_eq!(it.next(), None);
}

#[test]
fn tra_lat_cat_goc_lan_dau() {
    let s = String::from("Mèo mèo MÈO");
    let kq = tu_pho_bien(&s, 1);
    assert_eq!(kq, vec![("Mèo", 3)]);
    assert!(std::ptr::eq(kq[0].0.as_ptr(), s.as_ptr()));
    let t = String::from("x CHÓ chó");
    let kq = tu_pho_bien(&t, 5);
    assert_eq!(kq, vec![("CHÓ", 2), ("x", 1)]);
    assert!(std::ptr::eq(kq[0].0.as_ptr(), t[2..].as_ptr()));
}

#[test]
fn khong_phan_biet_hoa_unicode() {
    assert_eq!(tu_pho_bien("ĐÀ NẴNG đà nẵng Đà", 3), vec![("ĐÀ", 3), ("NẴNG", 2)]);
    assert_eq!(tu_pho_bien("Ärger ärger ÄRGER", 1), vec![("Ärger", 3)]);
}

#[test]
fn hoa_so_lan_theo_vi_tri_dau() {
    assert_eq!(tu_pho_bien("b a c a b c d", 10), vec![("b", 2), ("a", 2), ("c", 2), ("d", 1)]);
    assert_eq!(tu_pho_bien("b a c a b c d", 2), vec![("b", 2), ("a", 2)]);
    assert_eq!(tu_pho_bien("z y x", 3), vec![("z", 1), ("y", 1), ("x", 1)]);
}

#[test]
fn k_bang_khong_va_van_ban_rong() {
    assert!(tu_pho_bien("a a b", 0).is_empty());
    assert!(tu_pho_bien("", 3).is_empty());
    assert!(tu_pho_bien("?! ...", 3).is_empty());
}

#[test]
fn dai_nhat_dem_theo_ky_tu() {
    assert_eq!(tu_dai_nhat("đường abcd"), Some("đường"));
    assert_eq!(tu_dai_nhat("đường abcdef"), Some("abcdef"));
    assert_eq!(tu_dai_nhat("ab cd ef"), Some("ab"));
    assert_eq!(tu_dai_nhat(""), None);
    assert_eq!(tu_dai_nhat("!! --"), None);
}

#[test]
fn dong_chua_tu_nguyen_ven() {
    let van_ban = String::from("Một dòng\nhai Dòng nữa\r\nba dòngx\n\nDÒNG cuối");
    let kq = {
        let tu = String::from("DÒNG");
        dong_chua(&van_ban, &tu)
    };
    assert_eq!(kq, vec![(1, "Một dòng"), (2, "hai Dòng nữa"), (5, "DÒNG cuối")]);
    assert!(kq.iter().all(|(_, d)| nam_trong(d, &van_ban)));
    assert!(dong_chua(&van_ban, "").is_empty());
    assert!(dong_chua(&van_ban, "khong").is_empty());
}
