package bai

import "errors"

var ErrKhongTuyetDoi = errors.New("duong dan khong tuyet doi")

func ChuanHoa(p string) string {
	panic("chua lam")
}

func DuongTuongDoi(goc, dich string) (string, error) {
	return "", errors.New("chua lam")
}
