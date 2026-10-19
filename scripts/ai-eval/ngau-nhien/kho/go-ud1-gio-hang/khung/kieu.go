package bai

import "errors"

// TỆP NÀY CHO SẴN — không sửa. Mọi số tiền là int64 đồng.

type NhomHang string

const (
	NhomThucPham NhomHang = "thuc-pham"
	NhomDienTu   NhomHang = "dien-tu"
	NhomSach     NhomHang = "sach"
)

// ThueSuat: thuế suất phần trăm (số nguyên) theo nhóm hàng.
var ThueSuat = map[NhomHang]int64{
	NhomThucPham: 5,
	NhomDienTu:   10,
	NhomSach:     0,
}

type MatHang struct {
	Ma     string
	Ten    string
	Nhom   NhomHang
	DonGia int64
}

var (
	ErrKhongCoHang = errors.New("khong co mat hang")
	ErrSoLuong     = errors.New("so luong khong hop le")
	ErrKhuyenMai   = errors.New("khuyen mai khong hop le")
)

// KhuyenMai là một trong ba kiểu: PhanTram, MuaXTangY, TheoNguong.
type KhuyenMai interface{ laKhuyenMai() }

// PhanTram giảm PhanTram% (1..100) tiền hàng, tối đa Tran đồng (Tran == 0: không có trần; Tran < 0: không hợp lệ).
type PhanTram struct {
	PhanTram int64
	Tran     int64
}

// MuaXTangY: với mặt hàng MaHang, cứ mỗi trọn nhóm X+Y đơn vị thì Y đơn vị được miễn phí (X >= 1, Y >= 1).
type MuaXTangY struct {
	MaHang string
	X, Y   int
}

// TheoNguong: tiền hàng đạt ít nhất Nguong thì giảm Giam đồng (Nguong >= 0, Giam >= 0).
type TheoNguong struct {
	Nguong int64
	Giam   int64
}

func (PhanTram) laKhuyenMai()   {}
func (MuaXTangY) laKhuyenMai()  {}
func (TheoNguong) laKhuyenMai() {}

type HoaDon struct {
	TamTinh      int64              // Σ đơn giá × số lượng, trước mọi giảm
	GiamHang     int64              // tổng giảm do MuaXTangY
	ThueTheoNhom map[NhomHang]int64 // thuế từng nhóm có mặt trong giỏ
	Thue         int64              // Σ ThueTheoNhom
	GiamDon      int64              // giảm phần trăm + giảm theo ngưỡng
	TongCong     int64              // TamTinh - GiamHang + Thue - GiamDon
}
