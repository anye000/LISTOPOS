<#
  Sube el proyecto ListoPOS a tu cuenta de GitHub.

  Uso (desde la raíz del proyecto):
    npm run push:github -- -User TU_USUARIO
    o directamente:
    powershell -ExecutionPolicy Bypass -File scripts/push-github.ps1 -User TU_USUARIO

  Requisitos:
    1. Haber creado un repositorio VACÍO y PÚBLICO llamado "listopos" en
       https://github.com/new  (sin README, sin .gitignore, sin licencia).
    2. La primera vez, Git Credential Manager abrirá el navegador para
       iniciar sesión en GitHub. No hace falta pegar ningún token aquí.
#>
param(
  [string]$User,
  [string]$RepoName = "listopos",
  [string]$Url
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot

try {
  if (-not (Test-Path -LiteralPath (Join-Path $repoRoot ".git"))) {
    throw "No se encontró el repositorio git en $repoRoot"
  }

  if (-not $Url) {
    if (-not $User) {
      $User = Read-Host "Tu usuario de GitHub (ej: mi-usuario)"
    }
    if (-not $User -or $User -notmatch '^[A-Za-z0-9-]+$') {
      throw "Usuario de GitHub inválido: '$User'"
    }
    $Url = "https://github.com/$User/$RepoName.git"
  }

  Write-Host "→ Repositorio remoto: $Url"

  $remotes = @(git remote)
  if ($remotes -contains "origin") {
    git remote set-url origin $Url
  } else {
    git remote add origin $Url
  }

  Write-Host ""
  Write-Host "→ Subiendo la rama 'main'…" -ForegroundColor Cyan
  Write-Host "  (si es la primera vez, se abrirá el navegador para iniciar sesión en GitHub)" -ForegroundColor DarkGray
  git push -u origin main

  if ($LASTEXITCODE -ne 0) {
    throw @"
El push falló. Verifica:
  · Haber creado el repositorio VACÍO y PÚBLICO '$RepoName' en https://github.com/new
  · Que el usuario '$User' sea tu cuenta y el repo te pertenezca
  · Que hayas iniciado sesión cuando Git Credential Manager lo pida
"@
  }

  $web = $Url -replace '\.git$', ''
  Write-Host ""
  Write-Host "✔ Proyecto subido a GitHub: $web" -ForegroundColor Green
  Write-Host ""
  Write-Host "Para futuros cambios:" -ForegroundColor Cyan
  Write-Host "  git add -A && git commit -m `"mensaje`" && git push"
}
finally {
  Pop-Location
}
