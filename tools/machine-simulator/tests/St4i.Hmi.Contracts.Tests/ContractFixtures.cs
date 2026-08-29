namespace St4i.Hmi.Contracts.Tests;

/// <summary>Định vị thư mục <c>contracts/</c> bằng cách đi ngược từ thư mục chạy test lên tới thư mục
/// chứa <c>St4iMachineSimulator.sln</c>. Không hard-code đường dẫn tuyệt đối, và không phụ thuộc vào
/// <c>CopyToOutputDirectory</c> — fixture phải là MỘT bản duy nhất, dùng chung với phía web; sao chép
/// nó vào thư mục build là cách sinh ra bản thứ hai âm thầm lệch đi.</summary>
public static class ContractFixtures
{
    public static string ContractsDir { get; } = Locate();

    static string Locate()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "St4iMachineSimulator.sln")))
            dir = dir.Parent;
        if (dir is null)
            throw new InvalidOperationException(
                "Không tìm thấy St4iMachineSimulator.sln khi đi ngược từ " + AppContext.BaseDirectory);
        return Path.Combine(dir.FullName, "contracts");
    }

    public static string RepoRelative(string relative) => Path.Combine(ContractsDir, relative);

    public static IReadOnlyList<string> ValidFiles(string prefix) => Files("valid", prefix);
    public static IReadOnlyList<string> InvalidFiles(string prefix) => Files("invalid", prefix);

    static IReadOnlyList<string> Files(string bucket, string prefix) =>
        Directory.EnumerateFiles(Path.Combine(ContractsDir, "fixtures", bucket), prefix + "*.json")
                 .OrderBy(p => p, StringComparer.Ordinal)
                 .ToList();
}
