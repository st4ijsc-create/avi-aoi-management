package bai

import (
	"errors"
	"strings"
	"testing"
)

func kiemBang(t *testing.T, ca [][2]string) {
	t.Helper()
	for _, c := range ca {
		if g := ChuanHoa(c[0]); g != c[1] {
			t.Errorf("ChuanHoa(%q) = %q; muon %q", c[0], g, c[1])
		}
	}
}

func TestAnRongVaGoc(t *testing.T) {
	kiemBang(t, [][2]string{
		{"", "."}, {".", "."}, {"./", "."}, {"./.", "."}, {"a/..", "."},
		{"/", "/"}, {"//", "/"}, {"///.//", "/"},
	})
}

func TestAnTuyetDoiKhongVuotGoc(t *testing.T) {
	kiemBang(t, [][2]string{
		{"/..", "/"}, {"/../..", "/"}, {"/../x", "/x"}, {"/a/../../b/./c", "/b/c"}, {"//x//y//", "/x/y"},
	})
}

func TestAnTuongDoiGiuChamCham(t *testing.T) {
	kiemBang(t, [][2]string{
		{"..", ".."}, {"../..", "../.."}, {"../../x/./y//", "../../x/y"}, {"../a/../b", "../b"},
		{"a/b/../../../c", "../c"}, {"./../a", "../a"}, {"a/./", "a"},
	})
}

func TestAnTenDacBiet(t *testing.T) {
	kiemBang(t, [][2]string{
		{"...", "..."}, {"/a/.../b/.an/./", "/a/.../b/.an"}, {"..a/b..", "..a/b.."}, {"a/.b/..c/..", "a/.b"},
		{"tệp lỗi/ảnh 1.png", "tệp lỗi/ảnh 1.png"},
	})
}

func TestAnLuyDang(t *testing.T) {
	for _, p := range []string{"", "/", "a/../..", "/x/./y/../z/", "../a//b/./..", "x"} {
		mot := ChuanHoa(p)
		if hai := ChuanHoa(mot); hai != mot {
			t.Errorf("ChuanHoa(ChuanHoa(%q)) = %q khac %q", p, hai, mot)
		}
	}
}

func TestAnDuongDai(t *testing.T) {
	var sb strings.Builder
	for i := 0; i < 50000; i++ {
		sb.WriteString("thu-muc/")
	}
	for i := 0; i < 50000; i++ {
		sb.WriteString("./../")
	}
	sb.WriteString("cuoi")
	if g := ChuanHoa(sb.String()); g != "cuoi" {
		t.Fatalf("ChuanHoa(duong dai) = %.40q", g)
	}
}

func TestAnTuongDoiNhieuCa(t *testing.T) {
	ca := [][3]string{
		{"/a/b", "/a/b", "."},
		{"/", "/", "."},
		{"/", "/x", "x"},
		{"/x/y", "/", "../.."},
		{"/a/b", "/a/b/c/d", "c/d"},
		{"/a/b/c", "/a/b", ".."},
		{"/ab", "/a/b", "../a/b"},
		{"/a/bc/d", "/a/b/d", "../../b/d"},
		{"/a/b/", "/a//b/./c/../d", "d"},
		{"/../a", "/a/b", "b"},
	}
	for _, c := range ca {
		g, err := DuongTuongDoi(c[0], c[1])
		if err != nil || g != c[2] {
			t.Errorf("DuongTuongDoi(%q, %q) = %q, %v; muon %q", c[0], c[1], g, err, c[2])
		}
	}
}

func TestAnTuongDoiLoi(t *testing.T) {
	for _, c := range [][2]string{{"a/b", "/a"}, {"/a", "b"}, {"", "/"}, {"/", ""}, {"./x", "/x"}} {
		g, err := DuongTuongDoi(c[0], c[1])
		if !errors.Is(err, ErrKhongTuyetDoi) || g != "" {
			t.Errorf("DuongTuongDoi(%q, %q) = %q, %v; muon loi ErrKhongTuyetDoi", c[0], c[1], g, err)
		}
	}
}
