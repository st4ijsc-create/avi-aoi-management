package bai

import "errors"

// GioHang giữ danh mục hàng và số lượng từng mã trong giỏ.
type GioHang struct{}

func MoiGioHang(danhMuc []MatHang) *GioHang {
	return &GioHang{}
}

func (g *GioHang) Them(ma string, soLuong int) error {
	return errors.New("chua lam")
}

func (g *GioHang) Bot(ma string, soLuong int) error {
	return errors.New("chua lam")
}
