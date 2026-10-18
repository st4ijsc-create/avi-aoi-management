package bai

import "fmt"

// LoaiLoi phân loại lỗi của TinhRPN / ChuyenTrungTo. TỆP NÀY CHO SẴN — không sửa.
type LoaiLoi int

const (
	LoiTokenLa       LoaiLoi = iota + 1 // token/ký tự không phải số, toán tử (hay ngoặc với ChuyenTrungTo)
	LoiThieuToanHang                    // toán tử không đủ 2 toán hạng, hoặc biểu thức rỗng
	LoiDuToanHang                       // hết token mà ngăn xếp còn nhiều hơn 1 giá trị
	LoiChiaKhong                        // chia hoặc lấy dư cho 0
	LoiTranSo                           // số hoặc kết quả phép tính nằm ngoài int64
	LoiNgoac                            // ngoặc không khớp (chỉ ChuyenTrungTo)
)

// LoiRPN là kiểu lỗi DUY NHẤT hai hàm trả về (luôn là *LoiRPN).
type LoiRPN struct {
	ViTri int     // TinhRPN: chỉ số token (từ 0); ChuyenTrungTo: vị trí BYTE (từ 0) trong chuỗi vào
	Loai  LoaiLoi // loại lỗi
	Token string  // token/ký tự gây lỗi ("" nếu không có)
}

func (e *LoiRPN) Error() string {
	return fmt.Sprintf("rpn: loi loai %d tai vi tri %d (%q)", e.Loai, e.ViTri, e.Token)
}
