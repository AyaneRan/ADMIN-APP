param(
  [Parameter(Mandatory=$true)]
  [string]$Owner,

  [Parameter(Mandatory=$true)]
  [string]$Repo
)

$ErrorActionPreference = "Stop"

$repoUrl = "https://github.com/$Owner/$Repo.git"
git remote remove origin 2>$null | Out-Null
git remote add origin $repoUrl
git branch -M main

Write-Host "[1/2] remote set: $repoUrl"
Write-Host "[2/2] pushing..."
git push -u origin main
