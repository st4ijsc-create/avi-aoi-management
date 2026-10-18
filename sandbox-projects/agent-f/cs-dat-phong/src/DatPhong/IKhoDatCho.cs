namespace DatPhong;

public interface IKhoDatCho
{
    void Them(DatCho datCho);
    bool Xoa(Guid id);
    IReadOnlyList<DatCho> TheoPhong(string maPhong);
    IReadOnlyList<DatCho> TatCa();
}
