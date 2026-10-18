package bai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func goi(t *testing.T, h http.Handler, method, url, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, url, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestTaoVaLay(t *testing.T) {
	h := MoiKho().Handler()
	rec := goi(t, h, "POST", "/sach", `{"id":"dac-nhan-tam","tieuDe":"Dac nhan tam","tacGia":"D. Carnegie","nam":1936}`)
	if rec.Code != http.StatusCreated || rec.Header().Get("Location") != "/sach/dac-nhan-tam" {
		t.Fatalf("POST: %d, Location=%q, body=%s", rec.Code, rec.Header().Get("Location"), rec.Body)
	}
	rec = goi(t, h, "GET", "/sach/dac-nhan-tam", "")
	var s Sach
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &s) != nil {
		t.Fatalf("GET: %d %s", rec.Code, rec.Body)
	}
	if s != (Sach{ID: "dac-nhan-tam", TieuDe: "Dac nhan tam", TacGia: "D. Carnegie", Nam: 1936}) {
		t.Fatalf("sach = %+v", s)
	}
}

func TestKhongTimThay(t *testing.T) {
	rec := goi(t, MoiKho().Handler(), "GET", "/sach/khong-co", "")
	var loi map[string]string
	if rec.Code != http.StatusNotFound || json.Unmarshal(rec.Body.Bytes(), &loi) != nil || loi["loi"] == "" {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}

func TestDanhSachRong(t *testing.T) {
	rec := goi(t, MoiKho().Handler(), "GET", "/sach", "")
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Fatalf("%d %q", rec.Code, rec.Body)
	}
}
