#pragma once
#include <cstddef>
#include <istream>
#include <stdexcept>
#include <string>
#include <vector>

// Lỗi cú pháp CSV; `dong` là số dòng VẬT LÝ (từ 1) theo đặc tả.
struct LoiCsv : std::runtime_error {
  std::size_t dong;
  LoiCsv(std::size_t d, const std::string& thongDiep) : std::runtime_error(thongDiep), dong(d) {}
};

// Một bản ghi = danh sách trường.
using BanGhi = std::vector<std::string>;

// Đọc TOÀN BỘ luồng CSV.
std::vector<BanGhi> docCsv(std::istream& vao);
