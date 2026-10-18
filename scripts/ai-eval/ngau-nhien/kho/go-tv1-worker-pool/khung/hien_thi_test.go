package bai

import (
	"context"
	"errors"
	"testing"
)

func TestGiuThuTu(t *testing.T) {
	kq, err := XuLySongSong(context.Background(), []int{1, 2, 3, 4, 5}, 2,
		func(_ context.Context, x int) (int, error) { return x * x, nil })
	if err != nil {
		t.Fatal(err)
	}
	want := []int{1, 4, 9, 16, 25}
	for i := range want {
		if kq[i] != want[i] {
			t.Fatalf("kq = %v, muon %v", kq, want)
		}
	}
}

func TestSoWorkerSai(t *testing.T) {
	_, err := XuLySongSong(context.Background(), []int{1}, 0,
		func(_ context.Context, x int) (int, error) { return x, nil })
	if !errors.Is(err, ErrSoWorker) {
		t.Fatalf("err = %v", err)
	}
}

func TestLoiDuocBoc(t *testing.T) {
	goc := errors.New("hong")
	_, err := XuLySongSong(context.Background(), []int{1, 2, 3}, 1,
		func(_ context.Context, x int) (int, error) {
			if x == 2 {
				return 0, goc
			}
			return x, nil
		})
	if !errors.Is(err, goc) {
		t.Fatalf("err = %v", err)
	}
}
