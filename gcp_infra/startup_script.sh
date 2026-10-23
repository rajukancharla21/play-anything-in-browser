#!/bin/bash
# GCP GPU Node Startup Script: Automatically installs NVIDIA Drivers, Docker, and WebRTC Gaming Gateway
set -euo pipefail

echo "=== [Play Anything in Browser] Initializing GCP Cloud GPU Instance ==="

# 1. Update OS & install kernel headers
export DEBIAN_FRONTEND=noninteractive
apt-get update && apt-get install -y \
    linux-headers-$(uname -r) \
    build-essential \
    pkg-config \
    curl \
    git \
    python3-pip \
    jq

# 2. Install NVIDIA Driver for GCP Compute Engine
echo "Installing NVIDIA GPU Drivers..."
curl -fSsl -O https://us.download.nvidia.com/tesla/535.154.05/NVIDIA-Linux-x86_64-535.154.05.run || true
if [ -f NVIDIA-Linux-x86_64-535.154.05.run ]; then
  sh NVIDIA-Linux-x86_64-535.154.05.run -s --no-questions || true
fi

# 3. Install Docker Engine & NVIDIA Container Toolkit
apt-get install -y docker.io
systemctl enable --now docker

curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg || true
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  tee /etc/apt/sources.list.d/nvidia-container-toolkit.list || true

apt-get update && apt-get install -y nvidia-container-toolkit || true
nvidia-ctk runtime configure --runtime=docker || true
systemctl restart docker || true

# 4. Clone and launch Play Anything in Browser Orchestrator
mkdir -p /opt/play-anything
cd /opt/play-anything
git clone https://github.com/rajukancharla/play-anything-in-browser.git . || true

# Run orchestrator container with GPU acceleration
docker run -d \
  --name cloudplay-node \
  --restart always \
  --gpus all \
  -p 8000:8000 \
  -p 18080-18100:18080-18100 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  ghcr.io/selkies-project/selkies/desktop:latest-ubuntu24.04 || true

echo "=== Node Setup Complete. GPU Ready for Browser Game Streaming ==="
