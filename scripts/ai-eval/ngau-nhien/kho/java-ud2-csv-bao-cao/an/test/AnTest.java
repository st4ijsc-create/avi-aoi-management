import java.math.BigDecimal;
import java.util.List;

public class AnTest {
    static final String CSV_DAY = "ma,so_tien,ghi_chu,nhom\r\n"
        + "1, 12.5 ,x,\"Hà Nội, Việt Nam\"\r\n"
        + "2,-2.5,\"có \"\"nháy\"\"\",Huế\r\n"
        + "3,7.5,,\"Hà Nội, Việt Nam\"\r\n"
        + "4,0.125,y,Đà Nẵng";

    static BigDecimal bd(String s) {
        return new BigDecimal(s);
    }

    public static void main(String[] args) {
        Kt.chay("CSV: nháy kép thoát, xuống dòng LF và CRLF trong ô", () -> {
            String t = "a,\"b,c\",\"say \"\"hi\"\"\"\r\n\"x\ny\",z\r\n\"p\r\nq\",\n";
            Kt.bang(List.of(List.of("a", "b,c", "say \"hi\""), List.of("x\ny", "z"), List.of("p\r\nq", "")),
                DocCsv.phanTich(t));
        });
        Kt.chay("CSV: văn bản rỗng, xuống dòng cuối, dòng trống ở giữa", () -> {
            Kt.bang(List.of(), DocCsv.phanTich(""));
            Kt.bang(List.of(List.of("")), DocCsv.phanTich("\n"));
            Kt.bang(List.of(List.of("a"), List.of(""), List.of("b")), DocCsv.phanTich("a\n\nb"));
            Kt.bang(List.of(List.of("a")), DocCsv.phanTich("a\r\n"));
            Kt.bang(List.of(List.of("a"), List.of("")), DocCsv.phanTich("a\n\n"));
            Kt.bang(List.of(List.of("a", "b"), List.of("c", "d")), DocCsv.phanTich("a,b\r\nc,d\r\n"));
        });
        Kt.chay("CSV: ô rỗng", () -> {
            Kt.bang(List.of(List.of("", "", "")), DocCsv.phanTich(",,"));
            Kt.bang(List.of(List.of("", "x")), DocCsv.phanTich("\"\",x"));
            Kt.bang(List.of(List.of("a", "")), DocCsv.phanTich("a,"));
            Kt.bang(List.of(List.of("")), DocCsv.phanTich("\"\""));
        });
        Kt.chay("CSV: giữ khoảng trắng, CR đứng một mình là ký tự thường", () -> {
            Kt.bang(List.of(List.of(" a ", " b ")), DocCsv.phanTich(" a , b "));
            Kt.bang(List.of(List.of("a\rb", "c")), DocCsv.phanTich("a\rb,c"));
        });
        Kt.chay("CSV: lỗi định dạng ném IllegalArgumentException", () -> {
            for (String t : new String[] {"a\"b", "\"ab\"c", "\"abc", "\"a\"\"", " \"a\"", "x,\"y\" ,z", "1,2\n\"3"}) {
                Kt.nem(IllegalArgumentException.class, () -> DocCsv.phanTich(t));
            }
        });
        Kt.chay("tổng hợp: cột đổi chỗ, cột thừa, số âm, cắt khoảng trắng số, HALF_UP", () -> {
            Kt.bang(List.of(
                new DongBaoCao("Hà Nội, Việt Nam", 2, bd("20.00"), bd("10.00")),
                new DongBaoCao("Đà Nẵng", 1, bd("0.13"), bd("0.13")),
                new DongBaoCao("Huế", 1, bd("-2.50"), bd("-2.50"))), BaoCao.tongHop(CSV_DAY));
        });
        Kt.chay("bảng đầy đủ: độ rộng theo ô dài nhất, dòng Cộng tính từ số chính xác", () -> {
            String mong = ""
                + "Nhóm             | Số dòng |  Tổng | Trung bình\n"
                + "-----------------+---------+-------+-----------\n"
                + "Hà Nội, Việt Nam |       2 | 20.00 |      10.00\n"
                + "Đà Nẵng          |       1 |  0.13 |       0.13\n"
                + "Huế              |       1 | -2.50 |      -2.50\n"
                + "-----------------+---------+-------+-----------\n"
                + "Cộng             |       4 | 17.63 |       4.41\n";
            Kt.bang(mong, BaoCao.lapBang(CSV_DAY));
        });
        Kt.chay("Cộng = làm tròn tổng chính xác (không cộng số đã làm tròn); hoà xếp theo tên", () -> {
            String mong = ""
                + "Nhóm | Số dòng | Tổng | Trung bình\n"
                + "-----+---------+------+-----------\n"
                + "A    |       1 | 0.01 |       0.01\n"
                + "B    |       1 | 0.01 |       0.01\n"
                + "-----+---------+------+-----------\n"
                + "Cộng |       2 | 0.01 |       0.01\n";
            Kt.bang(mong, BaoCao.lapBang("nhom,so_tien\nB,0.005\nA,0.005\n"));
        });
        Kt.chay("sắp theo tổng CHÍNH XÁC trước khi làm tròn", () -> {
            Kt.bang(List.of(new DongBaoCao("Y", 1, bd("0.00"), bd("0.00")), new DongBaoCao("X", 1, bd("0.00"), bd("0.00"))),
                BaoCao.tongHop("nhom,so_tien\nX,0.001\nY,0.004\n"));
        });
        Kt.chay("chỉ có tiêu đề ⇒ bảng rỗng với dòng Cộng bằng 0", () -> {
            Kt.bang(List.of(), BaoCao.tongHop("nhom,so_tien\n"));
            String mong = ""
                + "Nhóm | Số dòng | Tổng | Trung bình\n"
                + "-----+---------+------+-----------\n"
                + "-----+---------+------+-----------\n"
                + "Cộng |       0 | 0.00 |       0.00\n";
            Kt.bang(mong, BaoCao.lapBang("nhom,so_tien"));
        });
        Kt.chay("BigDecimal: số rất lớn và trung bình 1.005 làm tròn lên", () -> {
            Kt.bang(List.of(
                new DongBaoCao("L", 2, bd("12345678901234567890.13"), bd("6172839450617283945.06")),
                new DongBaoCao("X", 2, bd("2.01"), bd("1.01"))),
                BaoCao.tongHop("nhom,so_tien\nX,1.00\nX,1.01\nL,12345678901234567890.125\nL,0\n"));
        });
        Kt.chay("lỗi dữ liệu báo cáo ném IllegalArgumentException", () -> {
            for (String t : new String[] {
                "", "nhom,tien\nA,1\n", "nhom, so_tien\nA,1\n", "NHOM,SO_TIEN\nA,1\n", "nhom,so_tien\nA,1,2\n",
                "nhom,so_tien\nA\n", "nhom,so_tien\nA,abc\n", "nhom,so_tien\nA,\n", "nhom,so_tien\nA,1\n\n",
                "nhom,so_tien\n\"A,1\n"}) {
                Kt.nem(IllegalArgumentException.class, () -> BaoCao.lapBang(t));
                Kt.nem(IllegalArgumentException.class, () -> BaoCao.tongHop(t));
            }
        });
        Kt.ketThuc();
    }
}
