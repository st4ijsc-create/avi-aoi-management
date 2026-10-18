package bai

import (
	"errors"
	"testing"
)

func TestTinhCoBan(t *testing.T) {
	for bt, want := range map[string]int64{"3 4 + 2 *": 14, "5 1 2 + 4 * + 3 -": 14} {
		if g, err := TinhRPN(bt); err != nil || g != want {
			t.Fatalf("TinhRPN(%q) = %d, %v; muon %d", bt, g, err, want)
		}
	}
}

func TestChiaKhongLaLoiRPN(t *testing.T) {
	_, err := TinhRPN("1 0 /")
	var l *LoiRPN
	if !errors.As(err, &l) || l.Loai != LoiChiaKhong || l.ViTri != 2 || l.Token != "/" {
		t.Fatalf("err = %#v", err)
	}
}

func TestChuyenTrungToCoBan(t *testing.T) {
	for vao, want := range map[string]string{"3 + 4 * 2": "3 4 2 * +", "(1 + 2) * 3": "1 2 + 3 *"} {
		if g, err := ChuyenTrungTo(vao); err != nil || g != want {
			t.Fatalf("ChuyenTrungTo(%q) = %q, %v; muon %q", vao, g, err, want)
		}
	}
}
