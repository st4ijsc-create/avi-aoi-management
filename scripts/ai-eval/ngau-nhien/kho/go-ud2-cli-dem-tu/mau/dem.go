package bai

import (
	"bufio"
	"io"
	"sort"
	"strings"
	"unicode"
)

func laKyTuTu(r rune) bool { return unicode.IsLetter(r) || unicode.IsDigit(r) }

// DemTu đếm số lần xuất hiện của từng từ đọc từ r.
func DemTu(r io.Reader, tc TuyChon) (map[string]int, error) {
	chuanHoa := func(s string) string {
		if tc.KhongPhanBietHoa {
			return strings.ToLower(s)
		}
		return s
	}
	dung := make(map[string]bool, len(tc.BoQua))
	for _, w := range tc.BoQua {
		dung[chuanHoa(w)] = true
	}
	dem := make(map[string]int)
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 16<<20)
	for sc.Scan() {
		for _, tu := range strings.FieldsFunc(sc.Text(), func(c rune) bool { return !laKyTuTu(c) }) {
			tu = chuanHoa(tu)
			if !dung[tu] {
				dem[tu]++
			}
		}
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	return dem, nil
}

// XepHang trả tối đa n mục, nhiều lần nhất trước.
func XepHang(dem map[string]int, n int) []DemMuc {
	ds := make([]DemMuc, 0, len(dem))
	for tu, sl := range dem {
		ds = append(ds, DemMuc{tu, sl})
	}
	sort.Slice(ds, func(i, j int) bool {
		if ds[i].SoLan != ds[j].SoLan {
			return ds[i].SoLan > ds[j].SoLan
		}
		return ds[i].Tu < ds[j].Tu
	})
	if n < 0 {
		n = 0
	}
	if n < len(ds) {
		ds = ds[:n]
	}
	return ds
}
