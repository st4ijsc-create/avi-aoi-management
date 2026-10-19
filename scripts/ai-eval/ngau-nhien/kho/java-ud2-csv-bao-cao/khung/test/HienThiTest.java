import java.math.BigDecimal;
import java.util.List;

public class HienThiTest {
    static final String CSV = "nhom,so_tien\nBút,10.5\nVở,20\nBút,4.25\n";

    public static void main(String[] args) {
        Kt.chay("phân tích CSV có ô bọc nháy chứa dấu phẩy", () -> {
            Kt.bang(List.of(List.of("a", "b,c", "d"), List.of("1", "2", "3")), DocCsv.phanTich("a,\"b,c\",d\n1,2,3\n"));
        });
        Kt.chay("tổng hợp theo nhóm", () -> {
            Kt.bang(List.of(
                new DongBaoCao("Vở", 1, new BigDecimal("20.00"), new BigDecimal("20.00")),
                new DongBaoCao("Bút", 2, new BigDecimal("14.75"), new BigDecimal("7.38"))), BaoCao.tongHop(CSV));
        });
        Kt.chay("bảng căn cột", () -> {
            String mong = ""
                + "Nhóm | Số dòng |  Tổng | Trung bình\n"
                + "-----+---------+-------+-----------\n"
                + "Vở   |       1 | 20.00 |      20.00\n"
                + "Bút  |       2 | 14.75 |       7.38\n"
                + "-----+---------+-------+-----------\n"
                + "Cộng |       3 | 34.75 |      11.58\n";
            Kt.bang(mong, BaoCao.lapBang(CSV));
        });
        Kt.ketThuc();
    }
}
