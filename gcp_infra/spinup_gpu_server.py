#!/usr/bin/env python3
"""
GCP Cloud GPU Server Spin-Up Script
Project: Play Anything in Browser
Author: Raju Kancharla (https://www.linkedin.com/in/rajukancharla/)

Automates provisioning of cost-efficient Spot/Preemptible GPU instances on Google Cloud.
Supports both Python Google API client (using service_account.json) and gcloud CLI.
"""
import argparse
import json
import time
from pathlib import Path

DEFAULT_PROJECT = "visiblie-dev"
DEFAULT_ZONE = "us-central1-a"
SCRIPT_DIR = Path(__file__).parent
STARTUP_SCRIPT = SCRIPT_DIR / "startup_script.sh"
SA_KEY_FILE = SCRIPT_DIR / "service_account.json"

GPU_CONFIGS = {
    "nvidia-l4": {
        "machine_type": "g2-standard-4",
        "gpu_type": "nvidia-l4",
        "gpu_count": 1,
        "hourly_spot_est": "$0.70/hr",
        "hourly_ondemand": "$1.95/hr",
        "desc": "Next-Gen Ada Lovelace GPU, ideal for GTA V / Cyberpunk Ray Tracing"
    },
    "nvidia-tesla-t4": {
        "machine_type": "n1-standard-4",
        "gpu_type": "nvidia-tesla-t4",
        "gpu_count": 1,
        "hourly_spot_est": "$0.22/hr",
        "hourly_ondemand": "$0.75/hr",
        "desc": "Budget-friendly Turing GPU, perfect for 1080p 60FPS retro and esports games"
    }
}

def spinup_with_service_account(instance_name: str, project_id: str, zone: str, gpu_choice: str, is_spot: bool = True):
    """Attempt direct instance provisioning via Google Cloud Compute REST API with service account credentials."""
    if not SA_KEY_FILE.exists():
        return None

    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
        
        creds = service_account.Credentials.from_service_account_file(str(SA_KEY_FILE))
        compute = build("compute", "v1", credentials=creds)
        cfg = GPU_CONFIGS.get(gpu_choice, GPU_CONFIGS["nvidia-l4"])

        print(f"[GCP Auth] Authenticated as {creds.service_account_email}")
        print(f"[GCP Compute] Requesting Spot GPU Instance: {instance_name} ({cfg['gpu_type']}) in {zone}...")

        startup_content = STARTUP_SCRIPT.read_text() if STARTUP_SCRIPT.exists() else "#!/bin/bash\necho ready"

        instance_body = {
            "name": instance_name,
            "machineType": f"zones/{zone}/machineTypes/{cfg['machine_type']}",
            "disks": [
                {
                    "boot": True,
                    "autoDelete": True,
                    "initializeParams": {
                        "sourceImage": "projects/ubuntu-os-cloud/global/images/family/ubuntu-2204-lts",
                        "diskSizeGb": "100",
                        "diskType": f"zones/{zone}/diskTypes/pd-ssd"
                    }
                }
            ],
            "networkInterfaces": [
                {
                    "network": "global/networks/default",
                    "accessConfigs": [{"type": "ONE_TO_ONE_NAT", "name": "External NAT"}]
                }
            ],
            "guestAccelerators": [
                {
                    "acceleratorType": f"zones/{zone}/acceleratorTypes/{cfg['gpu_type']}",
                    "acceleratorCount": cfg["gpu_count"]
                }
            ],
            "scheduling": {
                "onHostMaintenance": "TERMINATE",
                "automaticRestart": False,
                "provisioningModel": "SPOT" if is_spot else "STANDARD",
                "instanceTerminationAction": "STOP"
            },
            "tags": {"items": ["cloud-gaming-node", "http-server", "https-server"]},
            "metadata": {
                "items": [{"key": "startup-script", "value": startup_content}]
            }
        }

        operation = compute.instances().insert(project=project_id, zone=zone, body=instance_body).execute()
        print(f"[GCP Success] Provisioning Operation Created: {operation.get('name')}")
        return {
            "status": "PROVISIONED",
            "operation": operation.get("name"),
            "instance_name": instance_name,
            "zone": zone,
            "gpu": cfg["gpu_type"],
            "estimated_cost": cfg["hourly_spot_est"]
        }
    except Exception as e:  # noqa: BLE001
        err_msg = str(e)
        print(f"\n[GCP Notice] API returned: {err_msg}")
        return {
            "status": "NEEDS_IAM_ROLE_OR_API_ENABLE",
            "error": err_msg,
            "enable_api_url": f"https://console.cloud.google.com/marketplace/product/google/compute.googleapis.com?project={project_id}",
            "iam_url": f"https://console.cloud.google.com/iam-admin/iam?project={project_id}"
        }

