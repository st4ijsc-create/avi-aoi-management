package bai

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

const kieuJSON = "application/json; charset=utf-8"

func TestAnTrungIDLa409(t *testing.T) {
	h := MoiKho().Handler()
	if rec := goi(t, h, "POST", "/sach", `{"id":"a1","tieuDe":"Mot"}`); rec.Code != http.StatusCreated {
		t.Fatalf("lan 1: %d %s", rec.Code, rec.Body)
	}
	rec := goi(t, h, "POST", "/sach", `{"id":"a1","tieuDe":"Hai","nam":2000}`)
	var loi map[string]string
	if rec.Code != http.StatusConflict || json.Unmarshal(rec.Body.Bytes(), &loi) != nil || loi["loi"] == "" {
		t.Fatalf("lan 2: %d %s", rec.Code, rec.Body)
	}
	var s Sach
	rec = goi(t, h, "GET", "/sach/a1", "")
	if json.Unmarshal(rec.Body.Bytes(), &s) != nil || s.TieuDe != "Mot" {
		t.Fatalf("ban ghi bi ghi de: %s", rec.Body)
	}
}

func TestAnDuLieuSai400(t *testing.T) {
	h := MoiKho().Handler()
	sai := []string{
		`{"id":"x","tieuDe":`,
		`khong phai json`,
		``,
		`{"id":"x","tieuDe":"T","gia":10}`,
		`{"id":"x","tieuDe":"   "}`,
		`{"id":"x"}`,
		`{"id":"","tieuDe":"T"}`,
		`{"id":"A-b","tieuDe":"T"}`,
		`{"id":"a b","tieuDe":"T"}`,
		`{"id":"a/b","tieuDe":"T"}`,
		`{"id":"` + strings.Repeat("a", 33) + `","tieuDe":"T"}`,
		`{"id":"x","tieuDe":"T","nam":-1}`,
		`{"id":"x","tieuDe":"T","nam":10000}`,
		`{"id":"x","tieuDe":"T","nam":"1999"}`,
		`{"id":"x","tieuDe":"T"} rac`,
		`{"id":"x","tieuDe":"T"}{"id":"y","tieuDe":"U"}`,
		`[{"id":"x","tieuDe":"T"}]`,
	}
	for _, body := range sai {
		rec := goi(t, h, "POST", "/sach", body)
		var loi map[string]string
		if rec.Code != http.StatusBadRequest || json.Unmarshal(rec.Body.Bytes(), &loi) != nil || loi["loi"] == "" {
			t.Errorf("body %q: %d %s", body, rec.Code, rec.Body)
		}
	}
	if rec := goi(t, h, "GET", "/sach", ""); strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Fatalf("du lieu sai van duoc luu: %s", rec.Body)
	}
	hopLe := `{"id":"` + strings.Repeat("z", 32) + `","tieuDe":"T","nam":9999} ` + "\n"
	if rec := goi(t, h, "POST", "/sach", hopLe); rec.Code != http.StatusCreated {
		t.Fatalf("id 32 ky tu + nam 9999 + khoang trang cuoi: %d %s", rec.Code, rec.Body)
	}
}

