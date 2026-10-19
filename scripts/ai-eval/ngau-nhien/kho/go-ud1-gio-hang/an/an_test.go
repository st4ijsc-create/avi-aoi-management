package bai

import (
	"errors"
	"reflect"
	"testing"
)

func gioCo(t *testing.T, hang map[string]int) *GioHang {
	t.Helper()
	g := MoiGioHang(danhMucMau())
	for ma, sl := range hang {
		phaiThem(t, g, ma, sl)
	}
	return g
}

func tinh(t *testing.T, g *GioHang, km ...KhuyenMai) HoaDon {
	t.Helper()
	hd, err := g.TinhTien(km)
	if err != nil {
		t.Fatalf("TinhTien(%v): %v", km, err)
	}
	return hd
}

func TestAnMuaXTangY(t *testing.T) {
	hd := tinh(t, gioCo(t, map[string]int{"sua": 7}), MuaXTangY{MaHang: "sua", X: 2, Y: 1}, MuaXTangY{MaHang: "gao", X: 1, Y: 1})
	want := HoaDon{TamTinh: 227_500, GiamHang: 65_000, ThueTheoNhom: map[NhomHang]int64{NhomThucPham: 8_125}, Thue: 8_125, TongCong: 170_625}
	if !reflect.DeepEqual(hd, want) {
		t.Fatalf("hd = %+v; muon %+v", hd, want)
	}
	if hd := tinh(t, gioCo(t, map[string]int{"sua": 2}), MuaXTangY{MaHang: "sua", X: 2, Y: 1}); hd.GiamHang != 0 {
		t.Fatalf("2 hop sua chua du nhom 3: %+v", hd)
	}
}

func TestAnTranPhanTram(t *testing.T) {
	hd := tinh(t, gioCo(t, map[string]int{"tai-nghe": 2, "sac": 1}), PhanTram{PhanTram: 20, Tran: 50_000})
	if hd.TamTinh != 487_900 || hd.Thue != 48_790 || hd.GiamDon != 50_000 || hd.TongCong != 486_690 {
		t.Fatalf("hd = %+v", hd)
	}
}

func TestAnChonPhanTramLonNhat(t *testing.T) {
	hd := tinh(t, gioCo(t, map[string]int{"gao": 4}), PhanTram{PhanTram: 10}, PhanTram{PhanTram: 30, Tran: 20_000})
	if hd.GiamDon != 20_000 || hd.TongCong != 85_000 {
		t.Fatalf("hd = %+v", hd)
	}
	hd = tinh(t, gioCo(t, map[string]int{"gao": 4}), PhanTram{PhanTram: 100})
	if hd.GiamDon != 100_000 || hd.Thue != 5_000 || hd.TongCong != 5_000 {
		t.Fatalf("100%%: hd = %+v", hd)
	}
	hd = tinh(t, gioCo(t, map[string]int{"sac": 1}), PhanTram{PhanTram: 33})
	if hd.GiamDon != 29_667 {
		t.Fatalf("33%% cua 89_900 lam tron xuong: hd = %+v", hd)
	}
}

func TestAnNguong(t *testing.T) {
	nguong := []KhuyenMai{TheoNguong{Nguong: 100_000, Giam: 15_000}, TheoNguong{Nguong: 50_000, Giam: 5_000}, TheoNguong{Nguong: 200_000, Giam: 50_000}}
	hd := tinh(t, gioCo(t, map[string]int{"gao": 4}), nguong...)
	if hd.GiamDon != 15_000 || hd.TongCong != 90_000 {
		t.Fatalf("dung nguong 100_000: hd = %+v", hd)
	}
	hd = tinh(t, gioCo(t, map[string]int{"gao": 4}), append(nguong, PhanTram{PhanTram: 1})...)
	if hd.GiamDon != 6_000 || hd.TongCong != 99_000 {
		t.Fatalf("sau phan tram con 99_000: hd = %+v", hd)
	}
	hd = tinh(t, gioCo(t, map[string]int{"gao": 4}), TheoNguong{Nguong: 50_000, Giam: 5_000}, TheoNguong{Nguong: 50_000, Giam: 8_000})
	if hd.GiamDon != 5_000 {
		t.Fatalf("hoa nguong lay cai dung truoc: hd = %+v", hd)
	}
}

func TestAnGiamKhongAm(t *testing.T) {
	hd := tinh(t, gioCo(t, map[string]int{"truyen": 1}), TheoNguong{Nguong: 0, Giam: 1_000_000})
	if hd.GiamDon != 45_000 || hd.TongCong != 0 {
		t.Fatalf("hd = %+v", hd)
	}
	hd = tinh(t, gioCo(t, map[string]int{"truyen": 2}), MuaXTangY{MaHang: "truyen", X: 1, Y: 1}, TheoNguong{Nguong: 45_000, Giam: 60_000})
	if hd.GiamHang != 45_000 || hd.GiamDon != 45_000 || hd.TongCong != 0 {
		t.Fatalf("hd = %+v", hd)
	}
}

func TestAnLamTronThue(t *testing.T) {
	ca := []struct {
		hang     map[string]int
		thue     int64
		tongCong int64
	}{
		{map[string]int{"keo": 1}, 51, 1_061},
		{map[string]int{"keo": 1, "banh": 1}, 101, 2_121},
		{map[string]int{"keo": 3}, 152, 3_182},
		{map[string]int{"sac": 1}, 8_990, 98_890},
	}
	for _, c := range ca {
		hd := tinh(t, gioCo(t, c.hang))
		if hd.Thue != c.thue || hd.TongCong != c.tongCong {
			t.Errorf("%v: Thue=%d TongCong=%d; muon %d, %d", c.hang, hd.Thue, hd.TongCong, c.thue, c.tongCong)
		}
	}
}

