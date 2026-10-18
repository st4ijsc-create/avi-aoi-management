package bai

import (
	"context"
	"errors"
)

var ErrSoWorker = errors.New("so worker phai >= 1")

func XuLySongSong(ctx context.Context, dauVao []int, soWorker int,
	f func(ctx context.Context, x int) (int, error)) ([]int, error) {
	return nil, errors.New("chua lam")
}
