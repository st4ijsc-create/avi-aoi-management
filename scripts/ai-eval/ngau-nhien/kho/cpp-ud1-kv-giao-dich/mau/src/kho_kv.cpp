#include "kho_kv.hpp"

namespace {
using Bang = std::unordered_map<std::string, std::string>;
using Dem = std::unordered_map<std::string, std::size_t>;

void giam(Dem& dem, const std::string& v) {
  auto it = dem.find(v);
  if (it != dem.end() && --it->second == 0) dem.erase(it);
}

// Dat khoa ve trang thai `moi` (nullopt = khong co), cap nhat bo dem.
void ganTrangThai(Bang& du, Dem& dem, const std::string& khoa, const std::optional<std::string>& moi) {
  auto it = du.find(khoa);
  if (it != du.end()) {
    giam(dem, it->second);
    if (moi) {
      it->second = *moi;
      ++dem[*moi];
    } else {
      du.erase(it);
    }
  } else if (moi) {
    du.emplace(khoa, *moi);
    ++dem[*moi];
  }
}
}  // namespace

void KhoKV::dat(const std::string& khoa, const std::string& giaTri) {
  if (!nhatKy_.empty() && !nhatKy_.back().count(khoa)) nhatKy_.back().emplace(khoa, lay(khoa));
  ganTrangThai(duLieu_, demGiaTri_, khoa, giaTri);
}

std::optional<std::string> KhoKV::lay(const std::string& khoa) const {
  auto it = duLieu_.find(khoa);
  if (it == duLieu_.end()) return std::nullopt;
  return it->second;
}

bool KhoKV::xoa(const std::string& khoa) {
  if (!duLieu_.count(khoa)) return false;
  if (!nhatKy_.empty() && !nhatKy_.back().count(khoa)) nhatKy_.back().emplace(khoa, lay(khoa));
  ganTrangThai(duLieu_, demGiaTri_, khoa, std::nullopt);
  return true;
}

std::size_t KhoKV::dem(const std::string& giaTri) const {
  auto it = demGiaTri_.find(giaTri);
  return it == demGiaTri_.end() ? 0 : it->second;
}

std::size_t KhoKV::kichThuoc() const { return duLieu_.size(); }

void KhoKV::batDau() { nhatKy_.emplace_back(); }

bool KhoKV::hoanTac() {
  if (nhatKy_.empty()) return false;
  for (const auto& [khoa, cu] : nhatKy_.back()) ganTrangThai(duLieu_, demGiaTri_, khoa, cu);
  nhatKy_.pop_back();
  return true;
}

bool KhoKV::xacNhan() {
  if (nhatKy_.empty()) return false;
  nhatKy_.clear();
  return true;
}

std::size_t KhoKV::doSau() const { return nhatKy_.size(); }
