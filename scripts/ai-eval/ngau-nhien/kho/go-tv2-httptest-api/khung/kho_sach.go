package bai

import "net/http"

type Sach struct {
	ID     string `json:"id"`
	TieuDe string `json:"tieuDe"`
	TacGia string `json:"tacGia"`
	Nam    int    `json:"nam"`
}

// Kho là kho sách trong bộ nhớ, an toàn khi dùng đồng thời.
type Kho struct{}

func MoiKho() *Kho {
	return &Kho{}
}

// Handler trả http.Handler phục vụ API /sach.
func (k *Kho) Handler() http.Handler {
	return http.NotFoundHandler()
}
