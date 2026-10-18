use bai::{tu_dai_nhat, tu_pho_bien, TachTu};

#[test]
fn tach_tu_co_ban() {
    let tu: Vec<&str> = TachTu::moi("Hello, world! hello").collect();
    assert_eq!(tu, ["Hello", "world", "hello"]);
}

#[test]
fn pho_bien_co_ban() {
    assert_eq!(tu_pho_bien("the cat the dog THE cat", 2), vec![("the", 3), ("cat", 2)]);
}

#[test]
fn dai_nhat_co_ban() {
    assert_eq!(tu_dai_nhat("a bbb cc"), Some("bbb"));
}
