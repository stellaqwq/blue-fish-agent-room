param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'stop-room.ps1')
& (Join-Path $PSScriptRoot 'start-room.ps1') -NoBrowser:$NoBrowser
