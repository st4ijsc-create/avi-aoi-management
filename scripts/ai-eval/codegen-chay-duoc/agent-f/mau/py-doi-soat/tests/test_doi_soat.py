import pytest

from doi_soat import ChenhLech, dinh_dang, doc_ton, so_khop


def test_doc_ton_cong_don_va_chuan_hoa(tmp_path):
    p = tmp_path / "a.csv"
    p.write_text("ma,ten,so_luong\na1,x,2\n A1 ,x, 3\n", encoding="utf-8")
    assert doc_ton(p) == {"A1": 5}


def test_doc_ton_loi_so_luong(tmp_path):
    p = tmp_path / "a.csv"
    p.write_text("ma,ten,so_luong\nA1,x,hai\n", encoding="utf-8")
    with pytest.raises(ValueError, match="dòng 2"):
        doc_ton(p)


def test_so_khop_bo_dong_bang_nhau():
    assert so_khop({"A": 1, "B": 2}, {"A": 1, "C": 3}) == [ChenhLech("B", 2, 0), ChenhLech("C", 0, 3)]


def test_dinh_dang_rong():
    assert dinh_dang([]) == "MA|SO_SACH|KIEM_KE|CHENH\nTONG|0|0\n"
