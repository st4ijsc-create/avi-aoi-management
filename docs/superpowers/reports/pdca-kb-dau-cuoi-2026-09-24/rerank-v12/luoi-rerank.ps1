param([string]$Pool, [string]$Blend, [string]$Nhan)
$env:RAG_RERANKER_POOL = $Pool; $env:RAG_RERANKER_MAX_CANDIDATES = $Pool; $env:RAG_RERANKER_BLEND = $Blend
& D:\SOURCES\avi-aoi-management\tmp\audit-ai\restart-sach.ps1 -Log "node-16-$Nhan" | Select-Object -Last 1
Set-Location D:\SOURCES\avi-aoi-management
"=== $Nhan pool=$Pool blend=$Blend"
node tmp/hang-v9.mjs scripts/ai-eval/thuat-ngu-viet-anh-giu-lai.jsonl | Select-String 'LN0[5-9]|LN1'
node tmp/hang-v9.mjs knowledge/studio-golden/st4i-may-aoi.jsonl T17,T79
node tmp/guard-endpoint.mjs $Nhan
Select-String -Path "tmp\audit-ai\node-16-$Nhan.log" -Pattern 'rerank backend' | Select-Object -Last 1 | ForEach-Object { $_.Line.Substring(0, [Math]::Min(140, $_.Line.Length)) }
