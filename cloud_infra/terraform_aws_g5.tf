# Terraform Blueprint: AWS EC2 G5 GPU Pool for In-Browser AAA Game Streaming (GTA V)
terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "aws_region" {
  default = "us-east-1"
}

variable "instance_type" {
  description = "AWS G5 instance equipped with NVIDIA A10G (24GB VRAM)"
  default     = "g5.2xlarge"
}

variable "spot_max_price" {
  description = "Maximum hourly bid for Spot GPU instance ($0.45 vs $1.21 on-demand)"
  default     = "0.55"
}

provider "aws" {
  region = var.aws_region
}

# Security Group for Cloud Gaming WebRTC and Signaling
resource "aws_security_group" "cloud_gaming_sg" {
  name        = "cloudplay-gaming-sg"
  description = "Security group for low-latency WebRTC gaming stream and input"

  # HTTPS API / Web Portal
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # WebRTC Video & Audio UDP (Sunshine / Wolf RTP)
  ingress {
    from_port   = 47998
    to_port     = 48010
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # WebRTC ICE / STUN / TURN
  ingress {
    from_port   = 3478
    to_port     = 3479
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Outbound traffic (S3 saves sync, game updates)
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# IAM Role for Instance (S3 Game Save synchronization)
resource "aws_iam_role" "gaming_host_role" {
  name = "cloudplay-gaming-host-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

# Policy allowing read/write to per-player save bucket
resource "aws_iam_role_policy" "s3_save_policy" {
  name = "cloudplay-saves-s3-access"
  role = aws_iam_role.gaming_host_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket"
      ]
      Resource = [
        "arn:aws:s3:::cloudplay-player-saves",
        "arn:aws:s3:::cloudplay-player-saves/*"
      ]
    }]
  })
}

resource "aws_iam_instance_profile" "gaming_profile" {
  name = "cloudplay-gaming-profile"
  role = aws_iam_role.gaming_host_role.name
}

# Spot Fleet / Launch Template for Windows GTA V Gaming Node
resource "aws_launch_template" "gaming_template" {
  name_prefix   = "cloudplay-g5-"
  image_id      = "ami-windows-server-2022-nvidia-gaming" # Custom AMI with GTA V pre-staged
  instance_type = var.instance_type

  iam_instance_profile {
    name = aws_iam_instance_profile.gaming_profile.name
  }

  network_interfaces {
    associate_public_ip_address = true
    security_groups             = [aws_security_group.cloud_gaming_sg.id]
  }

  block_device_mappings {
    device_name = "/dev/sda1"
    ebs {
      volume_size           = 250 # Ample NVMe storage for GTA V (110GB) + OS
      volume_type           = "gp3"
      iops                  = 6000
      throughput            = 250
      delete_on_termination = true
    }
  }

  instance_market_options {
    market_type = "spot"
    spot_options {
      max_price = var.spot_max_price
    }
  }

  user_data = base64encode(file("${path.module}/windows_host_setup.ps1"))
}
