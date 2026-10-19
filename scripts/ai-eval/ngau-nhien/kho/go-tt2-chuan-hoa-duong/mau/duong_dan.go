package bai

import (
	"errors"
	"fmt"
	"strings"
)

var ErrKhongTuyetDoi = errors.New("duong dan khong tuyet doi")

func ChuanHoa(p string) string {
	tuyetDoi := strings.HasPrefix(p, "/")
	var ngan []string
	for _, phan := range strings.Split(p, "/") {
		switch phan {
		case "", ".":
		case "..":
			if len(ngan) > 0 && ngan[len(ngan)-1] != ".." {
				ngan = ngan[:len(ngan)-1]
			} else if !tuyetDoi {
				ngan = append(ngan, "..")
			}
		default:
			ngan = append(ngan, phan)
		}
	}
	kq := strings.Join(ngan, "/")
	if tuyetDoi {
		return "/" + kq
	}
	if kq == "" {
		return "."
	}
	return kq
}

func tachPhan(p string) []string {
	if p == "/" {
		return nil
	}
	return strings.Split(p[1:], "/")
}

func DuongTuongDoi(goc, dich string) (string, error) {
	if !strings.HasPrefix(goc, "/") || !strings.HasPrefix(dich, "/") {
		return "", fmt.Errorf("goc=%q dich=%q: %w", goc, dich, ErrKhongTuyetDoi)
	}
	a, b := tachPhan(ChuanHoa(goc)), tachPhan(ChuanHoa(dich))
	i := 0
	for i < len(a) && i < len(b) && a[i] == b[i] {
		i++
	}
	kq := make([]string, 0, len(a)-i+len(b)-i)
	for range a[i:] {
		kq = append(kq, "..")
	}
	kq = append(kq, b[i:]...)
	if len(kq) == 0 {
		return ".", nil
	}
	return strings.Join(kq, "/"), nil
}
