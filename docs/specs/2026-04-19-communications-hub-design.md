# NKZ Communications Hub — Design Spec

> **Status:** Approved  
> **Date:** 2026-04-19  
> **Module:** `nkz-module-zulip`  
> **Replaces:** iframe wrapper (`src/App.tsx`)

---

## 1. Overview

The NKZ Communications Hub is a contextual dashboard integrated into the Nekazari platform at `/communications`. It surfaces Zulip data (streams, messages, alerts, DMs) within the NKZ UI, with inline quick-reply capability. It is NOT a chat client — complex interactions deep-link to the full Zulip web UI.

### Three Surfaces, One Zulip Backend

| Surface | URL | Use Case | Target User |
|---|---|---|---|
| **NKZ Communications Hub** | `nekazari.robotika.cloud/communications` | Contextual dashboard: alerts, streams, DMs, quick-reply | Day-to-day platform use |
| **Zulip Web** | `messaging.robotika.cloud` | Full chat client: search, admin, long threads | Power users, admin |
| **Zulip Mobile App** (official) | App Store / Play Store | Push notifications, quick reply in the field | Field technicians |

### Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Auth strategy | Per-user API key via OIDC | Real user traceability in Zulip, no bot attribution |
| API routing | Proxy via api-gateway (`/api/zulip/*`) | Consistent with platform architecture, centralized auth/audit |
| Interaction model | Quick-reply inline (option B) | 80% of replies are short; avoids context-switching |
| Real-time | Long-polling via Zulip events API | Only option Zulip exposes; works through api-gateway |
| Push notifications | Zulip official mobile app | No duplication; FCM/APNs already solved |
| Bot management | Platform Admin panel | Admin controls bot health, templates, stream provisioning |

---

## 2. Auth Flow

```
User (NKZ) → Keycloak OIDC → Zulip (auto-signup, GenericOpenIdConnectBackend)
                  |
            JWT in cookie nkz_token
                  |
         api-gateway extracts user_email from JWT
                  |
         Looks up / caches Zulip API key (Redis, TTL 24h)
                  |
         Proxies to zulip-service with Basic auth (email:api_key)
                  |
         Response → frontend
```

### API Key Acquisition

- **First request:** api-gateway calls Zulip Admin API using bot credentials:
  - `GET /api/v1/users/{email}` → get user_id
  - `POST /api/v1/users/{user_id}/api_key/` → get API key
- **Cached:** Redis key `zulip:apikey:{email}`, TTL 24h
- **User not in Zulip:** returns 404 with clear message (OIDC not yet active or first login pending)

### Prerequisites

- OIDC activated (ZULIP-4): Keycloak client `zulip`, secret in `zulip-secret.oidc-client-secret`
- `ZULIP_AUTH_BACKENDS=EmailAuthBackend,GenericOpenIdConnectBackend`
- Bot user `nkz-platform-bot@robotika.cloud` created in Zulip with admin role

---

## 3. Tenant Isolation in Zulip

### Stream Structure

```
Platform-wide (public, admin-only posting):
  #platform-announcements

Per-tenant (private, invite-only):
  #tenant-{id}-general     — free team chat
  #tenant-{id}-alerts      — automated notifications destination
  #tenant-{id}-*           — additional streams from templates
```

### Message Routing

```
Platform Admin ──────────→ #platform-announcements ──→ All users
                            (manual or via admin endpoint)

N8N workflows ───┐
risk-engine ─────┤
weather-worker ──┼───────→ #tenant-{id}-alerts ──→ Tenant users only
telemetry ───────┤           topic: iot-alerts
services ────────┘           topic: risk-warnings
                             topic: system-events
```

### Security Enforcement (api-gateway)

- Extract `tenant_id` from JWT on every request
- `GET /streams`: filter response to only return `tenant-{tenant_id}-*` + `platform-announcements`
- `GET/POST /messages`: validate target stream belongs to user's tenant
- A user can NEVER see or write to another tenant's streams

---

## 4. API Gateway Proxy Routes

### Zulip Data Routes

| NKZ Route | Zulip Target | Purpose |
|---|---|---|
| `GET /api/zulip/streams` | `GET /api/v1/streams` | List streams (tenant-filtered) |
| `GET /api/zulip/streams/{id}/topics` | `GET /api/v1/users/me/{id}/topics` | Topics in a stream |
| `GET /api/zulip/messages` | `GET /api/v1/messages` | Messages with narrow (stream/topic/DM) |
| `POST /api/zulip/messages` | `POST /api/v1/messages` | Send message (quick-reply) |
| `GET /api/zulip/users/me` | `GET /api/v1/users/me` | Profile and unread counts |
| `POST /api/zulip/messages/{id}/reactions` | `POST /api/v1/messages/{id}/reactions` | Emoji reactions |

### Event Routes (long-polling)

| NKZ Route | Zulip Target | Purpose |
|---|---|---|
| `POST /api/zulip/events/register` | `POST /api/v1/register` | Create event queue |
| `GET /api/zulip/events` | `GET /api/v1/events` | Long-poll for events |
| `DELETE /api/zulip/events` | `DELETE /api/v1/events` | Cleanup queue |

