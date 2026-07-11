# Powershell script to run E2E tests in a clean, isolated environment

$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chromePath)) {
    $chromePath = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
}
if (-not (Test-Path $chromePath)) {
    Write-Error "Chrome executable not found!"
    exit 1
}

$port = 9223
$profileDir = Join-Path $env:TEMP ("chrome-profile-e2e-" + (Get-Date -Format "yyyyMMdd-HHmmss"))

Write-Host "Cleaning up any stale DevTools processes on ports 9222/9223..."
$staleConns = Get-NetTCPConnection -LocalPort @(9222, 9223) -ErrorAction SilentlyContinue
if ($staleConns) {
    foreach ($conn in $staleConns) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1
}

# Clean up profile dir if it exists from a previous crashed run
if (Test-Path $profileDir) {
    Remove-Item -Recurse -Force $profileDir -ErrorAction SilentlyContinue
}

Write-Host "Launching clean headful Chrome on port $port..."
$chromeProcess = Start-Process -FilePath $chromePath -ArgumentList "--remote-debugging-port=$port", "--user-data-dir=$profileDir", "--no-sandbox", "about:blank" -PassThru -NoNewWindow

# Wait for Chrome to start and listen
Write-Host "Waiting for Chrome to start listening on port $port..."
Start-Sleep -Seconds 3

# Run tests with CDP_PORT=9223
$env:CDP_PORT = "$port"

Write-Host "`n=== RUNNING COMPREHENSIVE E2E TESTS ==="
node e2e_full_test.js
$e2eExit = $LASTEXITCODE

Write-Host "`n=== RUNNING MOBILE E2E TESTS ==="
node cdp_mobile_e2e_full5.js
$mobileExit = $LASTEXITCODE

# Clean up Chrome
Write-Host "`nCleaning up Chrome process..."
Stop-Process -Id $chromeProcess.Id -Force -ErrorAction SilentlyContinue

# Remove profile directory
Remove-Item -Recurse -Force $profileDir -ErrorAction SilentlyContinue

Write-Host "Done!"

# Return combined exit code
if ($e2eExit -ne 0 -or $mobileExit -ne 0) {
    Write-Host "E2E tests failed!"
    exit 1
} else {
    Write-Host "All tests completed successfully!"
    exit 0
}
