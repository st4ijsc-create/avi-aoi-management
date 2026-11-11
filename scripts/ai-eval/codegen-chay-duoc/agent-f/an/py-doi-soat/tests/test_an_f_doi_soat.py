"""Test ẩn bài py-doi-soat: gói doi_soat, CLI, lệnh mẫu README chạy thật, test của chính bài làm."""
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path

import pytest

DA = Path(__file__).resolve().parent.parent
# Tiến trình con chạy UTF-8 (đề nêu rõ): mặc định của Python trên Windows khi chuyển hướng là bảng mã máy.
ENV = {**os.environ, "PYTHONUTF8": "1"}
MAU = "MA|SO_SACH|KIEM_KE|CHENH\nA01|15|14|-1\nC03|7|4|-3\nD04|3|0|-3\nE05|0|2|+2\nTONG|4|-5\n"


def chay(*args, cwd=DA):
    return subprocess.run([sys.executable, *args], cwd=cwd, stdin=subprocess.DEVNULL, env=ENV, capture_output=True, text=True, encoding="utf-8", timeout=60)


def csv(tmp_path, ten, noi_dung):
    p = tmp_path / ten
    p.write_text(noi_dung, encoding="utf-8")
    return p


def test_doc_ton_du_lieu_mau():
    from doi_soat import doc_ton

    assert doc_ton(DA / "du_lieu" / "so_sach.csv") == {"A01": 15, "B02": 25, "C03": 7, "D04": 3}
    assert doc_ton(DA / "du_lieu" / "kiem_ke.csv") == {"A01": 14, "B02": 25, "C03": 4, "E05": 2}


def test_doc_ton_thieu_cot(tmp_path):
    from doi_soat import doc_ton

    with pytest.raises(ValueError, match="thiếu cột: so_luong"):
        doc_ton(csv(tmp_path, "a.csv", "ma,ten\nA1,x\n"))


def test_doc_ton_so_luong_hong_bao_dong(tmp_path):
    from doi_soat import doc_ton

    with pytest.raises(ValueError, match="dòng 3"):
        doc_ton(csv(tmp_path, "a.csv", "ma,ten,so_luong\nA1,x,1\nA2,y,1.5\n"))


def test_so_khop_thu_tu_bo_bang_va_mot_phia():
    from doi_soat import so_khop

    ds = so_khop({"B": 2, "A": 5, "C": 1}, {"A": 5, "C": 4, "D": 1})
    assert [(c.ma, c.so_sach, c.kiem_ke, c.chenh) for c in ds] == [("B", 2, 0, -2), ("C", 1, 4, 3), ("D", 0, 1, 1)]
    assert so_khop({}, {}) == []


def test_dinh_dang_dung_tung_ky_tu():
    from doi_soat import dinh_dang, doc_ton, so_khop

    ds = so_khop(doc_ton(DA / "du_lieu" / "so_sach.csv"), doc_ton(DA / "du_lieu" / "kiem_ke.csv"))
    assert dinh_dang(ds) == MAU
    assert dinh_dang([]) == "MA|SO_SACH|KIEM_KE|CHENH\nTONG|0|0\n"


def test_cli_co_chenh_lech():
    r = chay("scripts/chay_doi_soat.py", "du_lieu/so_sach.csv", "du_lieu/kiem_ke.csv")
    assert (r.returncode, r.stdout) == (1, MAU), r.stderr


def test_cli_khop_het(tmp_path):
    p = csv(tmp_path, "a.csv", "ma,ten,so_luong\nA1,x,3\n")
    r = chay("scripts/chay_doi_soat.py", str(p), str(p))
    assert (r.returncode, r.stdout) == (0, "MA|SO_SACH|KIEM_KE|CHENH\nTONG|0|0\n")


def test_cli_out(tmp_path):
    ra = tmp_path / "bc.txt"
    r = chay("scripts/chay_doi_soat.py", "du_lieu/so_sach.csv", "du_lieu/kiem_ke.csv", "--out", str(ra))
    assert r.returncode == 1
    assert r.stdout == f"Đã ghi báo cáo 4 dòng chênh ra {ra}\n"
    assert ra.read_text(encoding="utf-8") == MAU


def test_cli_loi_dau_vao(tmp_path):
    r = chay("scripts/chay_doi_soat.py", str(tmp_path / "khong-co.csv"), "du_lieu/kiem_ke.csv")
    assert r.returncode == 2
    assert r.stdout == ""
    assert r.stderr.startswith("Lỗi: ")


def test_lenh_mau_trong_readme_chay_that():
    md = (DA / "README.md").read_text(encoding="utf-8")
    m = re.search(r"^## Đối soát tồn kho\s*$(.*?)(?=^## |\Z)", md, re.M | re.S)
    assert m, "thiếu mục ## Đối soát tồn kho"
    khoi = re.search(r"```bash\n(.*?)```", m.group(1), re.S)
    assert khoi, "mục thiếu khối ```bash"
    lenh = next(d.strip() for d in khoi.group(1).splitlines() if d.strip())
    phan = shlex.split(lenh)
    assert phan[0] in ("python", "python3"), lenh
    r = chay(*phan[1:])
    assert (r.returncode, r.stdout) == (1, MAU), r.stderr


def test_test_cua_bai_lam_co_va_xanh():
    tep = DA / "tests" / "test_doi_soat.py"
    assert tep.is_file(), "thiếu tests/test_doi_soat.py"
    assert len(re.findall(r"^def test_", tep.read_text(encoding="utf-8"), re.M)) >= 4
    r = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", str(tep)], cwd=DA, stdin=subprocess.DEVNULL, env=ENV, capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stdout[-800:]
