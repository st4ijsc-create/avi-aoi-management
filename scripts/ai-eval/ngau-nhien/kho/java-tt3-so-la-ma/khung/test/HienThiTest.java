public class HienThiTest {
    public static void main(String[] args) {
        Kt.chay("số sang La Mã", () -> {
            Kt.bang("XIV", LaMa.sangLaMa(14));
            Kt.bang("IX", LaMa.sangLaMa(9));
            Kt.bang("MMXXVI", LaMa.sangLaMa(2026));
        });
        Kt.chay("La Mã sang số và từ chối IIII", () -> {
            Kt.bang(42, LaMa.tuLaMa("XLII"));
            Kt.nem(IllegalArgumentException.class, () -> LaMa.tuLaMa("IIII"));
        });
        Kt.chay("cộng hai số La Mã", () -> {
            Kt.bang("XXI", LaMa.cong("XII", "IX"));
        });
        Kt.ketThuc();
    }
}
