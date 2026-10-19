package bai

import (
	"errors"
	"io"
)

func (t *ThoiLuong) UnmarshalJSON(b []byte) error {
	return errors.New("chua lam")
}

// DocCauHinh đọc, điền mặc định và xác thực cấu hình JSON.
func DocCauHinh(r io.Reader) (*CauHinh, error) {
	return nil, errors.New("chua lam")
}
