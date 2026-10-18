package bai

import (
	"context"
	"errors"
	"fmt"
	"sync"
)

var ErrSoWorker = errors.New("so worker phai >= 1")

func XuLySongSong(ctx context.Context, dauVao []int, soWorker int,
	f func(ctx context.Context, x int) (int, error)) ([]int, error) {
	if soWorker < 1 {
		return nil, fmt.Errorf("soWorker = %d: %w", soWorker, ErrSoWorker)
	}
	ctxCon, huy := context.WithCancel(ctx)
	defer huy()

	kq := make([]int, len(dauVao))
	khe := make(chan struct{}, soWorker)
	var wg sync.WaitGroup
	var mu sync.Mutex
	var loiDau error

	ghiLoi := func(e error) {
		mu.Lock()
		if loiDau == nil {
			loiDau = e
		}
		mu.Unlock()
		huy()
	}
	coLoi := func() bool {
		mu.Lock()
		defer mu.Unlock()
		return loiDau != nil
	}

vong:
	for i, x := range dauVao {
		select {
		case khe <- struct{}{}:
		case <-ctxCon.Done():
			break vong
		}
		if coLoi() || ctxCon.Err() != nil {
			<-khe
			break
		}
		wg.Add(1)
		go func(i, x int) {
			defer wg.Done()
			defer func() { <-khe }()
			v, err := f(ctxCon, x)
			if err != nil {
				ghiLoi(fmt.Errorf("phan tu %d: %w", i, err))
				return
			}
			kq[i] = v
		}(i, x)
	}
	wg.Wait()

	if loiDau != nil {
		return nil, loiDau
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return kq, nil
}