func TestAnXoa(t *testing.T) {
	h := MoiKho().Handler()
	goi(t, h, "POST", "/sach", `{"id":"xoa-toi","tieuDe":"T"}`)
	rec := goi(t, h, "DELETE", "/sach/xoa-toi", "")
	if rec.Code != http.StatusNoContent || rec.Body.Len() != 0 {
		t.Fatalf("DELETE: %d %q", rec.Code, rec.Body)
	}
	if rec := goi(t, h, "GET", "/sach/xoa-toi", ""); rec.Code != http.StatusNotFound {
		t.Fatalf("GET sau xoa: %d", rec.Code)
	}
	rec = goi(t, h, "DELETE", "/sach/xoa-toi", "")
	if rec.Code != http.StatusNotFound || rec.Header().Get("Content-Type") != kieuJSON {
		t.Fatalf("DELETE lan 2: %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}
}

func TestAnPhuongThuc405(t *testing.T) {
	h := MoiKho().Handler()
	ca := []struct{ method, url, phaiCo string }{
		{"PUT", "/sach/x", "DELETE"},
		{"PATCH", "/sach/x", "GET"},
		{"DELETE", "/sach", "POST"},
		{"PUT", "/sach", "GET"},
	}
	for _, c := range ca {
		rec := goi(t, h, c.method, c.url, "")
		if rec.Code != http.StatusMethodNotAllowed || !strings.Contains(rec.Header().Get("Allow"), c.phaiCo) {
			t.Errorf("%s %s: %d Allow=%q", c.method, c.url, rec.Code, rec.Header().Get("Allow"))
		}
	}
}

func TestAnDanhSachSapXep(t *testing.T) {
	h := MoiKho().Handler()
	for _, id := range []string{"c", "a-2", "b", "a-10", "a"} {
		goi(t, h, "POST", "/sach", fmt.Sprintf(`{"id":%q,"tieuDe":"Sach %s","nam":2001}`, id, id))
	}
	rec := goi(t, h, "GET", "/sach", "")
	var ds []Sach
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &ds) != nil {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	var ids []string
	for _, s := range ds {
		ids = append(ids, s.ID)
	}
	if strings.Join(ids, ",") != "a,a-10,a-2,b,c" || ds[0] != (Sach{ID: "a", TieuDe: "Sach a", Nam: 2001}) {
		t.Fatalf("thu tu = %v, ds[0] = %+v", ids, ds[0])
	}
}

func TestAnContentTypeVaLocation(t *testing.T) {
	h := MoiKho().Handler()
	ca := []struct {
		method, url, body string
		ma                int
	}{
		{"POST", "/sach", `{"id":"ct","tieuDe":"T"}`, 201},
		{"POST", "/sach", `{"id":"ct","tieuDe":"T"}`, 409},
		{"POST", "/sach", `{`, 400},
		{"GET", "/sach/ct", "", 200},
		{"GET", "/sach/khong", "", 404},
		{"GET", "/sach", "", 200},
	}
	for _, c := range ca {
		rec := goi(t, h, c.method, c.url, c.body)
		if rec.Code != c.ma || rec.Header().Get("Content-Type") != kieuJSON {
			t.Errorf("%s %s %s: %d Content-Type=%q", c.method, c.url, c.body, rec.Code, rec.Header().Get("Content-Type"))
		}
		if c.ma != 201 && rec.Header().Get("Location") != "" {
			t.Errorf("%s %s: Location khong mong doi %q", c.method, c.url, rec.Header().Get("Location"))
		}
	}
}

func TestAnDongThoiQuaServer(t *testing.T) {
	srv := httptest.NewServer(MoiKho().Handler())
	defer srv.Close()
	cl := srv.Client()
	const n = 64
	var wg sync.WaitGroup
	loi := make(chan string, 4*n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			id := fmt.Sprintf("s-%02d", i)
			res, err := cl.Post(srv.URL+"/sach", "application/json", strings.NewReader(fmt.Sprintf(`{"id":%q,"tieuDe":"T%d","nam":%d}`, id, i, i)))
			if err != nil {
				loi <- err.Error()
				return
			}
			io.Copy(io.Discard, res.Body)
			res.Body.Close()
			if res.StatusCode != 201 {
				loi <- fmt.Sprintf("POST %s: %d", id, res.StatusCode)
				return
			}
			res, err = cl.Get(srv.URL + "/sach/" + id)
			if err != nil {
				loi <- err.Error()
				return
			}
			var s Sach
			err = json.NewDecoder(res.Body).Decode(&s)
			res.Body.Close()
			if err != nil || res.StatusCode != 200 || s.Nam != i {
				loi <- fmt.Sprintf("GET %s: %d %+v %v", id, res.StatusCode, s, err)
			}
			res, err = cl.Get(srv.URL + "/sach")
			if err == nil {
				io.Copy(io.Discard, res.Body)
				res.Body.Close()
			}
		}(i)
	}
	wg.Wait()
	close(loi)
	for l := range loi {
		t.Error(l)
	}
	res, err := cl.Get(srv.URL + "/sach")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var ds []Sach
	if err := json.NewDecoder(res.Body).Decode(&ds); err != nil || len(ds) != n || ds[0].ID != "s-00" || ds[n-1].ID != "s-63" {
		t.Fatalf("danh sach cuoi: %d phan tu, err %v", len(ds), err)
	}
}

func TestAnDongThoiTrungID(t *testing.T) {
	h := MoiKho().Handler()
	const n = 40
	var wg sync.WaitGroup
	var mu sync.Mutex
	dem := map[int]int{}
	batDau := make(chan struct{})
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-batDau
			req := httptest.NewRequest("POST", "/sach", strings.NewReader(fmt.Sprintf(`{"id":"chung","tieuDe":"T%d"}`, i)))
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			mu.Lock()
			dem[rec.Code]++
			mu.Unlock()
		}(i)
	}
	close(batDau)
	wg.Wait()
	if dem[201] != 1 || dem[409] != n-1 {
		t.Fatalf("ma tra ve = %v; muon dung 1 lan 201 va %d lan 409", dem, n-1)
	}
}
