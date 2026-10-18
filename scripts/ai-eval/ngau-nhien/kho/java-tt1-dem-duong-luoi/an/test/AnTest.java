import java.util.Arrays;

public class AnTest {
    static String[] vuong(int n, char ky) {
        String[] g = new String[n];
        Arrays.fill(g, String.valueOf(ky).repeat(n));
        return g;
    }

    public static void main(String[] args) {
        Kt.chay("lưới 500x500 trống: modulo và đường dọc trước", () -> {
            String[] g = vuong(500, '.');
            Kt.bang(264223182L, DuongLuoi.demDuong(g));
            Kt.bang("D".repeat(499) + "R".repeat(499), DuongLuoi.duongNhoNhat(g));
        });
        Kt.chay("lưới 30x30 trống vượt modulo", () -> {
            Kt.bang(289070178L, DuongLuoi.demDuong(vuong(30, '.')));
        });
        Kt.chay("ô bắt buộc giữa lưới 500x500", () -> {
            String[] g = vuong(500, '.');
            g[250] = ".".repeat(250) + "*" + ".".repeat(249);
            Kt.bang(762921983L, DuongLuoi.demDuong(g));
            Kt.bang("D".repeat(250) + "R".repeat(250) + "D".repeat(249) + "R".repeat(249), DuongLuoi.duongNhoNhat(g));
        });
        Kt.chay("một hàng chặn kín lưới lớn", () -> {
            String[] g = vuong(500, '.');
            g[300] = "#".repeat(500);
            Kt.bang(0L, DuongLuoi.demDuong(g));
            Kt.bang(null, DuongLuoi.duongNhoNhat(g));
        });
        Kt.chay("ô đầu hoặc ô cuối bị chặn", () -> {
            Kt.bang(0L, DuongLuoi.demDuong(new String[] {"#..", "...", "..."}));
            Kt.bang(null, DuongLuoi.duongNhoNhat(new String[] {"#..", "...", "..."}));
            Kt.bang(0L, DuongLuoi.demDuong(new String[] {"...", "...", "..#"}));
            Kt.bang(null, DuongLuoi.duongNhoNhat(new String[] {"...", "...", "..#"}));
        });
        Kt.chay("lưới 1x1 và một hàng", () -> {
            Kt.bang(1L, DuongLuoi.demDuong(new String[] {"."}));
            Kt.bang("", DuongLuoi.duongNhoNhat(new String[] {"."}));
            Kt.bang(1L, DuongLuoi.demDuong(new String[] {"*"}));
            Kt.bang("", DuongLuoi.duongNhoNhat(new String[] {"*"}));
            Kt.bang(0L, DuongLuoi.demDuong(new String[] {"#"}));
            Kt.bang(null, DuongLuoi.duongNhoNhat(new String[] {"#"}));
            Kt.bang("RRRR", DuongLuoi.duongNhoNhat(new String[] {"....*"}));
        });
        Kt.chay("đi xuống trước dẫn vào ngõ cụt", () -> {
            String[] g = {"...", ".#.", ".#."};
            Kt.bang(1L, DuongLuoi.demDuong(g));
            Kt.bang("RRDD", DuongLuoi.duongNhoNhat(g));
        });
        Kt.chay("hai ô bắt buộc không cùng một đường", () -> {
            String[] g = {"..*", "...", "*.."};
            Kt.bang(0L, DuongLuoi.demDuong(g));
            Kt.bang(null, DuongLuoi.duongNhoNhat(g));
        });
        Kt.chay("hai ô bắt buộc nối tiếp", () -> {
            String[] g = {"....", ".*..", "...*", "...."};
            Kt.bang(6L, DuongLuoi.demDuong(g));
            Kt.bang("DRDRRD", DuongLuoi.duongNhoNhat(g));
        });
        Kt.chay("ô bắt buộc cùng chướng ngại", () -> {
            String[] g = {".*..", "..#.", "#..."};
            Kt.bang(2L, DuongLuoi.demDuong(g));
            Kt.bang("RDDRR", DuongLuoi.duongNhoNhat(g));
        });
        Kt.chay("lưới không hợp lệ", () -> {
            Kt.nem(IllegalArgumentException.class, () -> DuongLuoi.demDuong(new String[] {"...", ".."}));
            Kt.nem(IllegalArgumentException.class, () -> DuongLuoi.duongNhoNhat(new String[] {"..x"}));
            Kt.nem(IllegalArgumentException.class, () -> DuongLuoi.demDuong(new String[0]));
            Kt.nem(IllegalArgumentException.class, () -> DuongLuoi.demDuong(new String[] {""}));
            Kt.nem(IllegalArgumentException.class, () -> DuongLuoi.duongNhoNhat(null));
        });
        Kt.ketThuc();
    }
}
