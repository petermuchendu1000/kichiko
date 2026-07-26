# cloudflare.tf — edge config as code (Module 16.4).
# Codifies the DNS, TLS, cache behaviour (Module 15 policy) and edge WAF /
# rate-limiting (Module 14 policy) so there is no console-only "snowflake" state.

# ---------------------------------------------------------------------------
# DNS — proxied CNAMEs to the Fly apps (orange-cloud = through Cloudflare).
# ---------------------------------------------------------------------------
resource "cloudflare_record" "app" {
  zone_id = var.cloudflare_zone_id
  name    = var.app_hostname
  type    = "CNAME"
  content = "${var.fly_prod_app}.fly.dev"
  proxied = true
  comment = "Production app -> Fly (managed by Terraform)"
}

resource "cloudflare_record" "staging" {
  zone_id = var.cloudflare_zone_id
  name    = var.staging_hostname
  type    = "CNAME"
  content = "${var.fly_staging_app}.fly.dev"
  proxied = true
  comment = "Staging app -> Fly (managed by Terraform)"
}

# ---------------------------------------------------------------------------
# TLS + compression + performance zone settings.
# ---------------------------------------------------------------------------
resource "cloudflare_zone_settings_override" "kichiko" {
  zone_id = var.cloudflare_zone_id

  settings {
    ssl                      = "strict" # full (strict): validate the Fly origin cert
    min_tls_version          = "1.2"
    always_use_https         = "on"
    automatic_https_rewrites = "on"
    tls_1_3                  = "on"
    brotli                   = "on" # Module 15: Brotli compression at edge
    http3                    = "on"
    security_header {
      enabled            = true
      include_subdomains = true
      max_age            = 31536000 # HSTS 1y (mirrors app CSP/HSTS, Module 14)
      preload            = true
      nosniff            = true
    }
  }
}

# Tiered Cache (Argo smart topology) — fewer origin hits for public reads.
resource "cloudflare_tiered_cache" "kichiko" {
  zone_id    = var.cloudflare_zone_id
  cache_type = "smart"
}

# ---------------------------------------------------------------------------
# Cache rules (Module 15 policy): cache public GET reads at the edge; never
# cache authenticated/private or API-write paths. TTLs are tuned in Module 15;
# here we only codify the classification.
# ---------------------------------------------------------------------------
resource "cloudflare_ruleset" "cache_rules" {
  zone_id = var.cloudflare_zone_id
  name    = "Kichiko cache policy"
  kind    = "zone"
  phase   = "http_request_cache_settings"

  rules {
    description = "Cache public market & leaderboard reads"
    expression  = "(http.request.method eq \"GET\" and (starts_with(http.request.uri.path, \"/api/markets\") or starts_with(http.request.uri.path, \"/api/leaderboard\")))"
    action      = "set_cache_settings"
    action_parameters {
      cache = true
      edge_ttl {
        mode    = "override_origin"
        default = 30
      }
      browser_ttl {
        mode = "respect_origin"
      }
    }
  }

  rules {
    description = "Never cache auth/private/cron/write paths"
    expression  = "(starts_with(http.request.uri.path, \"/api/auth\") or starts_with(http.request.uri.path, \"/api/cron\") or starts_with(http.request.uri.path, \"/api/admin\") or http.request.method ne \"GET\")"
    action      = "set_cache_settings"
    action_parameters {
      cache = false
    }
  }
}

# ---------------------------------------------------------------------------
# Edge rate limiting (Module 14 policy) — abuse protection in front of origin.
# ---------------------------------------------------------------------------
resource "cloudflare_ruleset" "rate_limit" {
  zone_id = var.cloudflare_zone_id
  name    = "Kichiko edge rate limits"
  kind    = "zone"
  phase   = "http_ratelimit"

  rules {
    description = "Throttle auth endpoints (brute-force protection)"
    expression  = "(starts_with(http.request.uri.path, \"/api/auth\"))"
    action      = "block"
    ratelimit {
      characteristics     = ["ip.src", "cf.colo.id"]
      period              = 60
      requests_per_period = 20
      mitigation_timeout  = 300
    }
  }

  rules {
    description = "General API request ceiling per IP"
    expression  = "(starts_with(http.request.uri.path, \"/api/\"))"
    action      = "managed_challenge"
    ratelimit {
      characteristics     = ["ip.src", "cf.colo.id"]
      period              = 60
      requests_per_period = 300
      mitigation_timeout  = 60
    }
  }
}
