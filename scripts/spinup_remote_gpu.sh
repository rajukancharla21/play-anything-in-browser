#!/bin/bash
# =====================================================================
# Spin up remote GPU host on GCP (Runs the game, NOT your local machine)
# Saves the remote IP directly to .env so the UI wires up instantly
# =====================================================================
set -e

PROJECT_ID="${GCP_PROJECT_ID:-my-gcp-gaming-project}"
ZONE="${GCP_ZONE:-us-central1-a}"
GPU_TYPE="${GCP_GPU_TYPE:-nvidia-l4}"
INSTANCE_NAME="cloudplay-gpu-$(date +%s | tail -c 5)"

echo "=== [Play Anything in Browser] Spinning up Remote Cloud GPU Node ==="
echo "Project: $PROJECT_ID | Zone: $ZONE | GPU: $GPU_TYPE (Spot Pricing)"
echo "Your laptop CPU/GPU will stay idle; the game renders remotely!"
echo "------------------------------------------------------------------"

# Run the python provisioner
python3 gcp_infra/spinup_gpu_server.py \
  --name "$INSTANCE_NAME" \
  --project "$PROJECT_ID" \
  --zone "$ZONE" \
  --gpu "$GPU_TYPE"

echo ""
echo "Instance request dispatched. Once booted, set REMOTE_GPU_HOST in your .env:"
echo "REMOTE_GPU_HOST=<EXTERNAL_IP>"
echo ""
echo "Then launch the web player: ./scripts/dev.sh"
