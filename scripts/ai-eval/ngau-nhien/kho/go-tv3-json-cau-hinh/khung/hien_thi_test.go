package bai

import (
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestDocDayDu(t *testing.T) {
	c, err := DocCauHinh(strings.NewReader(`{"ten":"api","cong":9000,"hetHan":"1h30m","thuLai":5,"mayChu":["a.local","b.local"]}`))
	if err != nil {
		t.Fatal(err)
	}
	want := CauHinh{Ten: "api", Cong: 9000, HetHan: ThoiLuong(90 * time.Minute), ThuLai: 5, MayChu: []string{"a.local", "b.local"}}
	if !reflect.DeepEqual(*c, want) {
		t.Fatalf("c = %+v", *c)
	}
}

func TestMacDinh(t *testing.T) {
	c, err := DocCauHinh(strings.NewReader(`{"ten":"api"}`))
	if err != nil {
		t.Fatal(err)
	}
	want := CauHinh{Ten: "api", Cong: 8080, HetHan: ThoiLuong(30 * time.Second), ThuLai: 3, MayChu: []string{"localhost"}}
	if !reflect.DeepEqual(*c, want) {
		t.Fatalf("c = %+v", *c)
	}
}

func TestTruongLa(t *testing.T) {
	c, err := DocCauHinh(strings.NewReader(`{"ten":"api","port":80}`))
	if c != nil || !errors.Is(err, ErrCauHinh) {
		t.Fatalf("c=%v err=%v", c, err)
	}
}
