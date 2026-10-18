package bai

import (
	"errors"
	"reflect"
	"slices"
	"testing"
)

func kiemChia(t *testing.T, a []int64, k int, wantM int64, wantDD []int) {
	t.Helper()
	m, dd, err := ChiaMang(a, k)
	if err != nil || m != wantM || !reflect.DeepEqual(dd, wantDD) {
		t.Fatalf("ChiaMang(%v, %d) = %d, %v, %v; muon %d, %v", a, k, m, dd, err, wantM, wantDD)
	}
}

func TestAnKBangDoDai(t *testing.T) {
	kiemChia(t, []int64{3, 1, 4}, 3, 4, []int{1, 1, 1})
}

func TestAnKMot(t *testing.T) {
	kiemChia(t, []int64{3, 1, 4}, 1, 8, []int{3})
	kiemChia(t, []int64{6}, 1, 6, []int{1})
}

func TestAnToanSoKhong(t *testing.T) {
	kiemChia(t, []int64{0, 0, 0, 0}, 2, 0, []int{3, 1})
}

func TestAnPhaHoaChuaChoDoanSau(t *testing.T) {
	kiemChia(t, []int64{5, 0, 0, 0, 5}, 4, 5, []int{2, 1, 1, 1})
	kiemChia(t, []int64{1, 2, 3, 4, 5}, 3, 6, []int{3, 1, 1})
	kiemChia(t, []int64{2, 1, 1, 2}, 3, 2, []int{1, 2, 1})
}

func TestAnLoi(t *testing.T) {
	ca := []struct {
		a    []int64
		k    int
		loai error
	}{
		{[]int64{1, 2, 3}, 4, ErrK},
		{[]int64{}, 1, ErrK},
		{nil, 0, ErrK},
		{[]int64{1, 2}, -1, ErrK},
		{[]int64{4, -1, 2}, 2, ErrAm},
	}
	for _, c := range ca {
		m, dd, err := ChiaMang(c.a, c.k)
		if !errors.Is(err, c.loai) || m != 0 || dd != nil {
			t.Fatalf("ChiaMang(%v, %d) = %d, %v, %v; muon loi %v", c.a, c.k, m, dd, err, c.loai)
		}
	}
}

func TestAnSoLon(t *testing.T) {
	kiemChia(t, []int64{1e12, 1e12, 1e12}, 2, 2e12, []int{2, 1})
	kiemChia(t, []int64{1 << 60, 1 << 60, 1 << 60, 1 << 60}, 3, 1<<61, []int{2, 1, 1})
}

func TestAnKhongSuaDauVao(t *testing.T) {
	a := []int64{9, 1, 8, 2, 7, 3}
	ban := slices.Clone(a)
	if _, _, err := ChiaMang(a, 3); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(a, ban) {
		t.Fatalf("a bi sua thanh %v", a)
	}
}

// vetCan: duyệt mọi cách chia n phần tử thành k đoạn; trả M tối ưu và vector độ dài lớn nhất theo thứ tự từ điển.
func vetCan(a []int64, k int) (int64, []int) {
	var totM int64 = -1
	var tot []int
	var duyet func(bd int, conK int, cur []int)
	duyet = func(bd int, conK int, cur []int) {
		if conK == 0 {
			if bd != len(a) {
				return
			}
			var mx int64
			i := 0
			for _, l := range cur {
				var s int64
				for _, x := range a[i : i+l] {
					s += x
				}
				mx = max(mx, s)
				i += l
			}
			if totM < 0 || mx < totM || (mx == totM && slices.Compare(cur, tot) > 0) {
				totM, tot = mx, slices.Clone(cur)
			}
			return
		}
		for l := 1; bd+l <= len(a); l++ {
			duyet(bd+l, conK-1, append(cur, l))
		}
	}
	duyet(0, k, nil)
	return totM, tot
}

func TestAnDoiChieuVetCan(t *testing.T) {
	hat := uint32(12345)
	ngau := func(n uint32) uint32 { hat = hat*1103515245 + 12345; return (hat >> 16) % n }
	for lan := 0; lan < 400; lan++ {
		n := int(ngau(8)) + 1
		a := make([]int64, n)
		for i := range a {
			a[i] = int64(ngau(10))
		}
		k := int(ngau(uint32(n))) + 1
		wantM, wantDD := vetCan(a, k)
		m, dd, err := ChiaMang(a, k)
		if err != nil || m != wantM || !slices.Equal(dd, wantDD) {
			t.Fatalf("ChiaMang(%v, %d) = %d, %v, %v; muon %d, %v", a, k, m, dd, err, wantM, wantDD)
		}
	}
}

func TestAnHieuNangLon(t *testing.T) {
	const n, k = 200000, 37
	hat := uint64(99)
	a := make([]int64, n)
	for i := range a {
		hat = hat*6364136223846793005 + 1442695040888963407
		a[i] = int64(hat>>33) % 1000000000
	}
	m, dd, err := ChiaMang(a, k)
	if err != nil || len(dd) != k {
		t.Fatalf("err=%v len(dd)=%d", err, len(dd))
	}
	i := 0
	var lonNhat int64
	for _, l := range dd {
		if l < 1 {
			t.Fatalf("doan rong: %v", dd)
		}
		var s int64
		for _, x := range a[i : i+l] {
			s += x
		}
		lonNhat = max(lonNhat, s)
		i += l
	}
	if i != n || lonNhat != m {
		t.Fatalf("tong do dai %d, tong lon nhat %d, m %d", i, lonNhat, m)
	}
	// m-1 phải bất khả: tham lam cần > k đoạn (hoặc có phần tử > m-1).
	dem, tong := 1, int64(0)
	for _, x := range a {
		if x > m-1 {
			return
		}
		if tong+x > m-1 {
			dem++
			tong = x
		} else {
			tong += x
		}
	}
	if dem <= k {
		t.Fatalf("m=%d chua toi uu: m-1 van chia duoc thanh %d doan", m, dem)
	}
}
