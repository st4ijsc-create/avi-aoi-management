#include <sstream>
#include <string>

#include "kho_kv.hpp"
#include "kt.hpp"
#include "lenh.hpp"

static std::string chay(KhoKV& kho, const std::string& kichBan, std::size_t& loi) {
  std::istringstream vao(kichBan);
  std::ostringstream ra;
  loi = chayLenh(kho, vao, ra);
  return ra.str();
}

int main() {
  kt::chay("api co ban", [] {
    KhoKV kho;
    kho.dat("a", "1");
    kho.dat("b", "1");
    KT_BANG(std::optional<std::string>("1"), kho.lay("a"));
    KT_BANG(std::size_t{2}, kho.dem("1"));
    KT_DUNG(kho.xoa("a"));
    KT_DUNG(!kho.lay("a").has_value());
    KT_BANG(std::size_t{1}, kho.dem("1"));
  });
  kt::chay("lenh co ban", [] {
    KhoKV kho;
    std::size_t loi = 99;
    KT_BANG(std::string("10\n1\nNULL\n"), chay(kho, "SET a 10\nGET a\nCOUNT 10\nUNSET a\nGET a\n", loi));
    KT_BANG(std::size_t{0}, loi);
  });
  kt::chay("giao dich mot cap", [] {
    KhoKV kho;
    std::size_t loi = 99;
    const std::string kichBan = "BEGIN\nSET a 1\nROLLBACK\nGET a\nBEGIN\nSET b 2\nCOMMIT\nGET b\nROLLBACK\n";
    KT_BANG(std::string("NULL\n2\nNO TRANSACTION\n"), chay(kho, kichBan, loi));
    KT_BANG(std::size_t{0}, loi);
  });
  return kt::ketThuc();
}
