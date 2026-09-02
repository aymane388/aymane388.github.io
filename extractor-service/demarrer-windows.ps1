$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Set-Location $PSScriptRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker est introuvable. Ouvre Docker Desktop puis relance ce script."
}

docker info | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Docker Desktop ne répond pas. Attends qu'il soit complètement démarré."
}

if (-not (Test-Path ".env")) {
    $bytes = New-Object byte[] 32
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    }
    finally {
        $generator.Dispose()
    }
    $token = ([BitConverter]::ToString($bytes)).Replace("-", "").ToLowerInvariant()
    @(
        "MIQDAR_EXTRACTOR_TOKEN=$token"
        "MIQDAR_MAX_CONCURRENCY=2"
    ) | Set-Content -Path ".env" -Encoding Ascii
    Write-Host "Secret local créé dans .env." -ForegroundColor Green
}

Write-Host "Construction et lancement du moteur Miqdar..." -ForegroundColor Cyan
docker compose --profile tunnel up --build --detach
if ($LASTEXITCODE -ne 0) {
    throw "Le lancement Docker a échoué. Exécute 'docker compose --profile tunnel logs' pour obtenir le détail."
}

$healthReady = $false
for ($attempt = 0; $attempt -lt 45; $attempt++) {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:8788/health" -TimeoutSec 2
        if ($health.ok -and $health.configured) {
            $healthReady = $true
            break
        }
    }
    catch {
        Start-Sleep -Seconds 2
    }
}

if (-not $healthReady) {
    docker compose --profile tunnel logs --tail 80 extractor
    throw "Le moteur n'est pas devenu opérationnel dans le délai prévu."
}

$publicUrl = $null
for ($attempt = 0; $attempt -lt 45; $attempt++) {
    $logs = docker compose --profile tunnel logs --no-color tunnel 2>&1 | Out-String
    $match = [regex]::Match($logs, "https://[a-z0-9-]+\.trycloudflare\.com")
    if ($match.Success) {
        $publicUrl = $match.Value
        break
    }
    Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "Moteur local : opérationnel" -ForegroundColor Green
if ($health.serviceVersion) {
    Write-Host "Version moteur : $($health.serviceVersion) · diagnostic $($health.diagnosticVersion)" -ForegroundColor Green
}
if ($publicUrl) {
    Write-Host "Adresse HTTPS temporaire : $publicUrl" -ForegroundColor Yellow
    Write-Host "Envoie-moi uniquement cette adresse. Ne partage jamais le contenu du fichier .env." -ForegroundColor Yellow
}
else {
    Write-Host "Le moteur fonctionne, mais le tunnel n'a pas encore donné d'adresse." -ForegroundColor Yellow
    Write-Host "Relance plus tard : docker compose --profile tunnel logs tunnel" -ForegroundColor Yellow
}
Write-Host "Pour arrêter : .\arreter-windows.ps1"
Write-Host "Pour suivre yt-dlp et Chromium : docker compose --profile tunnel logs --follow extractor"
