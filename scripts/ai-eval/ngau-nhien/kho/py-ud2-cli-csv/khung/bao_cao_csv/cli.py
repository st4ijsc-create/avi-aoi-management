import argparse


def tao_parser():
    p = argparse.ArgumentParser(prog="bao_cao_csv", description="Tổng hợp một cột số của tệp CSV theo nhóm.")
    p.add_argument("tep", help="đường tệp CSV")
    p.add_argument("--nhom", required=True, help="tên cột dùng để nhóm")
    p.add_argument("--cot-so", required=True, help="tên cột số cần tổng hợp")
    p.add_argument("--dinh-dang", choices=["bang", "json"], default="bang")
    p.add_argument("--sap-xep", choices=["ten", "tong"], default="ten")
    return p


def main(argv):
    raise NotImplementedError
