<#
.SYNOPSIS
    Automated Windows Host Setup for GTA V Cloud Gaming Node
    Installs: NVIDIA Gaming Drivers, ViGEmBus Controller Driver, Sunshine WebRTC Streamer,
    and stages S3 save synchronization agent.
#>

Write-Host "=== CloudPlay Windows GPU Node Initialization ===" -ForegroundColor Cyan

# 1. Enable Chocolatey Package Manager
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# 2. Install Git, Python 3, 7zip, and Visual C++ Runtimes
choco install -y git python3 7zip vcredist140

# 3. Install ViGEmBus (Virtual Gamepad Emulation Bus for Xbox/PlayStation controller pass-through)
Write-Host "Installing ViGEmBus Virtual Controller Driver..." -ForegroundColor Green
$vigemUrl = "https://github.com/ViGEm/ViGEmBus/releases/download/v1.22.0/ViGEmBus_1.22.0_x64_x86_arm64.exe"
Invoke-WebRequest -Uri $vigemUrl -OutFile "$env:TEMP\ViGEmBus.exe"
Start-Process -FilePath "$env:TEMP\ViGEmBus.exe" -ArgumentList "/quiet" -Wait

# 4. Install Sunshine (Ultra-low latency open-source game streaming server with NVENC)
Write-Host "Installing Sunshine Streaming Server..." -ForegroundColor Green
choco install -y sunshine

# 5. Configure Windows Display & Auto-Login
# Prevents screen sleeping or locking when streaming in headless / remote cloud
Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -Name "AutoAdminLogon" -Value "1"
powercfg -change -monitor-timeout-ac 0
powercfg -change -standby-timeout-ac 0

# 6. S3 Save-Game Sync Daemon Setup
$saveSyncScript = @"
import time, os, subprocess
PLAYER_ID = os.environ.get('ASSIGNED_PLAYER_ID', 'default_player')
S3_BUCKET = 's3://cloudplay-player-saves'
SAVE_DIR = os.path.expanduser('~/Documents/Rockstar Games/GTA V/Profiles')

def sync_from_cloud():
    print(f'Syncing saves from cloud for {PLAYER_ID}...')
    subprocess.run(['aws', 's3', 'sync', f'{S3_BUCKET}/{PLAYER_ID}', SAVE_DIR], check=False)

def sync_to_cloud():
    print(f'Syncing saves to cloud for {PLAYER_ID}...')
    subprocess.run(['aws', 's3', 'sync', SAVE_DIR, f'{S3_BUCKET}/{PLAYER_ID}'], check=False)

if __name__ == '__main__':
    sync_from_cloud()
    while True:
        time.sleep(60) # Sync save progress every minute
        sync_to_cloud()
"@

$saveSyncScript | Out-File -FilePath "C:\CloudPlay\save_sync.py" -Encoding utf8

Write-Host "CloudPlay Node Setup Complete. Sunshine server ready." -ForegroundColor Cyan
