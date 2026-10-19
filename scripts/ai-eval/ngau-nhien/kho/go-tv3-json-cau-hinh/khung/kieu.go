package bai

import (
	"errors"
	"fmt"
	"time"
)

// TỆP NÀY CHO SẴN — không sửa.

var (
	ErrCauHinh   = errors.New("cau hinh khong hop le")
	ErrThoiLuong = errors.New("thoi luong khong hop le")
)

// ThoiLuong nhận từ JSON một chuỗi kiểu "1h30m" hoặc một số nguyên giây.
type ThoiLuong time.Duration

type CauHinh struct {
	Ten    string    `json:"ten"`
	Cong   int       `json:"cong"`
	HetHan ThoiLuong `json:"hetHan"`
	ThuLai int       `json:"thuLai"`
	MayChu []string  `json:"mayChu"`
}

// LoiTruong mô tả một trường không hợp lệ khi xác thực.
type LoiTruong struct {
	Truong string // tên trường JSON, vd "cong" hoặc "mayChu[2]"
	LyDo   string
}

func (e *LoiTruong) Error() string {
	return fmt.Sprintf("truong %s: %s", e.Truong, e.LyDo)
}
