param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$localDir = Join-Path $PSScriptRoot '.local'
New-Item -ItemType Directory -Force -Path $localDir | Out-Null
$roomUrl = 'http://127.0.0.1:4177'
$running = $false
try {
    $health = Invoke-RestMethod -Uri "$roomUrl/api/health" -TimeoutSec 2
    $running = $health.app -eq 'blue-fish-agent-room'
} catch {}
if (-not $running) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'dist\index.html'))) {
        Write-Host '请先在本目录运行 npm install 和 npm run build。'
        Read-Host '按回车关闭'
        exit 1
    }
    $serverPath = Join-Path $PSScriptRoot 'server.mjs'
    $roomProcess = Start-Process -FilePath $nodePath -ArgumentList @("`"$serverPath`"") -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $localDir 'server.log') -RedirectStandardError (Join-Path $localDir 'server-error.log')
    Set-Content -LiteralPath (Join-Path $localDir 'server-pid.txt') -Value $roomProcess.Id
    for ($attempt = 0; $attempt -lt 25; $attempt++) {
        Start-Sleep -Milliseconds 200
        try {
            $health = Invoke-RestMethod -Uri "$roomUrl/api/health" -TimeoutSec 1
            if ($health.app -eq 'blue-fish-agent-room') { $running = $true; break }
        } catch {}
    }
}
if ($running) {
    if (-not $NoBrowser) { Start-Process $roomUrl }
    Write-Host "房间已启动：$roomUrl"
} else {
    Write-Host '启动失败。请查看 .local\server-error.log，或检查 4177 端口是否已被占用。'
    Read-Host '按回车关闭'
}
