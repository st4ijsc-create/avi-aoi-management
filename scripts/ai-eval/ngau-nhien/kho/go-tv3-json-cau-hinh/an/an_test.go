package bai

import (
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"
)

func docOK(t *testing.T, s string) *CauHinh {
	t.Helper()
	c, err := DocCauHinh(strings.NewReader(s))
	if err != nil || c == nil {
		t.Fatalf("DocCauHinh(%s): c=%v err=%v", s, c, err)
	}
	return c
}

func docLoi(t *testing.T, s string, sentinel ...error) error {
	t.Helper()
	c, err := DocCauHinh(strings.NewReader(s))
	if c != nil || err == nil {
		t.Fatalf("DocCauHinh(%s): muon loi, c=%+v err=%v", s, c, err)
	}
	for _, e := range sentinel {
		if !errors.Is(err, e) {
			t.Fatalf("DocCauHinh(%s): err=%v khong Is %v", s, err, e)
		}
	}
	return err
}

func danhSachTruong(t *testing.T, err error) []string {
	t.Helper()
	j, ok := err.(interface{ Unwrap() []error })
	if !ok {
		t.Fatalf("loi xac thuc khong phai errors.Join: %T %v", err, err)
	}
	ds := j.Unwrap()
	if len(ds) == 0 || ds[0] != ErrCauHinh {
		t.Fatalf("phan tu dau cua Join phai la ErrCauHinh: %v", ds)
	}
	var ten []string
	for _, e := range ds[1:] {
		lt, ok := e.(*LoiTruong)
		if !ok {
			t.Fatalf("phan tu Join khong phai *LoiTruong: %T", e)
		}
		ten = append(ten, lt.Truong)
	}
	return ten
}

func TestAnThoiLuongSoGiayVaNull(t *testing.T) {
	if c := docOK(t, `{"ten":"a","hetHan":90}`); time.Duration(c.HetHan) != 90*time.Second {
		t.Fatalf("hetHan 90 = %v", time.Duration(c.HetHan))
	}
	if c := docOK(t, `{"ten":"a","hetHan":"250ms"}`); time.Duration(c.HetHan) != 250*time.Millisecond {
		t.Fatalf("hetHan 250ms = %v", time.Duration(c.HetHan))
	}
	if c := docOK(t, `{"ten":"a","hetHan":null,"cong":null}`); time.Duration(c.HetHan) != 30*time.Second || c.Cong != 8080 {
		t.Fatalf("null phai giu mac dinh: %+v", *c)
	}
	var tl ThoiLuong
	if err := tl.UnmarshalJSON([]byte(`"2m"`)); err != nil || time.Duration(tl) != 2*time.Minute {
		t.Fatalf("UnmarshalJSON truc tiep: %v %v", time.Duration(tl), err)
	}
}

func TestAnThoiLuongSai(t *testing.T) {
	for _, v := range []string{`"abc"`, `""`, `1.5`, `1e3`, `true`, `{}`, `[30]`, `10000000000`, `-10000000000`} {
		docLoi(t, `{"ten":"a","hetHan":`+v+`}`, ErrCauHinh, ErrThoiLuong)
	}
	var tl ThoiLuong
	if err := tl.UnmarshalJSON([]byte(`"1x"`)); !errors.Is(err, ErrThoiLuong) {
		t.Fatalf("UnmarshalJSON(\"1x\") = %v", err)
	}
	if err := tl.UnmarshalJSON([]byte(`9223372036`)); err != nil || time.Duration(tl) != 9223372036*time.Second {
		t.Fatalf("9223372036 giay van trong pham vi Duration: %v %v", time.Duration(tl), err)
	}
}

func TestAnGomNhieuLoi(t *testing.T) {
	err := docLoi(t, `{"ten":" ","cong":70000,"hetHan":"0s","thuLai":11,"mayChu":["a","","b c","d"]}`, ErrCauHinh)
	got := danhSachTruong(t, err)
	want := []string{"ten", "cong", "hetHan", "thuLai", "mayChu[1]", "mayChu[2]"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("truong loi = %v; muon %v", got, want)
	}
	var lt *LoiTruong
	if !errors.As(err, &lt) || lt.Truong != "ten" || lt.LyDo == "" {
		t.Fatalf("errors.As = %+v", lt)
	}
}

func TestAnBienHopLe(t *testing.T) {
	docOK(t, `{"ten":"a","cong":1,"hetHan":"24h","thuLai":0}`)
	docOK(t, `{"ten":"a","cong":65535,"hetHan":1,"thuLai":10}`)
	err := docLoi(t, `{"ten":"a","cong":0}`, ErrCauHinh)
	if got := danhSachTruong(t, err); !reflect.DeepEqual(got, []string{"cong"}) {
		t.Fatalf("cong 0: %v", got)
	}
	err = docLoi(t, `{"ten":"a","thuLai":-1}`, ErrCauHinh)
	if got := danhSachTruong(t, err); !reflect.DeepEqual(got, []string{"thuLai"}) {
		t.Fatalf("thuLai -1: %v", got)
	}
}

func TestAnBienHetHan(t *testing.T) {
	for _, v := range []string{`"24h0m1s"`, `"25h"`, `-5`, `0`, `"-1s"`} {
		err := docLoi(t, `{"ten":"a","hetHan":`+v+`}`, ErrCauHinh)
		if errors.Is(err, ErrThoiLuong) {
			t.Fatalf("hetHan %s: day la loi xac thuc, khong phai loi phan tich: %v", v, err)
		}
		if got := danhSachTruong(t, err); !reflect.DeepEqual(got, []string{"hetHan"}) {
			t.Fatalf("hetHan %s: %v", v, got)
		}
	}
}

func TestAnDuLieuThua(t *testing.T) {
	docLoi(t, `{"ten":"a"} {"ten":"b"}`, ErrCauHinh)
	docLoi(t, `{"ten":"a"} x`, ErrCauHinh)
	docLoi(t, `{"ten":"a"}]`, ErrCauHinh)
	docOK(t, "{\"ten\":\"a\"}  \n\t")
}

func TestAnSaiKieuVaRong(t *testing.T) {
	for _, s := range []string{`{"ten":"a","cong":"80"}`, ``, `   `, `[]`, `null x`, `{"ten":"a",}`, `{"ten":"a","mayChu":"h"}`} {
		docLoi(t, s, ErrCauHinh)
	}
}

func TestAnMayChuMacDinh(t *testing.T) {
	for _, s := range []string{`{"ten":"a","mayChu":[]}`, `{"ten":"a","mayChu":null}`} {
		if c := docOK(t, s); !reflect.DeepEqual(c.MayChu, []string{"localhost"}) {
			t.Fatalf("%s: mayChu = %v", s, c.MayChu)
		}
	}
	if c := docOK(t, `{"ten":"a","mayChu":["x","y"]}`); !reflect.DeepEqual(c.MayChu, []string{"x", "y"}) {
		t.Fatalf("mayChu = %v", c.MayChu)
	}
}

func TestAnTruongLaCoTen(t *testing.T) {
	err := docLoi(t, `{"ten":"a","congg":1}`, ErrCauHinh)
	if !strings.Contains(err.Error(), "congg") {
		t.Fatalf("thong diep khong neu ten truong la: %v", err)
	}
	var lt *LoiTruong
	if errors.As(err, &lt) {
		t.Fatalf("truong la khong phai loi xac thuc: %+v", lt)
	}
}
