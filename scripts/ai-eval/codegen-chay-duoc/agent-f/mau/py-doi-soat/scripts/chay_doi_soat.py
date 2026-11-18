"""CLI đối soát tồn kho: python scripts/chay_doi_soat.py <so_sach.csv> <kiem_ke.csv> [--out <tệp>]."""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from doi_soat import dinh_dang, doc_ton, so_khop  # noqa: E402


def main(argv=None):
    p = argparse.ArgumentParser(prog="chay_doi_soat")
    p.add_argument("so_sach")
    p.add_argument("kiem_ke")
    p.add_argument("--out")
    a = p.parse_args(argv)
    try:
        ds = so_khop(doc_ton(a.so_sach), doc_ton(a.kiem_ke))
    except (OSError, ValueError) as e:
        sys.stderr.write(f"Lỗi: {e}\n")
        return 2
    bc = dinh_dang(ds)
    if a.out:
        Path(a.out).write_text(bc, encoding="utf-8")
        sys.stdout.write(f"Đã ghi báo cáo {len(ds)} dòng chênh ra {a.out}\n")
    else:
        sys.stdout.write(bc)
    return 1 if ds else 0


if __name__ == "__main__":
    sys.exit(main())
