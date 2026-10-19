package bai

import (
	"errors"
	"testing"
)

func danhMucMau() []MatHang {
	return []MatHang{
		{Ma: "gao", Ten: "Gao ST25 1kg", Nhom: NhomThucPham, DonGia: 25_000},
		{Ma: "sua", Ten: "Sua tuoi 1l", Nhom: NhomThucPham, DonGia: 32_500},
		{Ma: "keo", Ten: "Keo lac", Nhom: NhomThucPham, DonGia: 1_010},
		{Ma: "banh", Ten: "Banh quy", Nhom: NhomThucPham, DonGia: 1_010},
		{Ma: "tai-nghe", Ten: "Tai nghe", Nhom: NhomDienTu, DonGia: 199_000},
		{Ma: "sac", Ten: "Cu sac", Nhom: NhomDienTu, DonGia: 89_900},
		{Ma: "truyen", Ten: "Truyen tranh", Nhom: NhomSach, DonGia: 45_000},
	}
}

func phaiThem(t *testing.T, g *GioHang, ma string, sl int) {
	t.Helper()
	if err := g.Them(ma, sl); err != nil {
		t.Fatalf("Them(%q, %d): %v", ma, sl, err)
	}
}

func TestKhongKhuyenMai(t *testing.T) {
	g := MoiGioHang(danhMucMau())
	phaiThem(t, g, "gao", 2)
	phaiThem(t, g, "truyen", 1)
	hd, err := g.TinhTien(nil)
	if err != nil {
		t.Fatal(err)
	}
	if hd.TamTinh != 95_000 || hd.Thue != 2_500 || hd.GiamHang != 0 || hd.GiamDon != 0 || hd.TongCong != 97_500 {
		t.Fatalf("hd = %+v", hd)
	}
}

func TestLoiThem(t *testing.T) {
	g := MoiGioHang(danhMucMau())
	if err := g.Them("xyz", 1); !errors.Is(err, ErrKhongCoHang) {
		t.Fatalf("ma la: %v", err)
	}
	if err := g.Them("gao", 0); !errors.Is(err, ErrSoLuong) {
		t.Fatalf("so luong 0: %v", err)
	}
}

func TestPhanTramKhongTran(t *testing.T) {
	g := MoiGioHang(danhMucMau())
	phaiThem(t, g, "tai-nghe", 1)
	hd, err := g.TinhTien([]KhuyenMai{PhanTram{PhanTram: 10}})
	if err != nil {
		t.Fatal(err)
	}
	if hd.Thue != 19_900 || hd.GiamDon != 19_900 || hd.TongCong != 199_000 {
		t.Fatalf("hd = %+v", hd)
	}
}