def generate_gcloud_command(instance_name: str, project_id: str, zone: str, gpu_choice: str, is_spot: bool = True) -> list[str]:
    cfg = GPU_CONFIGS.get(gpu_choice, GPU_CONFIGS["nvidia-l4"])
    cmd = [
        "gcloud", "compute", "instances", "create", instance_name,
        f"--project={project_id}",
        f"--zone={zone}",
        f"--machine-type={cfg['machine_type']}",
        "--maintenance-policy=TERMINATE",
        "--restart-on-failure",
        f"--accelerator=type={cfg['gpu_type']},count={cfg['gpu_count']}",
        "--image-family=ubuntu-2204-lts",
        "--image-project=ubuntu-os-cloud",
        "--boot-disk-size=100GB",
        "--boot-disk-type=pd-ssd",
        "--tags=cloud-gaming-node,http-server,https-server",
        f"--metadata-from-file=startup-script={STARTUP_SCRIPT!s}"
    ]
    if is_spot:
        cmd.append("--provisioning-model=SPOT")
        cmd.append("--instance-termination-action=STOP")
    return cmd

def spinup_instance(instance_name: str, project_id: str = DEFAULT_PROJECT, zone: str = DEFAULT_ZONE, gpu_choice: str = "nvidia-l4", is_spot: bool = True):
    print("\n[Play Anything in Browser] Raju Kancharla's Cloud Gaming Provisioner")
    print(f"Target GPU: {gpu_choice.upper()} | Spot Mode: {is_spot} (Est: {GPU_CONFIGS[gpu_choice]['hourly_spot_est']})")
    print(f"Zone: {zone} | Project: {project_id}\n")

    # 1. Try with Service Account JSON first
    if SA_KEY_FILE.exists():
        sa_res = spinup_with_service_account(instance_name, project_id, zone, gpu_choice, is_spot)
        if sa_res and sa_res.get("status") == "PROVISIONED":
            return sa_res
        elif sa_res:
            print("\nTo grant permission on GCP:")
            print(f"1. Enable Compute Engine API: {sa_res.get('enable_api_url')}")
            print("2. In IAM, grant 'Compute Admin' role to: 818449261326-compute@developer.gserviceaccount.com")
            print(f"   Console: {sa_res.get('iam_url')}\n")

    # 2. Return gcloud command
    cmd = generate_gcloud_command(instance_name, project_id, zone, gpu_choice, is_spot)
    return {
        "status": "command_ready",
        "instance_name": instance_name,
        "command": " ".join(cmd),
        "estimated_cost": GPU_CONFIGS[gpu_choice]["hourly_spot_est"]
    }

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Spin up GCP GPU instance for browser gaming")
    parser.add_argument("--name", default=f"gaming-gpu-{int(time.time()) % 10000}", help="Instance name")
    parser.add_argument("--project", default=DEFAULT_PROJECT, help="GCP Project ID")
    parser.add_argument("--zone", default=DEFAULT_ZONE, help="GCP Zone")
    parser.add_argument("--gpu", default="nvidia-l4", choices=["nvidia-l4", "nvidia-tesla-t4"], help="GPU type")
    parser.add_argument("--ondemand", action="store_true", help="Use on-demand instead of Spot")
    args = parser.parse_args()

    result = spinup_instance(args.name, args.project, args.zone, args.gpu, is_spot=not args.ondemand)
    print("\nResult:")
    print(json.dumps(result, indent=2))
