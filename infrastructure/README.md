# Infrastructure

Deployment and edge configuration. Populated from Phase 9; kept in the tree
from Phase 1 so the repository structure matches the contract.

Planned contents:

```
infrastructure/
├── cloudflare/        DNS records, WAF rules, Turnstile, cache rules (Terraform)
├── deploy/            VPS compose/systemd units for api + worker fleet
├── monitoring/        Prometheus scrape config, Grafana dashboards, alerts
└── scripts/           backup, restore, migration runbook helpers
```

Environment separation: `development` (local docker-compose) → `staging` (CI
deploy, mocked source adapters) → `production` (manual approval).

Never use production credentials locally.
