package bai

import (
	"errors"
	"fmt"
	"math"
	"math/big"
	"testing"
)

func kiemLoi(t *testing.T, ten string, err error, loai LoaiLoi, viTri int, token string) {
	t.Helper()
	var l *LoiRPN
	if !errors.As(err, &l) {
		t.Fatalf("%s: err = %v, khong phai *LoiRPN", ten, err)
	}
	if l.Loai != loai || l.ViTri != viTri || l.Token != token {
		t.Fatalf("%s: loi = %+v; muon Loai=%d ViTri=%d Token=%q", ten, *l, loai, viTri, token)
	}
}

func kiemSo(t *testing.T, bt string, want int64) {
	t.Helper()
	if g, err := TinhRPN(bt); err != nil || g != want {
		t.Fatalf("TinhRPN(%q) = %d, %v; muon %d", bt, g, err, want)
	}
}

func TestAnChiaCatVeKhong(t *testing.T) {
	kiemSo(t, "7 2 /", 3)
	kiemSo(t, "-7 2 /", -3)
	kiemSo(t, "-7 2 %", -1)
	kiemSo(t, "7 -2 %", 1)
	kiemSo(t, "+5 -5 -", 10)
	kiemSo(t, "  42\t", 42)
}

func TestAnThieuToanHang(t *testing.T) {
	_, err := TinhRPN("1 +")
	kiemLoi(t, "1 +", err, LoiThieuToanHang, 1, "+")
	_, err = TinhRPN("")
	kiemLoi(t, "rong", err, LoiThieuToanHang, 0, "")
	_, err = TinhRPN(" \t ")
	kiemLoi(t, "khoang trang", err, LoiThieuToanHang, 0, "")
	_, err = TinhRPN("* 1 2")
	kiemLoi(t, "* 1 2", err, LoiThieuToanHang, 0, "*")
}

func TestAnDuToanHang(t *testing.T) {
	g, err := TinhRPN("1 2 3 +")
	kiemLoi(t, "1 2 3 +", err, LoiDuToanHang, 4, "")
	if g != 0 {
		t.Fatalf("gia tri khi loi = %d", g)
	}
}

func TestAnTokenLa(t *testing.T) {
	_, err := TinhRPN("1 2 x")
	kiemLoi(t, "x", err, LoiTokenLa, 2, "x")
	_, err = TinhRPN("1 2 ^")
	kiemLoi(t, "^", err, LoiTokenLa, 2, "^")
	_, err = TinhRPN("1.5 2 +")
	kiemLoi(t, "1.5", err, LoiTokenLa, 0, "1.5")
	_, err = TinhRPN("1 0 / x")
	kiemLoi(t, "loi dau tien", err, LoiChiaKhong, 2, "/")
}

func TestAnTranSo(t *testing.T) {
	tran := []struct {
		bt    string
		viTri int
		token string
	}{
		{"9223372036854775807 1 +", 2, "+"},
		{"-9223372036854775808 1 -", 2, "-"},
		{"9223372036854775807 -1 -", 2, "-"},
		{"4611686018427387904 2 *", 2, "*"},
		{"-9223372036854775808 -1 *", 2, "*"},
		{"-1 -9223372036854775808 *", 2, "*"},
		{"-9223372036854775808 -1 /", 2, "/"},
		{"3037000500 3037000500 *", 2, "*"},
		{"9223372036854775808", 0, "9223372036854775808"},
		{"1 -9223372036854775809 +", 1, "-9223372036854775809"},
	}
	for _, c := range tran {
		g, err := TinhRPN(c.bt)
		kiemLoi(t, c.bt, err, LoiTranSo, c.viTri, c.token)
		if g != 0 {
			t.Fatalf("%q: gia tri khi loi = %d", c.bt, g)
		}
	}
	kiemSo(t, "-4611686018427387904 2 *", math.MinInt64)
	kiemSo(t, "3037000499 3037000499 *", 9223372030926249001)
	kiemSo(t, "-9223372036854775808 -1 %", 0)
	kiemSo(t, "9223372036854775807 -9223372036854775807 +", 0)
}

