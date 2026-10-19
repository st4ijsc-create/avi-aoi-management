#pragma once
#include <cstddef>
#include <istream>
#include <ostream>

#include "kho_kv.hpp"

// Đọc lệnh văn bản từng dòng từ `vao`, thực thi trên `kho`, ghi kết quả ra `ra`.
// Trả số dòng lỗi "ERR ..." đã in.
std::size_t chayLenh(KhoKV& kho, std::istream& vao, std::ostream& ra);
