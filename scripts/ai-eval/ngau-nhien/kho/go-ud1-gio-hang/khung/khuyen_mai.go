package bai

import "errors"

// TinhTien áp khuyến mãi, tính thuế và lập hoá đơn cho giỏ hiện tại.
func (g *GioHang) TinhTien(km []KhuyenMai) (HoaDon, error) {
	return HoaDon{}, errors.New("chua lam")
}
