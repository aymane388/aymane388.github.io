$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Set-Location $PSScriptRoot
docker compose --profile tunnel down

if ($LASTEXITCODE -ne 0) {
    throw "Docker n'a pas pu arrêter proprement le moteur Miqdar."
}

Write-Host "Le moteur Miqdar et son tunnel sont arrêtés." -ForegroundColor Green
