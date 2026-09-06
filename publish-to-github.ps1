param(
  [Parameter(Mandatory=$true)]
  [string]$Owner,

  [Parameter(Mandatory=$true)]
  [string]$Repo,

  [Parameter(Mandatory=$false)]
  [switch]$CreateIfMissing,

  [Parameter(Mandatory=$false)]
  [string]$Description = "Retail management sprint1 docs and impl drafts",

  [Parameter(Mandatory=$false)]
  [switch]$Private = $true,

  [Parameter(Mandatory=$false)]
  [string]$Token = $null
)

$ErrorActionPreference = "Stop"

if (-not $Token) {
  $Token = $env:GITHUB_TOKEN
}

$repoUrl = "https://github.com/$Owner/$Repo.git"
git remote remove origin 2>$null | Out-Null

if ($CreateIfMissing -and -not $Token) {
  throw "CreateIfMissing requires -Token (GitHub personal access token) or GITHUB_TOKEN env var."
}

if ($CreateIfMissing) {
  # Create repo if not exists (owner must be current user account)
  $payload = @{
    name        = $Repo
    description = $Description
    private     = [bool]$Private
  } | ConvertTo-Json

  $headers = @{
    Authorization = "token $Token"
    "User-Agent"  = "codex-publish-script"
    Accept        = "application/vnd.github+json"
  }

  Write-Host "[1/3] creating repo if missing: $Owner/$Repo"
  $apiUrl = "https://api.github.com/user/repos"
  Invoke-RestMethod -Method Post -Uri $apiUrl -Body $payload -Headers $headers -ContentType "application/json" | Out-Null
}

Write-Host "[2/3] remote set: $repoUrl"
git remote add origin $repoUrl
git branch -M main
Write-Host "[3/3] pushing..."
git push -u origin main

Write-Host "Done. Repository URL:"
Write-Host "https://github.com/$Owner/$Repo"
