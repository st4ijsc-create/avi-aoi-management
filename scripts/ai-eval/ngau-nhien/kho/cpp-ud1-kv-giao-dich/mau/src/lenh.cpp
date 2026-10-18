#include "lenh.hpp"

#include <string>
#include <vector>

namespace {
std::vector<std::string> tach(const std::string& dong) {
  std::vector<std::string> ds;
  std::string cur;
  for (char c : dong) {
    if (c == ' ' || c == '\t') {
      if (!cur.empty()) ds.push_back(std::move(cur));
      cur.clear();
    } else {
      cur += c;
    }
  }
  if (!cur.empty()) ds.push_back(std::move(cur));
  return ds;
}

std::string hoa(std::string s) {
  for (char& c : s)
    if (c >= 'a' && c <= 'z') c = static_cast<char>(c - 'a' + 'A');
  return s;
}

std::size_t soThamSo(const std::string& ten) {
  if (ten == "SET") return 2;
  if (ten == "GET" || ten == "UNSET" || ten == "COUNT") return 1;
  return 0;  // BEGIN ROLLBACK COMMIT SIZE END
}
}  // namespace

std::size_t chayLenh(KhoKV& kho, std::istream& vao, std::ostream& ra) {
  std::size_t loi = 0;
  std::string dong;
  while (std::getline(vao, dong)) {
    if (!dong.empty() && dong.back() == '\r') dong.pop_back();
    const std::vector<std::string> t = tach(dong);
    if (t.empty()) continue;
    const std::string ten = hoa(t[0]);
    static const char* const BIET[] = {"SET", "GET", "UNSET", "COUNT", "SIZE", "BEGIN", "ROLLBACK", "COMMIT", "END"};
    bool biet = false;
    for (const char* b : BIET) biet = biet || ten == b;
    if (!biet) {
      ra << "ERR unknown command: " << t[0] << '\n';
      ++loi;
      continue;
    }
    if (t.size() - 1 != soThamSo(ten)) {
      ra << "ERR wrong number of arguments for " << ten << '\n';
      ++loi;
      continue;
    }
    if (ten == "SET") {
      kho.dat(t[1], t[2]);
    } else if (ten == "GET") {
      auto v = kho.lay(t[1]);
      ra << (v ? *v : std::string("NULL")) << '\n';
    } else if (ten == "UNSET") {
      kho.xoa(t[1]);
    } else if (ten == "COUNT") {
      ra << kho.dem(t[1]) << '\n';
    } else if (ten == "SIZE") {
      ra << kho.kichThuoc() << '\n';
    } else if (ten == "BEGIN") {
      kho.batDau();
    } else if (ten == "ROLLBACK") {
      if (!kho.hoanTac()) ra << "NO TRANSACTION\n";
    } else if (ten == "COMMIT") {
      if (!kho.xacNhan()) ra << "NO TRANSACTION\n";
    } else {  // END
      break;
    }
  }
  return loi;
}
