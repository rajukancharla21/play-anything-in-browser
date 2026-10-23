# Terraform Configuration: GCP Spot GPU Gaming Node for "Play Anything in Browser"
# Author: Raju Kancharla (https://www.linkedin.com/in/rajukancharla/)

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

variable "project_id" {
  description = "Your GCP Project ID"
  type        = string
  default     = "your-gcp-project-id"
}

variable "region" {
  description = "GCP Region"
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "GCP Zone with GPU availability"
  type        = string
  default     = "us-central1-a"
}

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}

# Firewall rule allowing WebRTC video stream & HTTP Web Portal
resource "google_compute_firewall" "gaming_stream_firewall" {
  name    = "cloudplay-streaming-firewall"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["80", "443", "8000"]
  }

  # WebRTC Video & Audio UDP Ports (Sunshine / Selkies)
  allow {
    protocol = "udp"
    ports    = ["47998-48010", "3478"]
  }

  target_tags   = ["cloud-gaming-node"]
  source_ranges = ["0.0.0.0/0"]
}

# Spot GPU Instance (NVIDIA L4 24GB VRAM)
resource "google_compute_instance" "gpu_gaming_node" {
  name         = "gcp-gaming-gpu-spot"
  machine_type = "g2-standard-4" # 4 vCPUs, 16 GB RAM + NVIDIA L4
  zone         = var.zone

  tags = ["cloud-gaming-node", "http-server", "https-server"]

  scheduling {
    preemptible        = true
    automatic_restart  = false
    provisioning_model = "SPOT"
  }

  guest_accelerator {
    type  = "nvidia-l4"
    count = 1
  }

  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2204-lts"
      size  = 120 # GB
      type  = "pd-ssd"
    }
  }

  network_interface {
    network = "default"
    access_config {
      // Ephemeral public IP for browser streaming
    }
  }

  metadata = {
    startup-script = file("${path.module}/startup_script.sh")
  }

  service_account {
    scopes = ["cloud-platform"]
  }
}

output "instance_public_ip" {
  value       = google_compute_instance.gpu_gaming_node.network_interface[0].access_config[0].nat_ip
  description = "Connect your browser player to this IP: http://<PUBLIC_IP>:8000"
}
