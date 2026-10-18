package bai

import "fmt"

// GioHang giữ danh mục hàng và số lượng từng mã trong giỏ.
type GioHang struct {
	danhMuc map[string]MatHang
	soLuong map[string]int
}

func MoiGioHang(danhMuc []MatHang) *GioHang {
	g := &GioHang{danhMuc: make(map[string]MatHang, len(danhMuc)), soLuong: make(map[string]int)}
	for _, m := range danhMuc {
		g.danhMuc[m.Ma] = m
	}
	return g
}

func (g *GioHang) Them(ma string, soLuong int) error {
	if _, co := g.danhMuc[ma]; !co {
		return fmt.Errorf("%q: %w", ma, ErrKhongCoHang)
	}
	if soLuong <= 0 {
		return fmt.Errorf("them %d: %w", soLuong, ErrSoLuong)
	}
	g.soLuong[ma] += soLuong
	return nil
}

func (g *GioHang) Bot(ma string, soLuong int) error {
	hienCo, co := g.soLuong[ma]
	if !co {
		return fmt.Errorf("%q khong co trong gio: %w", ma, ErrKhongCoHang)
	}
	if soLuong <= 0 || soLuong > hienCo {
		return fmt.Errorf("bot %d / %d: %w", soLuong, hienCo, ErrSoLuong)
	}
	if soLuong == hienCo {
		delete(g.soLuong, ma)
	} else {
		g.soLuong[ma] = hienCo - soLuong
	}
	return nil
}
