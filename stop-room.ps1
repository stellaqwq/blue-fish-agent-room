$ErrorActionPreference = 'Stop'
$pidFile = Join-Path $PSScriptRoot '.local\server-pid.txt'
if (Test-Path -LiteralPath $pidFile) {
    $roomProcessId = [int](Get-Content -LiteralPath $pidFile)
    $roomProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $roomProcessId"
    $serverPath = Join-Path $PSScriptRoot 'server.mjs'
    if ($roomProcess -and $roomProcess.Name -eq 'node.exe' -and $roomProcess.CommandLine.Contains($serverPath)) {
        Stop-Process -Id $roomProcessId
        Write-Host '房间服务已关闭。'
    }
}
