package bai

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"
)

// Chay là điểm vào của công cụ dòng lệnh đếm từ; trả mã thoát.
func Chay(args []string, vao io.Reader, ra, loi io.Writer) int {
	fs := flag.NewFlagSet("demtu", flag.ContinueOnError)
	fs.SetOutput(loi)
	n := fs.Int("n", 10, "so dong toi da (>= 1)")
	khongHoa := fs.Bool("khong-phan-biet-hoa", false, "khong phan biet chu hoa/thuong")
	boQua := fs.String("bo-qua", "", "danh sach tu dung, cach nhau dau phay")
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if *n < 1 {
		fmt.Fprintf(loi, "demtu: -n phai >= 1 (nhan %d)\n", *n)
		return 2
	}
	if fs.NArg() > 0 {
		fmt.Fprintf(loi, "demtu: khong nhan doi so vi tri: %q\n", fs.Args())
		return 2
	}
	tc := TuyChon{KhongPhanBietHoa: *khongHoa}
	for _, w := range strings.Split(*boQua, ",") {
		if w = strings.TrimSpace(w); w != "" {
			tc.BoQua = append(tc.BoQua, w)
		}
	}
	dem, err := DemTu(vao, tc)
	if err != nil {
		fmt.Fprintf(loi, "demtu: loi doc: %v\n", err)
		return 1
	}
	tong := 0
	for _, sl := range dem {
		tong += sl
	}
	hang := XepHang(dem, *n)
	rong := 2
	for _, m := range hang {
		rong = max(rong, utf8.RuneCountInString(m.Tu))
	}
	var sb strings.Builder
	fmt.Fprintf(&sb, "%-*s  SO LAN\n", rong, "TU")
	for _, m := range hang {
		fmt.Fprintf(&sb, "%-*s  %d\n", rong, m.Tu, m.SoLan)
	}
	fmt.Fprintf(&sb, "tong: %d tu, %d tu khac\n", tong, len(dem))
	io.WriteString(ra, sb.String())
	return 0
}
