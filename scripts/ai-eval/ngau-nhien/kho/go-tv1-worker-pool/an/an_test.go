package bai

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestAnRongKhacNil(t *testing.T) {
	kq, err := XuLySongSong(context.Background(), []int{}, 3,
		func(_ context.Context, x int) (int, error) { return x, nil })
	if err != nil || kq == nil || len(kq) != 0 {
		t.Fatalf("kq=%v err=%v", kq, err)
	}
}

func TestAnSoWorkerAmKhongGoiF(t *testing.T) {
	var goi int32
	_, err := XuLySongSong(context.Background(), []int{1, 2}, -3,
		func(_ context.Context, x int) (int, error) { atomic.AddInt32(&goi, 1); return x, nil })
	if !errors.Is(err, ErrSoWorker) || atomic.LoadInt32(&goi) != 0 {
		t.Fatalf("err=%v goi=%d", err, goi)
	}
}

func TestAnGioiHanDongThoiChinhXac(t *testing.T) {
	for _, w := range []int{1, 3, 5} {
		var dang, dinh int32
		dauVao := make([]int, 40)
		for i := range dauVao {
			dauVao[i] = i
		}
		kq, err := XuLySongSong(context.Background(), dauVao, w, func(_ context.Context, x int) (int, error) {
			n := atomic.AddInt32(&dang, 1)
			for {
				d := atomic.LoadInt32(&dinh)
				if n <= d || atomic.CompareAndSwapInt32(&dinh, d, n) {
					break
				}
			}
			time.Sleep(3 * time.Millisecond)
			atomic.AddInt32(&dang, -1)
			return x + 1, nil
		})
		if err != nil {
			t.Fatal(err)
		}
		if int(atomic.LoadInt32(&dinh)) > w {
			t.Fatalf("w=%d nhung dinh dong thoi = %d", w, dinh)
		}
		if w > 1 && atomic.LoadInt32(&dinh) < 2 {
			t.Fatalf("w=%d nhung khong chay song song (dinh=%d)", w, dinh)
		}
		for i, v := range kq {
			if v != i+1 {
				t.Fatalf("w=%d kq[%d]=%d", w, i, v)
			}
		}
	}
}

func TestAnLoiCoChiSo(t *testing.T) {
	goc := errors.New("hong")
	_, err := XuLySongSong(context.Background(), []int{10, 20, 30}, 1,
		func(_ context.Context, x int) (int, error) {
			if x == 30 {
				return 0, goc
			}
			return x, nil
		})
	if err == nil || !strings.Contains(err.Error(), "phan tu 2") || !errors.Is(err, goc) {
		t.Fatalf("err = %v", err)
	}
}

func TestAnLoiHuyCacLoiGoiKhac(t *testing.T) {
	var batDau, biHuy int32
	dauVao := make([]int, 100)
	for i := range dauVao {
		dauVao[i] = i
	}
	t0 := time.Now()
	_, err := XuLySongSong(context.Background(), dauVao, 4, func(ctx context.Context, x int) (int, error) {
		atomic.AddInt32(&batDau, 1)
		if x == 0 {
			return 0, errors.New("loi som")
		}
		select {
		case <-ctx.Done():
			atomic.AddInt32(&biHuy, 1)
			return 0, ctx.Err()
		case <-time.After(2 * time.Second):
			return x, nil
		}
	})
	if err == nil || !strings.Contains(err.Error(), "loi som") {
		t.Fatalf("err = %v", err)
	}
	if time.Since(t0) > 1500*time.Millisecond {
		t.Fatalf("khong huy cac loi goi dang chay (mat %v)", time.Since(t0))
	}
	if n := atomic.LoadInt32(&batDau); n > 8 {
		t.Fatalf("van khoi dong %d loi goi sau khi loi", n)
	}
}

func TestAnNguoiGoiHuy(t *testing.T) {
	ctx, huy := context.WithCancel(context.Background())
	var batDau int32
	dauVao := make([]int, 50)
	go func() { time.Sleep(30 * time.Millisecond); huy() }()
	_, err := XuLySongSong(ctx, dauVao, 2, func(c context.Context, x int) (int, error) {
		atomic.AddInt32(&batDau, 1)
		select {
		case <-c.Done():
			return 0, c.Err()
		case <-time.After(20 * time.Millisecond):
			return x, nil
		}
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
	if n := atomic.LoadInt32(&batDau); n >= 50 {
		t.Fatalf("van goi het %d phan tu sau khi huy", n)
	}
}

func TestAnKhongRoGoroutineKhiTraVe(t *testing.T) {
	var dang int32
	_, _ = XuLySongSong(context.Background(), []int{1, 2, 3, 4, 5, 6}, 3, func(ctx context.Context, x int) (int, error) {
		atomic.AddInt32(&dang, 1)
		defer atomic.AddInt32(&dang, -1)
		if x == 1 {
			return 0, errors.New("x")
		}
		time.Sleep(20 * time.Millisecond)
		return x, nil
	})
	if n := atomic.LoadInt32(&dang); n != 0 {
		t.Fatalf("con %d loi goi f dang chay sau khi ham tra ve", n)
	}
}
