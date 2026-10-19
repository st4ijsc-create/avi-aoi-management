import json

from bao_cao_csv.cli import main

CSV_DON_GIAN = "nhom,gia\na,1\nb,2\na,3\n"


def test_xuat_json(tmp_path, capsys):
    tep = tmp_path / "du_lieu.csv"
    tep.write_text(CSV_DON_GIAN, encoding="utf-8")
    assert main([str(tep), "--nhom", "nhom", "--cot-so", "gia", "--dinh-dang", "json"]) == 0
    ra = capsys.readouterr()
    assert json.loads(ra.out) == [
        {"nhom": "a", "so_dong": 2, "tong": "4.00", "trung_binh": "2.00"},
        {"nhom": "b", "so_dong": 1, "tong": "2.00", "trung_binh": "2.00"},
    ]
    assert ra.err == ""


def test_xuat_bang_mac_dinh(tmp_path, capsys):
    tep = tmp_path / "du_lieu.csv"
    tep.write_text(CSV_DON_GIAN, encoding="utf-8")
    assert main([str(tep), "--nhom", "nhom", "--cot-so", "gia"]) == 0
    assert capsys.readouterr().out == (
        "nhom | so_dong | tong | trung_binh\n"
        "-----+---------+------+-----------\n"
        "a    |       2 | 4.00 |       2.00\n"
        "b    |       1 | 2.00 |       2.00\n"
    )


def test_tep_khong_ton_tai(tmp_path, capsys):
    ma = main([str(tmp_path / "khong_co.csv"), "--nhom", "nhom", "--cot-so", "gia"])
    ra = capsys.readouterr()
    assert ma == 1
    assert ra.out == ""
    assert ra.err.startswith("loi: khong mo duoc tep: ")
