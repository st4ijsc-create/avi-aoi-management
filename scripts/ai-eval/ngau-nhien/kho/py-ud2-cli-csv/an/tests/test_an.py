import json
from decimal import Decimal

from bao_cao_csv.cli import main
from bao_cao_csv.tong_hop import tong_hop


def ghi(tmp_path, noi_dung, bom=False):
    tep = tmp_path / "vao.csv"
    tep.write_bytes((b"\xef\xbb\xbf" if bom else b"") + noi_dung.encode("utf-8"))
    return str(tep)


def test_bom_va_o_co_dau_phay_trong_nhay(tmp_path, capsys):
    tep = ghi(tmp_path, 'khu_vuc,san_pham,doanh_thu\r\n"Hà Nội, Q1",bút,"1200.50"\r\nĐà Nẵng,vở,300\r\n'
                       '"Hà Nội, Q1",thước,99.5\r\n', bom=True)
    assert main([tep, "--nhom", "khu_vuc", "--cot-so", "doanh_thu", "--dinh-dang", "json"]) == 0
    ra = capsys.readouterr()
    assert ra.err == ""
    assert json.loads(ra.out) == [
        {"nhom": "Hà Nội, Q1", "so_dong": 2, "tong": "1300.00", "trung_binh": "650.00"},
        {"nhom": "Đà Nẵng", "so_dong": 1, "tong": "300.00", "trung_binh": "300.00"},
    ]


CSV_BANG = "nhom,gia\nb,1\na,2.5\nb,10\na,0.25\nccc,-3\n"


def test_bang_do_rong_cot_va_lam_tron_half_up(tmp_path, capsys):
    assert main([ghi(tmp_path, CSV_BANG), "--nhom", "nhom", "--cot-so", "gia", "--dinh-dang", "bang"]) == 0
    assert capsys.readouterr().out == (
        "nhom | so_dong |  tong | trung_binh\n"
        "-----+---------+-------+-----------\n"
        "a    |       2 |  2.75 |       1.38\n"
        "b    |       2 | 11.00 |       5.50\n"
        "ccc  |       1 | -3.00 |      -3.00\n"
    )


def test_sap_xep_theo_tong(tmp_path, capsys):
    tep = ghi(tmp_path, CSV_BANG + "dd,13.75\n")
    assert main([tep, "--nhom", "nhom", "--cot-so", "gia", "--sap-xep", "tong", "--dinh-dang", "json"]) == 0
    assert [(n["nhom"], n["tong"]) for n in json.loads(capsys.readouterr().out)] == [
        ("dd", "13.75"), ("b", "11.00"), ("a", "2.75"), ("ccc", "-3.00")]


def test_canh_bao_ban_ghi_hong_ra_stderr(tmp_path, capsys):
    tep = ghi(tmp_path, 'loai,so_tien\nx,10\ny,abc\nx,"1,5"\n\nz\ny,1e3\nx, 7 \n,,\ny,-2.50\ny,+5\n')
    assert main([tep, "--nhom", "loai", "--cot-so", "so_tien", "--dinh-dang", "json"]) == 0
    ra = capsys.readouterr()
    assert ra.err.splitlines() == [
        "canh bao: ban ghi 3: gia tri 'abc' khong phai so",
        "canh bao: ban ghi 4: gia tri '1,5' khong phai so",
        "canh bao: ban ghi 6: thieu cot",
        "canh bao: ban ghi 7: gia tri '1e3' khong phai so",
        "canh bao: ban ghi 11: gia tri '+5' khong phai so",
    ]
    assert json.loads(ra.out) == [
        {"nhom": "x", "so_dong": 2, "tong": "17.00", "trung_binh": "8.50"},
        {"nhom": "y", "so_dong": 1, "tong": "-2.50", "trung_binh": "-2.50"},
    ]


def test_loi_nghiem_trong_ma_thoat_1(tmp_path, capsys):
    rong = tmp_path / "rong.csv"
    rong.write_bytes(b"")
    chi_bom = tmp_path / "chi_bom.csv"
    chi_bom.write_bytes(b"\xef\xbb\xbf")
    co_du_lieu = ghi(tmp_path, "a,b\n1,2\n")
    for argv, loi in [
        ([str(rong), "--nhom", "a", "--cot-so", "b"], "loi: tep rong\n"),
        ([str(chi_bom), "--nhom", "a", "--cot-so", "b"], "loi: tep rong\n"),
        ([co_du_lieu, "--nhom", "c", "--cot-so", "d"], "loi: khong co cot 'c'\n"),
        ([co_du_lieu, "--nhom", "a", "--cot-so", "gia"], "loi: khong co cot 'gia'\n"),
        ([str(tmp_path / "mat.csv"), "--nhom", "a", "--cot-so", "b"], f"loi: khong mo duoc tep: {tmp_path / 'mat.csv'}\n"),
    ]:
        assert main(argv) == 1, argv
        ra = capsys.readouterr()
        assert (ra.out, ra.err) == ("", loi)


def test_loi_tham_so_tra_2_khong_nem(tmp_path, capsys):
    tep = ghi(tmp_path, "a,b\n1,2\n")
    assert main([tep, "--cot-so", "b"]) == 2
    assert "usage" in capsys.readouterr().err
    assert main([tep, "--nhom", "a", "--cot-so", "b", "--dinh-dang", "xml"]) == 2
    assert main([]) == 2
    assert capsys.readouterr().out == ""


def test_khong_co_nhom_hop_le(tmp_path, capsys):
    tep = ghi(tmp_path, "nhom,gia\na,x\n")
    assert main([tep, "--nhom", "nhom", "--cot-so", "gia"]) == 0
    assert capsys.readouterr().out == (
        "nhom | so_dong | tong | trung_binh\n"
        "-----+---------+------+-----------\n"
    )
    assert main([tep, "--nhom", "nhom", "--cot-so", "gia", "--dinh-dang", "json"]) == 0
    assert json.loads(capsys.readouterr().out) == []


def test_tieu_de_co_khoang_trang_va_o_nhieu_dong(tmp_path, capsys):
    tep = ghi(tmp_path, ' ten , gia ,mo_ta\na,1,"dòng 1\ndòng 2"\na,2,x\nb,oops,y\n Dài hơn ,1.005,z\n')
    assert main([tep, "--nhom", "ten", "--cot-so", "gia"]) == 0
    ra = capsys.readouterr()
    assert ra.err == "canh bao: ban ghi 4: gia tri 'oops' khong phai so\n"
    assert ra.out == (
        "ten     | so_dong | tong | trung_binh\n"
        "--------+---------+------+-----------\n"
        "Dài hơn |       1 | 1.01 |       1.01\n"
        "a       |       2 | 3.00 |       1.50\n"
    )


def test_tong_hop_truc_tiep():
    kq = tong_hop([("b", Decimal("2")), ("a", Decimal("1.5")), ("a", Decimal("0.5")), ("c", Decimal("-1"))], "tong")
    assert kq == [
        {"nhom": "a", "so_dong": 2, "tong": Decimal("2"), "trung_binh": Decimal("1")},
        {"nhom": "b", "so_dong": 1, "tong": Decimal("2"), "trung_binh": Decimal("2")},
        {"nhom": "c", "so_dong": 1, "tong": Decimal("-1"), "trung_binh": Decimal("-1")},
    ]
    assert [n["nhom"] for n in tong_hop([("b", Decimal("1")), ("a", Decimal("5"))])] == ["a", "b"]
    assert tong_hop([]) == []
