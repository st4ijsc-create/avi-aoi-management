package bai

import (
	"errors"
	"fmt"
)

var (
	ErrK  = errors.New("k khong hop le")
	ErrAm = errors.New("phan tu am")
)

// ChiaMang chia a thành k đoạn liên tiếp khác rỗng sao cho tổng lớn nhất là nhỏ nhất.
func ChiaMang(a []int64, k int) (int64, []int, error) {
	if k < 1 || k > len(a) {
		return 0, nil, fmt.Errorf("k = %d voi len(a) = %d: %w", k, len(a), ErrK)
	}
	var lo, hi int64
	for i, x := range a {
		if x < 0 {
			return 0, nil, fmt.Errorf("a[%d] = %d: %w", i, x, ErrAm)
		}
		if x > lo {
			lo = x
		}
		hi += x
	}
	// Tìm kiếm nhị phân trên đáp án: M nhỏ nhất mà số đoạn tham lam tối thiểu <= k.
	for lo < hi {
		giua := lo + (hi-lo)/2
		if soDoanToiThieu(a, giua) <= k {
			hi = giua
		} else {
			lo = giua + 1
		}
	}
	return lo, catDoan(a, k, lo), nil
}

// soDoanToiThieu: số đoạn ít nhất để mọi đoạn có tổng <= m (giả thiết mọi phần tử <= m).
func soDoanToiThieu(a []int64, m int64) int {
	dem, tong := 1, int64(0)
	for _, x := range a {
		if tong+x > m {
			dem++
			tong = x
		} else {
			tong += x
		}
	}
	return dem
}

// catDoan: đúng k đoạn, mỗi đoạn lấy dài nhất có thể (tổng <= m) nhưng chừa đủ phần tử cho các đoạn sau.
func catDoan(a []int64, k int, m int64) []int {
	doDai := make([]int, 0, k)
	i := 0
	for j := 0; j < k; j++ {
		conLai := k - j - 1
		gioiHan := len(a) - i - conLai
		var tong int64
		l := 0
		for l < gioiHan && tong+a[i+l] <= m {
			tong += a[i+l]
			l++
		}
		doDai = append(doDai, l)
		i += l
	}
	return doDai
}
