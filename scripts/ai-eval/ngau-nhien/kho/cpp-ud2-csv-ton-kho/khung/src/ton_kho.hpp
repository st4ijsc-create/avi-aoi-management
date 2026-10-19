#pragma once
#include <cstddef>
#include <istream>
#include <string>
#include <string_view>
#include <vector>

#include "csv.hpp"

// Số lượng lưu theo đơn vị 1/100 (vd 12.50 -> 1250) để không sai số dấu phẩy động.
struct HangTon {
  std::string ma;
  std::string ten;
  long long ton;
  bool operator==(const HangTon&) const = default;
};

struct CanhBao {
  std::size_t banGhi;  // số thứ tự bản ghi (bản ghi tiêu đề = 1)
  std::string ma;
  long long tonSau;
  bool operator==(const CanhBao&) const = default;
};

struct LoiDong {
  std::size_t banGhi;
  std::string lyDo;  // "so truong" | "ma rong" | "loai" | "so luong"
  bool operator==(const LoiDong&) const = default;
};

struct KetQuaTonKho {
  std::vector<HangTon> hang;
  std::vector<CanhBao> canhBao;
  std::vector<LoiDong> loi;
  bool operator==(const KetQuaTonKho&) const = default;
};

// "12.5" -> 1250; sai định dạng -> std::invalid_argument.
long long docSoLuong(std::string_view s);

// 1250 -> "12.50", -5 -> "-0.05".
std::string inSoLuong(long long phanTram);

// banGhi[0] là dòng tiêu đề.
KetQuaTonKho tinhTonKho(const std::vector<BanGhi>& banGhi);

// Báo cáo văn bản căn cột.
std::string baoCao(const KetQuaTonKho& kq);

// baoCao(tinhTonKho(docCsv(vao))).
std::string xuLyCsv(std::istream& vao);