func TestAnBotVaThem(t *testing.T) {
	g := gioCo(t, map[string]int{"gao": 1})
	phaiThem(t, g, "gao", 2)
	if hd := tinh(t, g); hd.TamTinh != 75_000 {
		t.Fatalf("Them cong don: %+v", hd)
	}
	if err := g.Bot("gao", 1); err != nil || tinh(t, g).TamTinh != 50_000 {
		t.Fatalf("Bot 1: %v", err)
	}
	if err := g.Bot("gao", 2); err != nil {
		t.Fatalf("Bot het: %v", err)
	}
	if hd := tinh(t, g); hd.TamTinh != 0 || len(hd.ThueTheoNhom) != 0 || hd.TongCong != 0 {
		t.Fatalf("gio rong: %+v", hd)
	}
	if err := g.Bot("gao", 1); !errors.Is(err, ErrKhongCoHang) {
		t.Fatalf("Bot ma da het: %v", err)
	}
	phaiThem(t, g, "gao", 2)
	for _, sl := range []int{5, 0, -1} {
		if err := g.Bot("gao", sl); !errors.Is(err, ErrSoLuong) {
			t.Fatalf("Bot %d: %v", sl, err)
		}
	}
	if tinh(t, g).TamTinh != 50_000 {
		t.Fatalf("Bot loi van lam doi gio")
	}
	if err := g.Bot("xyz", 1); !errors.Is(err, ErrKhongCoHang) {
		t.Fatalf("Bot ma la: %v", err)
	}
	if err := g.Them("gao", -3); !errors.Is(err, ErrSoLuong) {
		t.Fatalf("Them -3: %v", err)
	}
	if err := g.Them("xyz", 0); !errors.Is(err, ErrKhongCoHang) {
		t.Fatalf("Them ma la so luong 0 phai bao ma truoc: %v", err)
	}
}

func TestAnKhuyenMaiKhongHopLe(t *testing.T) {
	g := gioCo(t, map[string]int{"gao": 3})
	sai := []KhuyenMai{
		PhanTram{PhanTram: 0}, PhanTram{PhanTram: 101}, PhanTram{PhanTram: 10, Tran: -1},
		MuaXTangY{MaHang: "gao", X: 0, Y: 1}, MuaXTangY{MaHang: "gao", X: 1, Y: 0},
		TheoNguong{Nguong: -1, Giam: 0}, TheoNguong{Nguong: 0, Giam: -1}, nil,
	}
	for _, k := range sai {
		hd, err := g.TinhTien([]KhuyenMai{PhanTram{PhanTram: 5}, k})
		if !errors.Is(err, ErrKhuyenMai) || !reflect.DeepEqual(hd, HoaDon{}) {
			t.Errorf("%#v: hd=%+v err=%v", k, hd, err)
		}
	}
	if _, err := g.TinhTien([]KhuyenMai{PhanTram{PhanTram: 100}, MuaXTangY{MaHang: "khong-co", X: 1, Y: 1}, TheoNguong{}}); err != nil {
		t.Fatalf("khuyen mai bien hop le bi tu choi: %v", err)
	}
}

func TestAnMuaXTangYChonTotNhat(t *testing.T) {
	hd := tinh(t, gioCo(t, map[string]int{"sua": 10}),
		MuaXTangY{MaHang: "sua", X: 2, Y: 1}, MuaXTangY{MaHang: "sua", X: 4, Y: 2}, MuaXTangY{MaHang: "sua", X: 1, Y: 1})
	if hd.GiamHang != 162_500 || hd.Thue != 8_125 || hd.TongCong != 170_625 {
		t.Fatalf("hd = %+v", hd)
	}
}

func TestAnTongHop(t *testing.T) {
	hd := tinh(t, gioCo(t, map[string]int{"gao": 6, "tai-nghe": 1}),
		TheoNguong{Nguong: 200_000, Giam: 10_000}, MuaXTangY{MaHang: "gao", X: 2, Y: 1},
		PhanTram{PhanTram: 10, Tran: 15_000}, TheoNguong{Nguong: 250_000, Giam: 20_000})
	want := HoaDon{
		TamTinh: 349_000, GiamHang: 50_000,
		ThueTheoNhom: map[NhomHang]int64{NhomThucPham: 5_000, NhomDienTu: 19_900}, Thue: 24_900,
		GiamDon: 35_000, TongCong: 288_900,
	}
	if !reflect.DeepEqual(hd, want) {
		t.Fatalf("hd = %+v; muon %+v", hd, want)
	}
}

func TestAnThueTheoNhomDayDu(t *testing.T) {
	hd := tinh(t, gioCo(t, map[string]int{"gao": 1, "tai-nghe": 1, "truyen": 2}))
	want := HoaDon{
		TamTinh:      314_000,
		ThueTheoNhom: map[NhomHang]int64{NhomThucPham: 1_250, NhomDienTu: 19_900, NhomSach: 0},
		Thue:         21_150,
		TongCong:     335_150,
	}
	if !reflect.DeepEqual(hd, want) {
		t.Fatalf("hd = %+v; muon %+v", hd, want)
	}
	rong := tinh(t, MoiGioHang(danhMucMau()))
	if rong.TamTinh != 0 || rong.Thue != 0 || rong.TongCong != 0 || len(rong.ThueTheoNhom) != 0 {
		t.Fatalf("gio rong: %+v", rong)
	}
}
