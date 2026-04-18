# NKZ Module: Communications (Zulip)

> Developed by **nkz-os** for [Robotika](https://robotika.cloud/).
> Licensed under AGPL-3.0. Powered by NKZ OS / FIWARE. Licensed under AGPL by [robotika.cloud](https://robotika.cloud/).

Sovereign messaging platform integrated into the Nekazari ecosystem. Provides team communication channels with automated IoT alert streams, FIWARE NGSI-LD event integration, and n8n workflow notifications.

Replaces the previous `nekazari-module-mattermost` module.

## Architecture

- **Backend**: Zulip server (official Docker image) + custom provisioning service (Flask)
- **Database**: Shared PostgreSQL cluster (`nkz_zulip` DB)
- **Cache**: Shared Redis + dedicated Memcached
- **Queue**: RabbitMQ (dedicated)
- **Auth**: OIDC via Keycloak (one client per tenant)
- **Frontend**: React IIFE module embedding Zulip web client

## Multi-tenancy

One Zulip realm per NKZ tenant. Full isolation of users, streams, search, and autocomplete.

## Integration Points

1. **FIWARE/Orion-LD**: NGSI-LD subscriptions post entity changes to alert streams
2. **n8n**: Custom Zulip node for workflow notifications
3. **Risk Engine (CEP)**: Agronomic risk alerts to dedicated streams
4. **Mobile**: WebView integration in nkz-mobile with SSO

## Development

See internal documentation in `.ai/` (gitignored).

## Deployment

See `k8s/` for Kubernetes manifests.

## License

AGPL-3.0 — see [LICENSE](LICENSE)

`zulip-producer-lib` (in `lib/`) is licensed under Apache 2.0 to allow third-party connector development.
