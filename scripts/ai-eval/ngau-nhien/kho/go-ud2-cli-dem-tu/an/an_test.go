package bai

import (
	"bytes"
	"errors"
	"io"
	"reflect"
	"strings"
	"testing"
)

func kiemChay(t *testing.T, args []string, vao, want string) {
	t.Helper()
	ma, ra, loi := chay(args, vao)
	if ma != 0 || ra != want || loi != "" {
		t.Fatalf("Chay(%q): ma=%d loi=%q\nra   = %q\nmuon = %q", args, ma, loi, ra, want)
	}
}

func TestAnKhongPhanBietHoaTiengViet(t *testing.T) {
	kiemChay(t, []string{"-khong-phan-biet-hoa"}, "Đường đường ĐƯỜNG phố\nphố",
		"TU     SO LAN\nđường  3\nphố    2\ntong: 5 tu, 2 tu khac\n")
}

func TestAnPhanBietHoaMacDinh(t *testing.T) {
	kiemChay(t, nil, "Đường đường ĐƯỜNG phố\nphố",
		"TU     SO LAN\nphố    2\nĐƯỜNG  1\nĐường  1\nđường  1\ntong: 5 tu, 4 tu khac\n")
}

func TestAnBoQua(t *testing.T) {
	kiemChay(t, []string{"-bo-qua", "Va, la,,  cua "}, "Va va la cua tao tao",
		"TU   SO LAN\ntao  2\nva   1\ntong: 3 tu, 2 tu khac\n")
	kiemChay(t, []string{"-khong-phan-biet-hoa", "-bo-qua", "Va, la,,  cua "}, "Va va la cua tao tao",
		"TU   SO LAN\ntao  2\ntong: 2 tu, 1 tu khac\n")
}

func TestAnDongDai(t *testing.T) {
	vao := strings.Repeat("a", 200000) + " x x\n" + strings.Repeat("ab ", 30000) + "\n"
	kiemChay(t, []string{"-n", "2"}, vao, "TU  SO LAN\nab  30000\nx   2\ntong: 30003 tu, 3 tu khac\n")
	dem, err := DemTu(strings.NewReader(strings.Repeat("Z", 1<<20)), TuyChon{KhongPhanBietHoa: true})
	if err != nil || len(dem) != 1 || dem[strings.Repeat("z", 1<<20)] != 1 {
		t.Fatalf("dong 1 MiB: %d muc, err %v", len(dem), err)
	}
}

func TestAnRong(t *testing.T) {
	kiemChay(t, nil, "", "TU  SO LAN\ntong: 0 tu, 0 tu khac\n")
	kiemChay(t, []string{"-n", "1"}, "... ,,, !!!\n\n", "TU  SO LAN\ntong: 0 tu, 0 tu khac\n")
}

func TestAnLoiCo(t *testing.T) {
	ca := [][]string{{"-n", "0"}, {"-n", "-3"}, {"-n", "abc"}, {"-n"}, {"thua"}, {"-n", "3", "thua"}}
	for _, args := range ca {
		ma, ra, loi := chay(args, "a b")
		if ma != 2 || ra != "" || loi == "" {
			t.Errorf("Chay(%q): ma=%d ra=%q loi=%q", args, ma, ra, loi)
		}
	}
	if _, _, loi := chay([]string{"-n", "0"}, "a"); !strings.Contains(loi, "-n") {
		t.Errorf("thong diep -n 0 khong neu co -n: %q", loi)
	}
}

func TestAnHelp(t *testing.T) {
	ma, ra, loi := chay([]string{"-h"}, "a")
	if ma != 0 || ra != "" || !strings.Contains(loi, "bo-qua") {
		t.Fatalf("ma=%d ra=%q loi=%q", ma, ra, loi)
	}
}

type docHong struct {
	da  bool
	loi error
}

func (d *docHong) Read(p []byte) (int, error) {
	if !d.da {
		d.da = true
		return copy(p, "xin chao\nban "), nil
	}
	return 0, d.loi
}

func TestAnLoiDoc(t *testing.T) {
	goc := errors.New("dia hong")
	var ra, loi bytes.Buffer
	if ma := Chay(nil, &docHong{loi: goc}, &ra, &loi); ma != 1 || ra.Len() != 0 || loi.Len() == 0 {
		t.Fatalf("ma=%d ra=%q loi=%q", ma, ra.String(), loi.String())
	}
	dem, err := DemTu(&docHong{loi: goc}, TuyChon{})
	if !errors.Is(err, goc) || dem != nil {
		t.Fatalf("DemTu: dem=%v err=%v", dem, err)
	}
	dem, err = DemTu(io.MultiReader(strings.NewReader("mot hai"), strings.NewReader(" hai")), TuyChon{})
	if err != nil || !reflect.DeepEqual(dem, map[string]int{"mot": 1, "hai": 2}) {
		t.Fatalf("doc nhieu manh: %v %v", dem, err)
	}
}

func TestAnTachTu(t *testing.T) {
	dem, err := DemTu(strings.NewReader("a1b2, c-d; 42 42\tx_y\r\nĂn-ăn\n"), TuyChon{BoQua: []string{"ăn"}})
	want := map[string]int{"a1b2": 1, "c": 1, "d": 1, "42": 2, "x": 1, "y": 1, "Ăn": 1}
	if err != nil || !reflect.DeepEqual(dem, want) {
		t.Fatalf("DemTu = %v, %v; muon %v", dem, err, want)
	}
}

func TestAnNMacDinh10(t *testing.T) {
	ma, ra, _ := chay(nil, "v u t s r q p o n m l k")
	dong := strings.Split(strings.TrimSuffix(ra, "\n"), "\n")
	if ma != 0 || len(dong) != 12 || dong[1] != "k   1" || dong[10] != "t   1" || dong[11] != "tong: 12 tu, 12 tu khac" {
		t.Fatalf("ma=%d ra=%q", ma, ra)
	}
}

func TestAnXepHangBien(t *testing.T) {
	m := map[string]int{"b": 1, "B": 1, "a": 1, "á": 1, "z": 3}
	if got := XepHang(m, 0); got == nil || len(got) != 0 {
		t.Fatalf("n=0: %#v", got)
	}
	want := []DemMuc{{"z", 3}, {"B", 1}, {"a", 1}, {"b", 1}, {"á", 1}}
	if got := XepHang(m, 100); !reflect.DeepEqual(got, want) {
		t.Fatalf("n=100: %v", got)
	}
	if got := XepHang(map[string]int{}, 5); got == nil || len(got) != 0 {
		t.Fatalf("map rong: %#v", got)
	}
}
