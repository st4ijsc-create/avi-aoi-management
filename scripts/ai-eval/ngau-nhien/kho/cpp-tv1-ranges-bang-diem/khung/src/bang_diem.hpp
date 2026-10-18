#pragma once
#include <cstddef>
#include <optional>
#include <string>
#include <vector>

struct HocSinh {
  std::string ten;
  std::string lop;
  int toan;
  int van;
  int anh;
};

struct XepHang {
  int hang;
  std::string ten;
  std::string lop;
  int tong;
  int toan;
  bool operator==(const XepHang&) const = default;
};

// Tổng ba môn.
int tongDiem(const HocSinh& h);

// Bảng xếp hạng đầy đủ.
std::vector<XepHang> xepHang(const std::vector<HocSinh>& ds);

// Tên các học sinh có MỌI môn >= nguong, giữ thứ tự đầu vào.
std::vector<std::string> tenDatChuan(const std::vector<HocSinh>& ds, int nguong);

// Dồn học sinh có tổng >= nguongTong lên đầu (ổn định), trả số học sinh đạt.
std::size_t tachDatTruot(std::vector<HocSinh>& ds, int nguongTong);

// Trung bình tổng điểm của lớp; lớp không có ai thì không có giá trị.
std::optional<double> trungBinhLop(const std::vector<HocSinh>& ds, const std::string& lop);

// Học sinh đứng đầu mỗi lớp.
std::vector<XepHang> thuKhoaTheoLop(const std::vector<HocSinh>& ds);