func TestAnDoiChieuBig(t *testing.T) {
	hat := uint64(7)
	ngau := func() int64 {
		hat = hat*6364136223846793005 + 1442695040888963407
		switch hat >> 61 {
		case 0:
			return math.MaxInt64 - int64(hat>>40%3)
		case 1:
			return math.MinInt64 + int64(hat>>40%3)
		case 2:
			return int64(hat>>40%7) - 3
		case 3:
			return int64(hat>>30%6000000000) - 3000000000
		default:
			return int64(hat)
		}
	}
	gioiHanTren, gioiHanDuoi := big.NewInt(math.MaxInt64), big.NewInt(math.MinInt64)
	for lan := 0; lan < 3000; lan++ {
		a, b := ngau(), ngau()
		op := []string{"+", "-", "*", "/", "%"}[lan%5]
		bt := fmt.Sprintf("%d %d %s", a, b, op)
		g, err := TinhRPN(bt)
		A, B, R := big.NewInt(a), big.NewInt(b), new(big.Int)
		if (op == "/" || op == "%") && b == 0 {
			kiemLoi(t, bt, err, LoiChiaKhong, 2, op)
			continue
		}
		switch op {
		case "+":
			R.Add(A, B)
		case "-":
			R.Sub(A, B)
		case "*":
			R.Mul(A, B)
		case "/":
			R.Quo(A, B)
		case "%":
			R.Rem(A, B)
		}
		if R.Cmp(gioiHanTren) > 0 || R.Cmp(gioiHanDuoi) < 0 {
			kiemLoi(t, bt, err, LoiTranSo, 2, op)
			continue
		}
		if err != nil || g != R.Int64() {
			t.Fatalf("TinhRPN(%q) = %d, %v; muon %s", bt, g, err, R)
		}
	}
}

func TestAnChuyenKetHopTrai(t *testing.T) {
	ca := map[string]string{
		"8-3-2":         "8 3 - 2 -",
		"100/10/5":      "100 10 / 5 /",
		"2*3%4":         "2 3 * 4 %",
		"1+2*3-4/2":     "1 2 3 * + 4 2 / -",
		"((15))":        "15",
		"2*(3+4)*5":     "2 3 4 + * 5 *",
		" 12 %\t5 + 0 ": "12 5 % 0 +",
		"1-(2-3)":       "1 2 3 - -",
	}
	for vao, want := range ca {
		if g, err := ChuyenTrungTo(vao); err != nil || g != want {
			t.Errorf("ChuyenTrungTo(%q) = %q, %v; muon %q", vao, g, err, want)
		}
	}
}

func TestAnChuyenLoi(t *testing.T) {
	g, err := ChuyenTrungTo("(1+2")
	kiemLoi(t, "(1+2", err, LoiNgoac, 0, "(")
	if g != "" {
		t.Fatalf("ket qua khi loi = %q", g)
	}
	_, err = ChuyenTrungTo("1+2)")
	kiemLoi(t, "1+2)", err, LoiNgoac, 3, ")")
	_, err = ChuyenTrungTo("((1)+(2")
	kiemLoi(t, "((1)+(2", err, LoiNgoac, 5, "(")
	_, err = ChuyenTrungTo("1 # 2")
	kiemLoi(t, "1 # 2", err, LoiTokenLa, 2, "#")
	_, err = ChuyenTrungTo("(3)) + (")
	kiemLoi(t, "(3)) + (", err, LoiNgoac, 3, ")")
}

func TestAnVongTron(t *testing.T) {
	ca := map[string]int64{
		"(8-3-2)*(10%4)":    6,
		"100/(2*5)-7%3":     9,
		"2*3+4*5-6/2":       23,
		"((7))-((2))-((1))": 4,
	}
	for vao, want := range ca {
		rpn, err := ChuyenTrungTo(vao)
		if err != nil {
			t.Fatalf("ChuyenTrungTo(%q): %v", vao, err)
		}
		if g, err := TinhRPN(rpn); err != nil || g != want {
			t.Fatalf("TinhRPN(ChuyenTrungTo(%q) = %q) = %d, %v; muon %d", vao, rpn, g, err, want)
		}
	}
}
