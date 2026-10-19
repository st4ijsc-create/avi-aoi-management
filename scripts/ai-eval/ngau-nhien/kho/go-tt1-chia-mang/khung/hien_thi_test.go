package bai

import (
	"errors"
	"reflect"
	"testing"
)

func TestViDuMot(t *testing.T) {
	m, dd, err := ChiaMang([]int64{7, 2, 5, 10, 8}, 2)
	if err != nil || m != 18 || !reflect.DeepEqual(dd, []int{3, 2}) {
		t.Fatalf("m=%d dd=%v err=%v", m, dd, err)
	}
}

func TestViDuHai(t *testing.T) {
	m, dd, err := ChiaMang([]int64{1, 2, 3, 4, 5}, 2)
	if err != nil || m != 9 || !reflect.DeepEqual(dd, []int{3, 2}) {
		t.Fatalf("m=%d dd=%v err=%v", m, dd, err)
	}
}

func TestKBangKhong(t *testing.T) {
	_, dd, err := ChiaMang([]int64{1, 2}, 0)
	if !errors.Is(err, ErrK) || dd != nil {
		t.Fatalf("dd=%v err=%v", dd, err)
	}
}
