# Kichiko Infrastructure as Code (Terraform)

Declarative edge + host infra (Module 16.4). State lives in Terraform Cloud
(`kichiko/kichiko-infra`), locked and versioned. **No console-only
config** — all changes go through a PR (`plan` posted as a comment) and a gated
`apply` on `main` (see `.github/workflows/terraform.yml`).

## Layout
| File | Manages |
|---|---|
| `backend.tf` | remote state (Terraform Cloud) + provider version pins |
| `main.tf` | provider config + computed FQDN outputs |
| `variables.tf` | inputs (secrets via `TF_VAR_*` in CI) |
| `cloudflare.tf` | DNS, TLS/HSTS, Brotli, Tiered Cache, cache rules (M15), edge rate limits (M14) |
| `fly.tf` | Fly custom-domain TLS certs |

## Local usage
```bash
cd infra/terraform
export TF_VAR_cloudflare_api_token=...   TF_VAR_cloudflare_account_id=...
export TF_VAR_cloudflare_zone_id=...     TF_VAR_domain=kichiko.co.ke
export TF_VAR_fly_api_token=...
terraform init
terraform plan      # review
# apply happens in CI (gated) — avoid local applies against shared state
```

Copy `terraform.tfvars.example` to `terraform.tfvars` for local non-secret
overrides (never commit real secrets).

## Change flow
1. Edit `.tf`, open a PR → CI runs `fmt`/`validate`/`plan`, comments the diff.
2. Merge → gated `apply` (Environment `infra`, required reviewers).
3. Nightly scheduled `plan` detects drift.

## Rollback
Config rollback = `git revert` the infra commit → the next `apply` restores the
prior state (see `docs/RUNBOOK.md`).
