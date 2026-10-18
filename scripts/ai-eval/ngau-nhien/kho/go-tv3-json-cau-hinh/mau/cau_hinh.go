package bai

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
)

const giayToiDa = int64(1<<63-1) / int64(time.Second)

func (t *ThoiLuong) UnmarshalJSON(b []byte) error {
	b = bytes.TrimSpace(b)
	if string(b) == "null" {
		return nil
	}
	if len(b) > 0 && b[0] == '"' {
		var s string
		if err := json.Unmarshal(b, &s); err != nil {
			return fmt.Errorf("%w: %v", ErrThoiLuong, err)
		}
		d, err := time.ParseDuration(s)
		if err != nil {
			return fmt.Errorf("%w: %v", ErrThoiLuong, err)
		}
		*t = ThoiLuong(d)
		return nil
	}
	giay, err := strconv.ParseInt(string(b), 10, 64)
	if err != nil {
		return fmt.Errorf("%w: %s khong phai chuoi hay so nguyen giay", ErrThoiLuong, b)
	}
	if giay > giayToiDa || giay < -giayToiDa {
		return fmt.Errorf("%w: %d giay vuot pham vi", ErrThoiLuong, giay)
	}
	*t = ThoiLuong(time.Duration(giay) * time.Second)
	return nil
}

// DocCauHinh đọc, điền mặc định và xác thực cấu hình JSON.
func DocCauHinh(r io.Reader) (*CauHinh, error) {
	c := CauHinh{Cong: 8080, HetHan: ThoiLuong(30 * time.Second), ThuLai: 3}
	dec := json.NewDecoder(r)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&c); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrCauHinh, err)
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("%w: du lieu thua sau doi tuong", ErrCauHinh)
	}
	if len(c.MayChu) == 0 {
		c.MayChu = []string{"localhost"}
	}
	var loi []error
	if strings.TrimSpace(c.Ten) == "" {
		loi = append(loi, &LoiTruong{"ten", "bat buoc"})
	}
	if c.Cong < 1 || c.Cong > 65535 {
		loi = append(loi, &LoiTruong{"cong", "ngoai khoang 1-65535"})
	}
	if d := time.Duration(c.HetHan); d <= 0 || d > 24*time.Hour {
		loi = append(loi, &LoiTruong{"hetHan", "phai trong (0, 24h]"})
	}
	if c.ThuLai < 0 || c.ThuLai > 10 {
		loi = append(loi, &LoiTruong{"thuLai", "ngoai khoang 0-10"})
	}
	for i, m := range c.MayChu {
		if m == "" || strings.ContainsAny(m, " \t") {
			loi = append(loi, &LoiTruong{fmt.Sprintf("mayChu[%d]", i), "rong hoac chua khoang trang"})
		}
	}
	if len(loi) > 0 {
		return nil, errors.Join(append([]error{ErrCauHinh}, loi...)...)
	}
	return &c, nil
}
