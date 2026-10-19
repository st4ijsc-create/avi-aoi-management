package bai

import "fmt"

func kiemKhuyenMai(km []KhuyenMai) error {
	for i, k := range km {
		hopLe := true
		switch v := k.(type) {
		case PhanTram:
			hopLe = v.PhanTram >= 1 && v.PhanTram <= 100 && v.Tran >= 0
		case MuaXTangY:
			hopLe = v.X >= 1 && v.Y >= 1
		case TheoNguong:
			hopLe = v.Nguong >= 0 && v.Giam >= 0
		default:
			hopLe = false
		}
		if !hopLe {
			return fmt.Errorf("khuyen mai %d (%+v): %w", i, k, ErrKhuyenMai)
		}
	}
	return nil
}

// TinhTien áp khuyến mãi, tính thuế và lập hoá đơn cho giỏ hiện tại.
func (g *GioHang) TinhTien(km []KhuyenMai) (HoaDon, error) {
	if err := kiemKhuyenMai(km); err != nil {
		return HoaDon{}, err
	}
	hd := HoaDon{ThueTheoNhom: map[NhomHang]int64{}}

	// Bước 1: MuaXTangY theo từng dòng; mỗi mã chỉ áp một khuyến mãi cho nhiều đơn vị miễn phí nhất.
	tienNhom := map[NhomHang]int64{}
	for ma, sl := range g.soLuong {
		mh := g.danhMuc[ma]
		mienPhi := 0
		for _, k := range km {
			if m, ok := k.(MuaXTangY); ok && m.MaHang == ma {
				mienPhi = max(mienPhi, sl/(m.X+m.Y)*m.Y)
			}
		}
		hd.TamTinh += mh.DonGia * int64(sl)
		hd.GiamHang += mh.DonGia * int64(mienPhi)
		tienNhom[mh.Nhom] += mh.DonGia * int64(sl-mienPhi)
	}

	// Thuế theo nhóm trên tiền sau bước 1, làm tròn nửa lên.
	for nhom, tien := range tienNhom {
		thue := (tien*ThueSuat[nhom] + 50) / 100
		hd.ThueTheoNhom[nhom] = thue
		hd.Thue += thue
	}

	// Bước 2: một mã phần trăm cho mức giảm lớn nhất (làm tròn xuống, có trần).
	b1 := hd.TamTinh - hd.GiamHang
	var giamPT int64
	for _, k := range km {
		if p, ok := k.(PhanTram); ok {
			giam := b1 * p.PhanTram / 100
			if p.Tran > 0 && giam > p.Tran {
				giam = p.Tran
			}
			giamPT = max(giamPT, giam)
		}
	}

	// Bước 3: ngưỡng lớn nhất mà tiền sau bước 2 đạt được.
	b2 := b1 - giamPT
	var giamNg int64
	coNguong := false
	var nguongChon int64
	for _, k := range km {
		if n, ok := k.(TheoNguong); ok && b2 >= n.Nguong && (!coNguong || n.Nguong > nguongChon) {
			coNguong, nguongChon, giamNg = true, n.Nguong, min(n.Giam, b2)
		}
	}

	hd.GiamDon = giamPT + giamNg
	hd.TongCong = b1 + hd.Thue - hd.GiamDon
	return hd, nil
}
