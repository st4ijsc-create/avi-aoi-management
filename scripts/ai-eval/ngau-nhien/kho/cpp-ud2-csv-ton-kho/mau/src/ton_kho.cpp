#include "ton_kho.hpp"

#include <algorithm>
#include <map>
#include <stdexcept>

namespace {
bool laSo(char c) { return c >= '0' && c <= '9'; }

// So ky tu Unicode (dem byte khong phai byte tiep noi UTF-8).
std::size_t doRong(const std::string& s) {
  std::size_t n = 0;
  for (char ch : s)
    if ((static_cast<unsigned char>(ch) & 0xC0) != 0x80) ++n;
  return n;
}

std::string canTrai(const std::string& s, std::size_t w) {
  const std::size_t r = doRong(s);
  return r >= w ? s : s + std::string(w - r, ' ');
}

std::string canPhai(const std::string& s, std::size_t w) {
  const std::size_t r = doRong(s);
  return r >= w ? s : std::string(w - r, ' ') + s;
}
}  // namespace

long long docSoLuong(std::string_view s) {
  const std::size_t cham = s.find('.');
  const std::string_view nguyen = s.substr(0, cham);
  const std::string_view le = cham == std::string_view::npos ? std::string_view{} : s.substr(cham + 1);
  bool ok = !nguyen.empty() && nguyen.size() <= 12 && std::all_of(nguyen.begin(), nguyen.end(), laSo);
  if (cham != std::string_view::npos) ok = ok && !le.empty() && le.size() <= 2 && std::all_of(le.begin(), le.end(), laSo);
  if (!ok) throw std::invalid_argument("so luong sai dinh dang");
  long long v = 0;
  for (char c : nguyen) v = v * 10 + (c - '0');
  long long phan = 0;
  for (std::size_t i = 0; i < 2; ++i) phan = phan * 10 + (i < le.size() ? le[i] - '0' : 0);
  return v * 100 + phan;
}

std::string inSoLuong(long long phanTram) {
  const bool am = phanTram < 0;
  const unsigned long long a = am ? 0ull - static_cast<unsigned long long>(phanTram) : static_cast<unsigned long long>(phanTram);
  std::string le = std::to_string(a % 100);
  if (le.size() < 2) le = "0" + le;
  return (am ? "-" : "") + std::to_string(a / 100) + "." + le;
}

KetQuaTonKho tinhTonKho(const std::vector<BanGhi>& banGhi) {
  if (banGhi.empty() || banGhi[0] != BanGhi{"ma", "ten", "loai", "so_luong"})
    throw std::invalid_argument("tieu de CSV phai la ma,ten,loai,so_luong");
  KetQuaTonKho kq;
  std::map<std::string, HangTon> theoMa;
  for (std::size_t i = 1; i < banGhi.size(); ++i) {
    const BanGhi& b = banGhi[i];
    const std::size_t so = i + 1;
    if (b.size() != 4) { kq.loi.push_back({so, "so truong"}); continue; }
    if (b[0].empty()) { kq.loi.push_back({so, "ma rong"}); continue; }
    if (b[2] != "NHAP" && b[2] != "XUAT") { kq.loi.push_back({so, "loai"}); continue; }
    long long q = 0;
    try {
      q = docSoLuong(b[3]);
    } catch (const std::invalid_argument&) {
      kq.loi.push_back({so, "so luong"});
      continue;
    }
    auto it = theoMa.try_emplace(b[0], HangTon{b[0], b[1], 0}).first;
    if (b[2] == "NHAP") {
      it->second.ton += q;
    } else {
      it->second.ton -= q;
      if (it->second.ton < 0) kq.canhBao.push_back({so, b[0], it->second.ton});
    }
  }
  for (auto& [ma, h] : theoMa) kq.hang.push_back(h);
  return kq;
}

std::string baoCao(const KetQuaTonKho& kq) {
  std::size_t w1 = 2, w2 = 3, w3 = 3;
  for (const auto& h : kq.hang) {
    w1 = std::max(w1, doRong(h.ma));
    w2 = std::max(w2, doRong(h.ten));
    w3 = std::max(w3, inSoLuong(h.ton).size());
  }
  std::string o = canTrai("MA", w1) + "  " + canTrai("TEN", w2) + "  " + canPhai("TON", w3) + "\n";
  for (const auto& h : kq.hang)
    o += canTrai(h.ma, w1) + "  " + canTrai(h.ten, w2) + "  " + canPhai(inSoLuong(h.ton), w3) + "\n";
  for (const auto& c : kq.canhBao)
    o += "CANH BAO: ban ghi " + std::to_string(c.banGhi) + ", ma " + c.ma + ", ton " + inSoLuong(c.tonSau) + "\n";
  for (const auto& l : kq.loi) o += "LOI: ban ghi " + std::to_string(l.banGhi) + ": " + l.lyDo + "\n";
  return o;
}

std::string xuLyCsv(std::istream& vao) { return baoCao(tinhTonKho(docCsv(vao))); }
