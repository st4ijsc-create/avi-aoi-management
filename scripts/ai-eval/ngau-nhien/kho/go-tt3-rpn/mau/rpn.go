package bai

import (
	"errors"
	"math"
	"strconv"
	"strings"
)

func laToanTu(s string) bool {
	return s == "+" || s == "-" || s == "*" || s == "/" || s == "%"
}

// tinh thực hiện a op b; ok=false kèm loại lỗi khi chia 0 hoặc tràn.
func tinh(a, b int64, op string) (int64, LoaiLoi) {
	switch op {
	case "+":
		if (b > 0 && a > math.MaxInt64-b) || (b < 0 && a < math.MinInt64-b) {
			return 0, LoiTranSo
		}
		return a + b, 0
	case "-":
		if (b < 0 && a > math.MaxInt64+b) || (b > 0 && a < math.MinInt64+b) {
			return 0, LoiTranSo
		}
		return a - b, 0
	case "*":
		if a == 0 || b == 0 {
			return 0, 0
		}
		if (a == -1 && b == math.MinInt64) || (b == -1 && a == math.MinInt64) {
			return 0, LoiTranSo
		}
		r := a * b
		if r/b != a {
			return 0, LoiTranSo
		}
		return r, 0
	case "/":
		if b == 0 {
			return 0, LoiChiaKhong
		}
		if a == math.MinInt64 && b == -1 {
			return 0, LoiTranSo
		}
		return a / b, 0
	default: // "%"
		if b == 0 {
			return 0, LoiChiaKhong
		}
		if b == -1 {
			return 0, 0
		}
		return a % b, 0
	}
}

func TinhRPN(bieuThuc string) (int64, error) {
	token := strings.Fields(bieuThuc)
	if len(token) == 0 {
		return 0, &LoiRPN{ViTri: 0, Loai: LoiThieuToanHang}
	}
	ngan := make([]int64, 0, len(token))
	for i, tk := range token {
		if laToanTu(tk) {
			if len(ngan) < 2 {
				return 0, &LoiRPN{ViTri: i, Loai: LoiThieuToanHang, Token: tk}
			}
			a, b := ngan[len(ngan)-2], ngan[len(ngan)-1]
			ngan = ngan[:len(ngan)-2]
			r, loai := tinh(a, b, tk)
			if loai != 0 {
				return 0, &LoiRPN{ViTri: i, Loai: loai, Token: tk}
			}
			ngan = append(ngan, r)
			continue
		}
		so, err := strconv.ParseInt(tk, 10, 64)
		if err != nil {
			if errors.Is(err, strconv.ErrRange) {
				return 0, &LoiRPN{ViTri: i, Loai: LoiTranSo, Token: tk}
			}
			return 0, &LoiRPN{ViTri: i, Loai: LoiTokenLa, Token: tk}
		}
		ngan = append(ngan, so)
	}
	if len(ngan) > 1 {
		return 0, &LoiRPN{ViTri: len(token), Loai: LoiDuToanHang}
	}
	return ngan[0], nil
}

func uuTien(op byte) int {
	if op == '*' || op == '/' || op == '%' {
		return 2
	}
	return 1
}

func ChuyenTrungTo(bieuThuc string) (string, error) {
	var ra []string
	type phanTu struct {
		kyTu  byte
		viTri int
	}
	var ngan []phanTu
	for i := 0; i < len(bieuThuc); {
		c := bieuThuc[i]
		switch {
		case c == ' ' || c == '\t':
			i++
		case c >= '0' && c <= '9':
			j := i
			for j < len(bieuThuc) && bieuThuc[j] >= '0' && bieuThuc[j] <= '9' {
				j++
			}
			ra = append(ra, bieuThuc[i:j])
			i = j
		case strings.IndexByte("+-*/%", c) >= 0:
			for len(ngan) > 0 {
				dinh := ngan[len(ngan)-1].kyTu
				if dinh == '(' || uuTien(dinh) < uuTien(c) {
					break
				}
				ra = append(ra, string(dinh))
				ngan = ngan[:len(ngan)-1]
			}
			ngan = append(ngan, phanTu{c, i})
			i++
		case c == '(':
			ngan = append(ngan, phanTu{c, i})
			i++
		case c == ')':
			for len(ngan) > 0 && ngan[len(ngan)-1].kyTu != '(' {
				ra = append(ra, string(ngan[len(ngan)-1].kyTu))
				ngan = ngan[:len(ngan)-1]
			}
			if len(ngan) == 0 {
				return "", &LoiRPN{ViTri: i, Loai: LoiNgoac, Token: ")"}
			}
			ngan = ngan[:len(ngan)-1]
			i++
		default:
			return "", &LoiRPN{ViTri: i, Loai: LoiTokenLa, Token: string(c)}
		}
	}
	for len(ngan) > 0 {
		p := ngan[len(ngan)-1]
		if p.kyTu == '(' {
			return "", &LoiRPN{ViTri: p.viTri, Loai: LoiNgoac, Token: "("}
		}
		ra = append(ra, string(p.kyTu))
		ngan = ngan[:len(ngan)-1]
	}
	return strings.Join(ra, " "), nil
}
