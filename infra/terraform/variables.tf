# variables.tf — inputs for the Kichiko edge + host IaC (Module 16.4).
# Secret values are supplied via TF_VAR_* env in CI (never committed).

variable "cloudflare_api_token" {
  description = "Cloudflare API token (Zone:Edit, DNS:Edit, Ruleset:Edit)."
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for the Kichiko domain."
  type        = string
}

variable "domain" {
  description = "Apex domain (e.g. kichiko.co.ke)."
  type        = string
}

variable "fly_api_token" {
  description = "Fly.io API token for managing app-level infra (certs, IPs)."
  type        = string
  sensitive   = true
}

variable "app_hostname" {
  description = "Production app hostname."
  type        = string
  default     = "app"
}

variable "staging_hostname" {
  description = "Staging app hostname."
  type        = string
  default     = "staging"
}

variable "fly_prod_app" {
  description = "Fly production app name (deploy target of the CNAME)."
  type        = string
  default     = "kichiko-prod"
}

variable "fly_staging_app" {
  description = "Fly staging app name."
  type        = string
  default     = "kichiko-staging"
}
