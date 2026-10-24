# Đợt 9 (2026-10-24, dieu-phoi duyệt) — chọn tệp `--mmproj` (bộ chiếu thị giác) cho llama-server THEO MODEL. Dot-source:
#   . "$PSScriptRoot\tim-mmproj.ps1";  $mm = Resolve-Mmproj -ModelPath $modelPath -CheDo $cheDo
# CheDo: 'off' (không nạp) | 'auto' (tìm `<tên model bỏ đuôi lượng tử>-mmproj-<F16|BF16|F32>.gguf` CẠNH model — Qwen3.6-35B-A3B và
# 27B có mmproj RIÊNG, KheNang đổi khe 35B↔27B thì mmproj đổi theo) | đường dẫn tệp .gguf tường minh.
# Trả đường dẫn (dấu /) hoặc $null. Không tìm thấy ở 'auto' ⇒ $null (model chạy chữ như cũ). Đường dẫn tường minh không tồn tại ⇒ ném.
function Get-TenGocModelBoLuongTu([string]$tenTep) {
    $goc = [System.IO.Path]::GetFileNameWithoutExtension($tenTep)
    # Bỏ đuôi lượng tử kiểu unsloth/bartowski: -UD-Q4_K_XL · -Q4_K_M · -IQ3_XXS · -Q8_0 · -F16 · -BF16 (không phân biệt hoa thường).
    return ($goc -replace '(?i)-(UD-)?(I?Q\d[A-Z0-9_]*|BF16|F16|F32)$', '')
}
function Resolve-Mmproj([string]$ModelPath, [string]$CheDo) {
    $c = if ($CheDo) { $CheDo.Trim() } else { 'off' }
    if ($c -eq '' -or $c -ieq 'off') { return $null }
    if ($c -ine 'auto') {
        if (-not (Test-Path -LiteralPath $c -PathType Leaf)) { throw "LLAMA_SERVER_MMPROJ: không có tệp $c" }
        return (Resolve-Path -LiteralPath $c).Path.Replace('\', '/')
    }
    $thuMuc = Split-Path -Parent $ModelPath
    $goc = Get-TenGocModelBoLuongTu (Split-Path -Leaf $ModelPath)
    if ([string]::IsNullOrWhiteSpace($goc) -or $goc -imatch 'mmproj') { return $null }
    foreach ($duoi in @('F16', 'BF16', 'F32')) {
        $cand = Join-Path $thuMuc "$goc-mmproj-$duoi.gguf"
        if (Test-Path -LiteralPath $cand -PathType Leaf) { return (Resolve-Path -LiteralPath $cand).Path.Replace('\', '/') }
    }
    return $null
}
