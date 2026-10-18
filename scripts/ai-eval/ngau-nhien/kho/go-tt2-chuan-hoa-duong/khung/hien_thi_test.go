package bai

import "testing"

func TestChuanHoaTuyetDoi(t *testing.T) {
	if g := ChuanHoa("/a/./b/../c/"); g != "/a/c" {
		t.Fatalf("ChuanHoa = %q", g)
	}
}

func TestChuanHoaTuongDoiVuotLen(t *testing.T) {
	if g := ChuanHoa("a//b/../../.."); g != ".." {
		t.Fatalf("ChuanHoa = %q", g)
	}
}

func TestTuongDoiCoBan(t *testing.T) {
	g, err := DuongTuongDoi("/a/b/c", "/a/d")
	if err != nil || g != "../../d" {
		t.Fatalf("DuongTuongDoi = %q, %v", g, err)
	}
}