### Provisioning Routes (bot credentials, internal)

| NKZ Route | Purpose |
|---|---|
| `POST /api/zulip/provisioning/tenant` | Create tenant space (streams, group, bot subscription) |
| `DELETE /api/zulip/provisioning/tenant/{id}` | Archive tenant streams |
| `POST /api/zulip/provisioning/tenant/{id}/user` | Subscribe user to tenant streams |
| `DELETE /api/zulip/provisioning/tenant/{id}/user/{email}` | Unsubscribe user |
| `POST /api/zulip/provisioning/sync` | Reconcile state (idempotent) |

### Proxy Configuration

- api-gateway proxy timeout: >= 120s (long-poll connections)
- Bot API key in `zulip-secret.bot-api-key`
- Zulip internal URL: `http://zulip-service:80`

---

## 5. Frontend Module — Communications Hub

### Technology

- React IIFE module via `@nekazari/module-builder`
- Registers as `window.__NKZ__.register({ id: 'zulip', ... })`
- Externals: `react`, `react-dom`, `react-router-dom`, `@nekazari/sdk`, `@nekazari/ui-kit`
- i18n: `es` + `en` minimum
- Mobile-first: min viewport 350px

### Layout (mobile-first, single column)

```
┌─────────────────────────────────┐
│  Header: "Comunicaciones"       │
│  [Connection status] [Open Zulip]│
├─────────────────────────────────┤
│  ALERTAS IoT (expanded)         │
│  - Alert cards with severity    │
│  - Entity deep links to viewer  │
│  - Unread badge                 │
├─────────────────────────────────┤
│  STREAMS DEL TENANT             │
│  - Stream list with unread badge│
│  - Click → expand messages      │
│  - Topic groups with messages   │
│  - Quick-reply input per topic  │
├─────────────────────────────────┤
│  MENSAJES DIRECTOS              │
│  - DM list with avatars         │
│  - Click → expand conversation  │
│  - Quick-reply input            │
├─────────────────────────────────┤
│  ANUNCIOS PLATAFORMA            │
│  - Announcement cards           │
│  - Read-only for normal users   │
└─────────────────────────────────┘
```

### Component Tree

```
CommunicationsHub (page root)
├── ConnectionStatus
├── AlertsPanel
│   ├── AlertCard (severity, entity link, timestamp)
│   └── AlertsBadge
├── StreamsPanel
│   ├── StreamListItem (name, unread badge)
│   └── StreamDetail (expanded)
│       ├── TopicGroup
│       │   ├── MessageBubble (author, avatar, content, time)
│       │   └── QuickReply (text input + send button)
│       └── DeepLink ("Open in Zulip")
├── DirectMessagesPanel
│   ├── DMListItem (avatar, name, unread badge)
│   └── DMDetail (expanded)
│       ├── MessageBubble
│       └── QuickReply
└── AnnouncementsPanel
    └── AnnouncementCard (title, date, content preview)
```

### Quick-Reply Behavior

- Simple text input (no formatting toolbar)
- Enter to send, Shift+Enter for newline
- Sends via `POST /api/zulip/messages` (attributed to real user)
- Emoji support via `:emoji_name:` (Zulip renders)
- Sticky input at bottom when stream/DM expanded (mobile: above virtual keyboard)

### Message Rendering

- Use Zulip's pre-rendered `content` field (HTML, sanitized before injection)
- Relative timestamps ("5 min ago", "yesterday 14:32")
- Author avatar from Zulip API

---

## 6. Real-Time Updates (Long-Polling)

### Flow

1. Frontend mounts `CommunicationsHub`
2. Calls `POST /api/zulip/events/register` → receives `queue_id` + initial state (unreads, subscriptions)
3. Loop: `GET /api/zulip/events?queue_id=X&last_event_id=Y`
   - Blocks until events arrive (long-poll, ~90s timeout)
   - Event types: `message`, `update_message`, `subscription`, `reaction`, `typing`
4. Frontend updates local state with each batch of events
5. On unmount: `DELETE /api/zulip/events` (cleanup queue)

### Reconnection

- Poll failure (network timeout, pod restart): exponential backoff (1s, 2s, 4s, max 30s)
- Queue expired (Zulip cleans after ~10 min without poll): re-register automatically
- Visual connection status indicator in hub header (connected / reconnecting / error)

### Resource Impact

- One long-poll connection per active user viewing the hub
- api-gateway proxy timeout must be >= 120s
- Queue cleaned up when user navigates away from `/communications`

---

## 7. Provisioner Service

### Purpose

Automates Zulip tenant lifecycle: creates streams, manages user subscriptions, and maintains tenant isolation.

### Events and Actions

