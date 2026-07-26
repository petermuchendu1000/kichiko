# backend.tf — remote state with locking & versioning (Module 16.4).
# Terraform Cloud stores state off-repo, encrypted, locked, and versioned so
# concurrent applies can't corrupt it and any state can be rolled back.
terraform {
  required_version = ">= 1.6.0"

  # Remote backend (token via TF_API_TOKEN in CI). Swap the org/workspace to
  # match your Terraform Cloud setup, or replace with an S3/R2 backend block.
  cloud {
    organization = "kichiko"

    workspaces {
      name = "kichiko-infra"
    }
  }

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.40"
    }
    fly = {
      source  = "fly-apps/fly"
      version = "~> 0.1"
    }
  }
}
