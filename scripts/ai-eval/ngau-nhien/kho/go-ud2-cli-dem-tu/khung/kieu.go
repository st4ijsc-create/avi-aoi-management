package bai

// TỆP NÀY CHO SẴN — không sửa.

// TuyChon điều khiển cách đếm từ.
type TuyChon struct {
	KhongPhanBietHoa bool     // true ⇒ đưa mọi từ (và từ dừng) về chữ thường bằng strings.ToLower
	BoQua            []string // từ dừng: không đếm
}

// DemMuc là một dòng của bảng kết quả.
type DemMuc struct {
	Tu    string
	SoLan int
}
