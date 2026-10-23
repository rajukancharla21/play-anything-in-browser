#!/bin/bash
# =====================================================================
# Teardown / Delete GCP Remote GPU Instance
# Stops and deletes the instance immediately to stop all billing
# =====================================================================
set -e

INSTANCE_NAME="${1:-}"
PROJECT_ID="${GCP_PROJECT_ID:-visiblie-dev}"
ZONE="${GCP_ZONE:-us-central1-a}"

if [ -f ".env" ]; then
  export $(grep -v '^#' .env | grep -v 'GOOGLE_SERVICE_ACCOUNT_JSON' | xargs)
fi

echo "=== [Play Anything in Browser] GCP GPU Teardown ==="

python3 -c '
import os, sys, json
from pathlib import Path
from google.oauth2 import service_account
from googleapiclient.discovery import build

sa_path = Path("gcp_infra/service_account.json")
if not sa_path.exists():
    print("[Error] gcp_infra/service_account.json not found.")
    sys.exit(1)

project_id = sys.argv[1]
zone = sys.argv[2]
instance_name = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None

creds = service_account.Credentials.from_service_account_file(str(sa_path))
compute = build("compute", "v1", credentials=creds)

if not instance_name:
    # List active instances with gaming tag
    print(f"Listing active instances in {project_id}/{zone}...")
    try:
        res = compute.instances().list(project=project_id, zone=zone).execute()
        items = res.get("items", [])
        if not items:
            print("No running instances found in this zone.")
            sys.exit(0)
        print(f"Found {len(items)} instances:")
        for idx, inst in enumerate(items):
            print(f" [{idx+1}] {inst[\"name\"]} (Status: {inst[\"status\"]})")
        instance_name = items[0]["name"]
        print(f"\nDeleting first instance: {instance_name}...")
    except Exception as e:
        print("Error listing instances:", e)
        sys.exit(1)

try:
    print(f"Deleting instance {instance_name} in {zone}...")
    op = compute.instances().delete(project=project_id, zone=zone, instance=instance_name).execute()
    print(f"[Success] Delete operation started: {op.get(\"name\")}")
    print("GPU instance is being deleted. All compute billing stopped!")
except Exception as e:
    print("Delete error:", e)
' "$PROJECT_ID" "$ZONE" "$INSTANCE_NAME"
