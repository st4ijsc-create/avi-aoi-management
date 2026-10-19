import java.util.List;
import java.util.Optional;
import java.util.TreeMap;

public final class KhoBoNho implements KhoDonHang {
    private final TreeMap<Long, DonHang> theoMa = new TreeMap<>();

    @Override
    public void luu(DonHang don) {
        theoMa.put(don.ma(), don);
    }

    @Override
    public Optional<DonHang> tim(long ma) {
        return Optional.ofNullable(theoMa.get(ma));
    }

    @Override
    public List<DonHang> tatCa() {
        return List.copyOf(theoMa.values());
    }
}