| Trigger | Provisioner Action |
|---|---|
| Tenant created (via tenant-webhook) | Create private streams from templates, create user group, subscribe bot |
| User added to tenant | Create Zulip user (if needed), subscribe to tenant streams |
| User removed from tenant | Unsubscribe from tenant streams |
| Tenant deactivated | Archive streams (preserve history, don't delete) |
| Admin changes stream config | Create/archive streams per new template config |

### Technical Details

- **Stack:** Python Flask, Docker image on GHCR (`ghcr.io/nkz-os/nkz-module-zulip/provisioner:latest`)
- **Deployment:** `k8s/provisioner-deployment.yaml` (already exists, replicas=0 until image built)
- **Auth:** Uses bot API key from `zulip-secret.bot-api-key`
- **Reads config from:** `admin_platform.communications_config` (PostgreSQL)
- **Idempotent:** `POST /api/provisioning/sync` reconciles desired vs. actual state

### Integration with Existing Services

```
tenant-webhook (Keycloak event)
    → POST /api/zulip/provisioning/tenant
        → provisioner creates streams + subscribes bot

tenant-user-api (user added/removed)
    → POST /api/zulip/provisioning/tenant/{id}/user
        → provisioner manages subscriptions
```

---

## 8. Platform Admin Panel

### Location

New section in Platform Admin UI: **Comunicaciones** (alongside existing tenant/user management).

### Features

1. **Bot Status:** real-time health check (`GET /api/v1/users/me` with bot key). Visual indicator: connected/error. Regenerate API key button (calls Zulip Admin API to regenerate, then displays the new key with instructions to update the K8s Secret manually — direct K8s Secret mutation from UI is out of scope).

2. **Send Announcement:** inline form to publish to `#platform-announcements`. Choose topic (maintenance, update, incident). Preview Markdown. Sends via bot.

3. **Notification Templates:** editable Markdown templates used by N8N and platform services for alert formatting. Stored in `admin_platform.communications_config` (JSONB). Template variables: `{sensor_name}`, `{value}`, `{threshold}`, `{timestamp}`, `{entity_link}`.

4. **Stream Templates:** configurable list of streams auto-created per tenant. Default: `{tenant}-general`, `{tenant}-alerts`. Admin can add/remove templates (e.g., `{tenant}-field-ops`). Provisioner reads this on tenant creation.

### Storage

- `admin_platform.communications_config` table (new migration):
  - `key` (text, PK): config identifier
  - `value` (JSONB): configuration data
  - `updated_at` (timestamptz)
- Keys: `bot_config`, `notification_templates`, `stream_templates`
- NOT in Orion-LD (platform config, not digital twins)

---

## 9. Mobile / WebView Integration

### WebView Loading

```
nkz-mobile (React Native)
    → WebView src="https://nekazari.robotika.cloud/communications"
    → postMessage({ type: 'NKZ_AUTH_INJECTION', token: '<jwt>' })
    → Hub authenticates, loads streams and alerts
```

### Mobile-Specific Considerations

- **350px min width:** all panels stack vertically, each collapsible
- **Quick-reply input:** `position: sticky` at bottom when stream/DM expanded; virtual keyboard must not cover it
- **Deep links:** "Open in full Zulip" uses `window.open('', '_blank')` to open system browser (not navigate within WebView)
- **Background/foreground:** long-poll queue may expire when app is backgrounded; hub auto-re-registers on foreground
- **Push notifications:** handled by Zulip's official mobile app (separate install); NKZ does NOT duplicate push

---

## 10. i18n

Namespaces: `zulip.json` per language (`es`, `en` minimum).

Key groups:
- `hub.*` — hub UI labels (header, panel titles, connection status)
- `alerts.*` — alert severity labels, empty states
- `streams.*` — stream list, topic labels
- `dm.*` — direct messages labels
- `announcements.*` — announcements panel
- `quickReply.*` — input placeholder, send button, error states
- `admin.*` — platform admin panel labels

---

## 11. Build Order and Dependencies

```
Phase 0: Prerequisites (OPS)
  ├─ Activate OIDC (ZULIP-4): run keycloak-create-zulip-client.sh, patch secret, redeploy
  └─ Create bot user in Zulip, store API key in zulip-secret

Phase 1: Backend (api-gateway)
  ├─ JWT → Zulip API key middleware
  ├─ Proxy routes /api/zulip/*
  └─ Tenant filtering middleware

Phase 2: Provisioner service (parallel with Phase 3)
  ├─ Flask app with provisioning endpoints
  ├─ Docker image → GHCR
  ├─ Integration with tenant-webhook
  └─ DB migration for communications_config

Phase 3: Communications Hub frontend (needs Phase 1)
  ├─ Component tree implementation
  ├─ Long-polling event system
  ├─ Quick-reply functionality
  ├─ i18n (es + en)
  └─ IIFE build + MinIO deploy

Phase 4: Platform Admin panel (needs Phase 1 + 2)
  ├─ Bot management UI
  ├─ Announcement sender
  ├─ Template editor
  └─ Stream template configuration
```

---

## 12. Out of Scope

- Full chat client (Zulip web already exists at `messaging.robotika.cloud`)
- Push notifications in nkz-mobile (Zulip official app handles this)
- Attachments or rich formatting in quick-reply
- Message search (deep link to Zulip)
- Video/voice calls
- Custom Zulip themes or branding
