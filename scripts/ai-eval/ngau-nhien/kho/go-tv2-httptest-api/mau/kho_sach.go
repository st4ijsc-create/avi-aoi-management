package bai

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
)

type Sach struct {
	ID     string `json:"id"`
	TieuDe string `json:"tieuDe"`
	TacGia string `json:"tacGia"`
	Nam    int    `json:"nam"`
}

// Kho là kho sách trong bộ nhớ, an toàn khi dùng đồng thời.
type Kho struct {
	mu   sync.RWMutex
	sach map[string]Sach
}

func MoiKho() *Kho {
	return &Kho{sach: make(map[string]Sach)}
}

// Handler trả http.Handler phục vụ API /sach.
func (k *Kho) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /sach", k.danhSach)
	mux.HandleFunc("POST /sach", k.tao)
	mux.HandleFunc("GET /sach/{id}", k.lay)
	mux.HandleFunc("DELETE /sach/{id}", k.xoa)
	return mux
}

func viJSON(w http.ResponseWriter, ma int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(ma)
	_ = json.NewEncoder(w).Encode(v)
}

func viLoi(w http.ResponseWriter, ma int, thongDiep string) {
	viJSON(w, ma, map[string]string{"loi": thongDiep})
}

func (k *Kho) danhSach(w http.ResponseWriter, r *http.Request) {
	k.mu.RLock()
	ds := make([]Sach, 0, len(k.sach))
	for _, s := range k.sach {
		ds = append(ds, s)
	}
	k.mu.RUnlock()
	sort.Slice(ds, func(i, j int) bool { return ds[i].ID < ds[j].ID })
	viJSON(w, http.StatusOK, ds)
}

func (k *Kho) lay(w http.ResponseWriter, r *http.Request) {
	k.mu.RLock()
	s, co := k.sach[r.PathValue("id")]
	k.mu.RUnlock()
	if !co {
		viLoi(w, http.StatusNotFound, "khong tim thay")
		return
	}
	viJSON(w, http.StatusOK, s)
}

func idHopLe(id string) bool {
	if len(id) < 1 || len(id) > 32 {
		return false
	}
	for _, c := range id {
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
			return false
		}
	}
	return true
}

func (k *Kho) tao(w http.ResponseWriter, r *http.Request) {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var s Sach
	if err := dec.Decode(&s); err != nil {
		viLoi(w, http.StatusBadRequest, "json khong hop le: "+err.Error())
		return
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		viLoi(w, http.StatusBadRequest, "du lieu thua sau doi tuong json")
		return
	}
	switch {
	case !idHopLe(s.ID):
		viLoi(w, http.StatusBadRequest, "id khong hop le")
		return
	case strings.TrimSpace(s.TieuDe) == "":
		viLoi(w, http.StatusBadRequest, "tieuDe bat buoc")
		return
	case s.Nam < 0 || s.Nam > 9999:
		viLoi(w, http.StatusBadRequest, "nam ngoai khoang 0-9999")
		return
	}
	k.mu.Lock()
	if _, co := k.sach[s.ID]; co {
		k.mu.Unlock()
		viLoi(w, http.StatusConflict, "id da ton tai")
		return
	}
	k.sach[s.ID] = s
	k.mu.Unlock()
	w.Header().Set("Location", "/sach/"+s.ID)
	viJSON(w, http.StatusCreated, s)
}

func (k *Kho) xoa(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	k.mu.Lock()
	_, co := k.sach[id]
	delete(k.sach, id)
	k.mu.Unlock()
	if !co {
		viLoi(w, http.StatusNotFound, "khong tim thay")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
