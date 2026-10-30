# upload-to-github.ps1
# One-click upload for the car-query web app to GitHub Pages.
#
# HOW TO USE:
#   1. Edit the three variables below: GitHubUser, Token, RepoName.
#   2. Right-click this file -> "Run with PowerShell" (or: powershell -ExecutionPolicy Bypass -File upload-to-github.ps1).
#   3. Wait ~30s. The live site URL is printed at the end.
#
# HOW TO GET A TOKEN (1 minute):
#   GitHub -> top-right avatar -> Settings -> Developer settings
#   -> Personal access tokens -> Tokens (classic) -> Generate new token (classic)
#   -> Note: car-query-upload ; Expiration: 90 days
#   -> CHECK the "repo" box (whole group) -> Generate token
#   -> Copy the "ghp_xxx" string (shown only once)
#   You can REVOKE this token after upload (Settings -> Developer settings);
#   revoking does NOT affect the uploaded repository.

$GitHubUser = "YOUR_GITHUB_USERNAME"
$Token      = "ghp_YOUR_TOKEN_HERE"
$RepoName   = "car-query"

$Dir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $Dir

# 1. Create the repository (ignore error if it already exists)
$body = @{ name = $RepoName; private = $false; auto_init = $false } | ConvertTo-Json
try {
    Invoke-RestMethod -Uri "https://api.github.com/user/repos" -Method Post `
        -Headers @{ Authorization = "token $Token" } -Body $body `
        -ContentType "application/json" | Out-Null
    Write-Host "[OK] Repository created: $RepoName"
} catch {
    Write-Host "[*] Repository may already exist, continuing..."
}

# 2. Configure remote and push to main
$remoteUrl = "https://$Token@github.com/$GitHubUser/$RepoName.git"
git remote remove origin 2>$null
git remote add origin $remoteUrl
git branch -M main
git push -u origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] git push failed. Check your token / username / repo name."
    exit 1
}
Write-Host "[OK] Code pushed to main"

# 3. Enable GitHub Pages (main branch, root directory)
$pagesBody = @{ source = @{ branch = "main"; path = "/" } } | ConvertTo-Json
try {
    Invoke-RestMethod -Uri "https://api.github.com/repos/$GitHubUser/$RepoName/pages" -Method Post `
        -Headers @{ Authorization = "token $Token" } -Body $pagesBody `
        -ContentType "application/json" | Out-Null
    Write-Host "[OK] GitHub Pages enabled"
} catch {
    Write-Host "[*] Pages may already be enabled, or enable manually: Settings -> Pages -> main / root"
}

Write-Host ""
Write-Host "DONE! Wait 1-2 minutes for the first build, then open:"
Write-Host "  https://$GitHubUser.github.io/$RepoName/"
