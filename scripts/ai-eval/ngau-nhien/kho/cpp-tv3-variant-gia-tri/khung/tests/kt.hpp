// Trình kiểm thử tối giản cho bộ đo (không GoogleTest). ĐỪNG SỬA tệp này (tệp được bảo vệ — sửa ⇒ bài TRƯỢT).
// Dùng trong một tệp test có main():
//   kt::chay("tên", [] { KT_BANG(mongDoi, thucTe); KT_DUNG(dieuKien); KT_NEM(std::invalid_argument, bieuThuc); });
//   return kt::ketThuc();   // in "KT_TONG pass=X fail=Y", trả 0 nếu không trượt
#pragma once
#include <cmath>
#include <functional>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>

namespace kt {

struct LoiKiem : std::runtime_error {
  using std::runtime_error::runtime_error;
};

inline int& dat() { static int d = 0; return d; }
inline int& truot() { static int t = 0; return t; }

inline void chay(const std::string& ten, const std::function<void()>& f) {
  try {
    f();
    ++dat();
    std::cout << "ok - " << ten << "\n";
  } catch (const std::exception& e) {
    ++truot();
    std::cout << "TRUOT - " << ten << ": " << e.what() << "\n";
  } catch (...) {
    ++truot();
    std::cout << "TRUOT - " << ten << ": ngoai le la\n";
  }
}

template <class A, class B>
void bang(const A& mongDoi, const B& thucTe, const char* bieuThuc, int dong) {
  if (!(thucTe == mongDoi)) {
    std::ostringstream o;
    o << "dong " << dong << ": khong bang: " << bieuThuc;
    throw LoiKiem(o.str());
  }
}

inline void gan(double mongDoi, double thucTe, double saiSo, const char* bieuThuc, int dong) {
  if (std::isnan(thucTe) || std::fabs(mongDoi - thucTe) > saiSo) {
    std::ostringstream o;
    o << "dong " << dong << ": " << bieuThuc << " = " << thucTe << ", mong doi ~" << mongDoi;
    throw LoiKiem(o.str());
  }
}

inline void dung(bool dieuKien, const char* bieuThuc, int dong) {
  if (!dieuKien) {
    std::ostringstream o;
    o << "dong " << dong << ": sai: " << bieuThuc;
    throw LoiKiem(o.str());
  }
}

template <class E, class F>
void nem(F&& f, const char* bieuThuc, int dong) {
  try {
    f();
  } catch (const E&) {
    return;
  } catch (...) {
    std::ostringstream o;
    o << "dong " << dong << ": nem sai loai: " << bieuThuc;
    throw LoiKiem(o.str());
  }
  std::ostringstream o;
  o << "dong " << dong << ": khong nem: " << bieuThuc;
  throw LoiKiem(o.str());
}

inline int ketThuc() {
  std::cout << "KT_TONG pass=" << dat() << " fail=" << truot() << std::endl;
  return truot() == 0 ? 0 : 1;
}

}  // namespace kt

#define KT_BANG(mongDoi, thucTe) ::kt::bang((mongDoi), (thucTe), #thucTe " == " #mongDoi, __LINE__)
#define KT_GAN(mongDoi, thucTe, saiSo) ::kt::gan((mongDoi), (thucTe), (saiSo), #thucTe, __LINE__)
#define KT_DUNG(dieuKien) ::kt::dung((dieuKien), #dieuKien, __LINE__)
#define KT_NEM(Loai, bieuThuc) ::kt::nem<Loai>([&] { (void)(bieuThuc); }, #bieuThuc, __LINE__)
