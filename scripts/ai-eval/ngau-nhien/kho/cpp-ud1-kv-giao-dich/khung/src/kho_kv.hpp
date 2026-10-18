#pragma once
#include <cstddef>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

// Kho khoá-giá trị trong bộ nhớ có giao dịch lồng nhau.
class KhoKV {
 public:
  // Đặt (hoặc ghi đè) giá trị của khoá.
  void dat(const std::string& khoa, const std::string& giaTri);
  // Giá trị hiện tại của khoá, hoặc std::nullopt nếu không có.
  std::optional<std::string> lay(const std::string& khoa) const;
  // Xoá khoá; true nếu khoá có tồn tại trước đó.
  bool xoa(const std::string& khoa);
  // Số khoá hiện có giá trị đúng bằng giaTri.
  std::size_t dem(const std::string& giaTri) const;
  // Số khoá hiện có.
  std::size_t kichThuoc() const;

  // Mở một giao dịch mới (lồng trong giao dịch đang mở, nếu có).
  void batDau();
  // Huỷ mọi thay đổi của giao dịch trong cùng rồi đóng nó; false nếu không có giao dịch nào.
  bool hoanTac();
  // Giữ vĩnh viễn mọi thay đổi và đóng TẤT CẢ giao dịch; false nếu không có giao dịch nào.
  bool xacNhan();
  // Số giao dịch đang mở.
  std::size_t doSau() const;

 private:
  std::unordered_map<std::string, std::string> duLieu_;
  // giá trị -> số khoá đang mang giá trị đó
  std::unordered_map<std::string, std::size_t> demGiaTri_;
  // Mỗi giao dịch đang mở: khoá -> giá trị TRƯỚC lần sửa đầu tiên trong giao dịch đó (nullopt = khi ấy chưa có khoá).
  std::vector<std::unordered_map<std::string, std::optional<std::string>>> nhatKy_;
};
