from khop_glob import khop


def test_sao_va_hoi():
    assert khop("*.txt", "bao_cao.txt") is True
    assert khop("*.txt", "bao_cao.csv") is False
    assert khop("a?c", "abc") is True
    assert khop("a?c", "ac") is False


def test_lop_ky_tu():
    assert khop("[abc]x", "bx") is True
    assert khop("[abc]x", "dx") is False
    assert khop("[a-c]1", "b1") is True


def test_khop_ca_chuoi():
    assert khop("ab", "abc") is False
    assert khop("", "") is True
    assert khop("*", "") is True
