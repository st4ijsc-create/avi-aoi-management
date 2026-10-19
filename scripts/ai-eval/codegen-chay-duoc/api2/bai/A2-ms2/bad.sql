-- SAI (lỗi điển hình): so sánh "<>" không tính NULL ⇒ NULL→'bar' và 'bar'→NULL bị bỏ sót.
CREATE OR ALTER PROCEDURE dbo.NapCauHinh @json nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @thayDoi TABLE (HanhDong nvarchar(10) NOT NULL, Ma nvarchar(50) NOT NULL);

  MERGE dbo.CauHinh AS dich
  USING (
    SELECT Ma, GiaTri, DonVi
    FROM OPENJSON(@json) WITH (Ma nvarchar(50) '$.ma', GiaTri decimal(18,4) '$.giaTri', DonVi nvarchar(10) '$.donVi')
  ) AS nguon
  ON dich.Ma = nguon.Ma
  WHEN MATCHED AND (dich.GiaTri <> nguon.GiaTri OR dich.DonVi <> nguon.DonVi) THEN
    UPDATE SET GiaTri = nguon.GiaTri, DonVi = nguon.DonVi, CapNhat = SYSUTCDATETIME()
  WHEN NOT MATCHED BY TARGET THEN
    INSERT (Ma, GiaTri, DonVi, CapNhat) VALUES (nguon.Ma, nguon.GiaTri, nguon.DonVi, SYSUTCDATETIME())
  OUTPUT $action, inserted.Ma INTO @thayDoi (HanhDong, Ma);

  SELECT HanhDong, Ma FROM @thayDoi ORDER BY Ma;
END
GO
