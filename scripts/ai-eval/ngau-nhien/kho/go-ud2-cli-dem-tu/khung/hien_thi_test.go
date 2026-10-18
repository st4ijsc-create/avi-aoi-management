package bai

import (
	"bytes"
	"reflect"
	"strings"
	"testing"
)

func chay(args []string, vao string) (int, string, string) {
	var ra, loi bytes.Buffer
	ma := Chay(args, strings.NewReader(vao), &ra, &loi)
	return ma, ra.String(), loi.String()
}

func TestDemCoBan(t *testing.T) {
	ma, ra, loi := chay([]string{"-n", "2"}, "b a b c a b")
	want := "TU  SO LAN\nb   3\na   2\ntong: 6 tu, 3 tu khac\n"
	if ma != 0 || ra != want || loi != "" {
		t.Fatalf("ma=%d ra=%q loi=%q; muon ra=%q", ma, ra, loi, want)
	}
}

func TestCoLaMa2(t *testing.T) {
	ma, ra, loi := chay([]string{"-khong-ton-tai"}, "a")
	if ma != 2 || ra != "" || loi == "" {
		t.Fatalf("ma=%d ra=%q loi=%q", ma, ra, loi)
	}
}

func TestXepHang(t *testing.T) {
	got := XepHang(map[string]int{"b": 2, "a": 2, "c": 5, "d": 1}, 3)
	want := []DemMuc{{"c", 5}, {"a", 2}, {"b", 2}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("XepHang = %v", got)
	}
}
