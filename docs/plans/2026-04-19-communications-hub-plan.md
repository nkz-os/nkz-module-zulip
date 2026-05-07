# NKZ Communications Hub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a contextual communications dashboard at `/communications` that surfaces Zulip streams, alerts, DMs, and quick-reply inline, proxied through api-gateway with per-user auth and tenant isolation.

**Architecture:** IIFE React module in `nkz-module-zulip` calls `/api/zulip/*` routes on api-gateway, which translates JWT → Zulip API key (cached in Redis) and proxies to internal `zulip-service:80`. The provisioner service (Flask, same repo) manages tenant lifecycle in Zulip. Real-time via Zulip's long-polling events API.

**Tech Stack:** React 18 + TypeScript (IIFE module via `@nekazari/module-builder`), Python Flask (api-gateway routes + provisioner), Zulip REST API v1, Redis (API key cache), PostgreSQL (admin config).

**Design Spec:** `docs/specs/2026-04-19-communications-hub-design.md`

**Repos involved:**
- `nkz-module-zulip` (this repo) — frontend module + provisioner backend
- `nkz` (main platform repo) — api-gateway routes + DB migration + admin panel

---

## File Map

### `nkz-module-zulip` (this repo)

| Action | Path | Responsibility |
|---|---|---|
| Rewrite | `src/App.tsx` | `CommunicationsHub` page root — replaces iframe wrapper |
| Create | `src/components/AlertsPanel.tsx` | IoT alerts panel with severity cards and entity links |
| Create | `src/components/StreamsPanel.tsx` | Tenant streams list with expand/collapse |
| Create | `src/components/StreamDetail.tsx` | Expanded stream: topic groups, messages, quick-reply |
| Create | `src/components/DirectMessagesPanel.tsx` | DM list + expanded conversation |
| Create | `src/components/AnnouncementsPanel.tsx` | Platform announcements (read-only) |
| Create | `src/components/MessageBubble.tsx` | Single message: avatar, author, content (sanitized HTML), timestamp |
| Create | `src/components/QuickReply.tsx` | Text input + send button (Enter to send, Shift+Enter newline) |
| Create | `src/components/ConnectionStatus.tsx` | Connection indicator (connected/reconnecting/error) |
| Create | `src/hooks/useZulipEvents.ts` | Long-polling event loop (register queue, poll, reconnect) |
| Create | `src/hooks/useZulipApi.ts` | API client: fetch streams, messages, send message, etc. |
| Create | `src/types/zulip.ts` | TypeScript types for Zulip API responses |
| Create | `src/utils/sanitize.ts` | Sanitize Zulip HTML content for safe rendering |
| Create | `src/utils/time.ts` | Relative timestamp formatting |
| Modify | `src/i18n.ts` | No changes needed (already registers translations) |
| Modify | `src/locales/es/zulip.json` | Add ~30 new i18n keys |
| Modify | `src/locales/en/zulip.json` | Add ~30 new i18n keys |
| Modify | `src/locales/ca/zulip.json` | Add ~30 new i18n keys (copy from en) |
| Modify | `src/locales/eu/zulip.json` | Add ~30 new i18n keys (copy from en) |
| Modify | `src/locales/fr/zulip.json` | Add ~30 new i18n keys (copy from en) |
| Modify | `src/locales/pt/zulip.json` | Add ~30 new i18n keys (copy from en) |
| Modify | `src/moduleEntry.ts` | No changes needed |
| Rewrite | `backend/app.py` | Provisioner with new endpoint structure |
| Rewrite | `backend/zulip_client.py` | Zulip API client for provisioning (streams, users, subscriptions) |
| Modify | `backend/config.py` | Add `POSTGRES_URL` for reading communications_config |
| Delete | `backend/keycloak_client.py` | OIDC client creation moved to shell script; provisioner doesn't manage Keycloak |
| Modify | `backend/requirements.txt` | Add `psycopg2-binary` |
| Modify | `backend/Dockerfile` | No changes expected (already builds Flask app) |

### `nkz` (main platform repo)

| Action | Path | Responsibility |
|---|---|---|
| Modify | `services/api-gateway/fiware_api_gateway.py` | Add Zulip proxy routes + JWT→API key middleware |
| Create | `config/timescaledb/migrations/065_communications_config.sql` | Create `admin_platform.communications_config` table |
| Modify | `k8s/core/services/api-gateway-deployment.yaml` | Add `ZULIP_SERVICE_URL` env var |

---

## Phase 0: OPS Prerequisites

> These are manual server operations, not code tasks. They must be completed before any code work begins.

### Task 0A: Activate OIDC (ZULIP-4)

This task is performed on the production server via SSH. No code changes.

- [ ] **Step 1: Run Keycloak client creation script**

SSH into server, then:

```bash
cd ~/nkz-module-zulip
chmod +x scripts/keycloak-create-zulip-client.sh
# Export the Keycloak admin password (from keycloak-secret)
export KEYCLOAK_ADMIN_PASSWORD=$(sudo kubectl get secret keycloak-secret -n nekazari -o jsonpath='{.data.admin-password}' | base64 -d)
bash scripts/keycloak-create-zulip-client.sh
```

Expected: script outputs a client secret. Copy it.

- [ ] **Step 2: Patch zulip-secret with OIDC client secret**

```bash
OIDC_SECRET="<secret-from-step-1>"
sudo kubectl patch secret zulip-secret -n nekazari --type merge \
  -p "{\"data\":{\"oidc-client-secret\":\"$(echo -n $OIDC_SECRET | base64)\"}}"
```

- [ ] **Step 3: Update zulip-deployment.yaml to enable OIDC**

In `nkz-module-zulip/k8s/zulip-deployment.yaml`:
- Change `ZULIP_AUTH_BACKENDS` value from `"EmailAuthBackend"` to `"EmailAuthBackend,GenericOpenIdConnectBackend"`
- Uncomment the OIDC env var block (lines 130-139)

- [ ] **Step 4: Apply and restart Zulip**

```bash
sudo kubectl apply -f k8s/zulip-deployment.yaml
sudo kubectl rollout restart deployment/zulip -n nekazari
sudo kubectl rollout status deployment/zulip -n nekazari --timeout=600s
```

- [ ] **Step 5: Verify OIDC login**

Open `https://messaging.robotika.cloud` — should show "Log in with Nekazari SSO" button alongside email login.

### Task 0B: Create Platform Bot User

- [ ] **Step 1: Create bot via Zulip web UI**

Log in to `https://messaging.robotika.cloud` as admin. Go to Settings → Organization → Bots → Add a new bot:
- Name: `NKZ Platform Bot`
- Email: `nkz-platform-bot-bot@messaging.robotika.cloud` (Zulip appends `-bot`)
- Type: Generic bot

Copy the generated API key.

- [ ] **Step 2: Store bot API key in K8s Secret**

```bash
BOT_API_KEY="<api-key-from-step-1>"
BOT_EMAIL="nkz-platform-bot-bot@messaging.robotika.cloud"
sudo kubectl patch secret zulip-secret -n nekazari --type merge \
  -p "{\"data\":{\"bot-api-key\":\"$(echo -n $BOT_API_KEY | base64)\",\"bot-email\":\"$(echo -n $BOT_EMAIL | base64)\"}}"
```

- [ ] **Step 3: Create platform-announcements stream**

In Zulip web UI: Create stream `platform-announcements`, set to public, subscribe the bot.

---

## Phase 1: API Gateway — Zulip Proxy

### Task 1: Zulip proxy routes and JWT→API key bridge in api-gateway

**Files:**
- Modify: `nkz/services/api-gateway/fiware_api_gateway.py`
- Modify: `nkz/k8s/core/services/api-gateway-deployment.yaml` (add env var)

- [ ] **Step 1: Add Zulip service URL env var**

At the top of `fiware_api_gateway.py`, near line 109 (after `AGRIENERGY_API_URL`), add:

```python
ZULIP_SERVICE_URL = os.getenv("ZULIP_SERVICE_URL", "http://zulip-service:80")
ZULIP_BOT_EMAIL = os.getenv("ZULIP_BOT_EMAIL", "")
ZULIP_BOT_API_KEY = os.getenv("ZULIP_BOT_API_KEY", "")
```

- [ ] **Step 2: Add Redis import and Zulip API key cache helper**

After the existing imports section, add the Zulip API key cache functions:

```python
# --- Zulip API key cache (Redis) ---
_redis_url_for_zulip = os.getenv("REDIS_URL", "redis://redis-service:6379/4")

def _get_zulip_api_key(user_email: str) -> str | None:
    """Get or fetch Zulip API key for a user. Cached in Redis for 24h."""
    import redis as redis_lib
    cache_key = f"zulip:apikey:{user_email}"
    try:
        r = redis_lib.from_url(_redis_url_for_zulip, decode_responses=True)
        cached = r.get(cache_key)
        if cached:
            return cached
    except Exception:
        logger.warning("Redis unavailable for Zulip API key cache")
        r = None

    # Fetch from Zulip Admin API using bot credentials
    if not ZULIP_BOT_EMAIL or not ZULIP_BOT_API_KEY:
        logger.error("ZULIP_BOT_EMAIL/ZULIP_BOT_API_KEY not configured")
        return None

    try:
        # Get user by email
        resp = requests.get(
            f"{ZULIP_SERVICE_URL}/api/v1/users/{user_email}",
            auth=(ZULIP_BOT_EMAIL, ZULIP_BOT_API_KEY),
            timeout=10,
        )
        if resp.status_code == 404:
            logger.warning("Zulip user not found: %s", user_email)
            return None
        resp.raise_for_status()
        user_id = resp.json()["user"]["user_id"]

        # Create API key for user (admin endpoint)
        resp = requests.post(
            f"{ZULIP_SERVICE_URL}/api/v1/users/{user_id}/api_key",
            auth=(ZULIP_BOT_EMAIL, ZULIP_BOT_API_KEY),
            timeout=10,
        )
        resp.raise_for_status()
        api_key = resp.json()["api_key"]

        # Cache in Redis (24h TTL)
        if r:
            try:
                r.setex(cache_key, 86400, api_key)
            except Exception:
                pass

        return api_key
    except Exception:
        logger.exception("Failed to get Zulip API key for %s", user_email)
        return None


def _zulip_proxy_request(user_email: str, api_key: str, zulip_path: str, tenant_id: str):
    """Proxy a request to Zulip API with user's credentials and tenant filtering."""
    url = f"{ZULIP_SERVICE_URL}/api/v1/{zulip_path}"

    try:
        resp = requests.request(
            method=request.method,
            url=url,
            auth=(user_email, api_key),
            params=request.args,
            data=request.get_data(),
            headers={"Content-Type": request.headers.get("Content-Type", "application/json")},
            allow_redirects=False,
            timeout=120,  # Long-poll needs high timeout
        )
        return make_response(resp.content, resp.status_code, {
            "Content-Type": resp.headers.get("Content-Type", "application/json"),
        })
    except Exception as e:
        logger.error("Zulip proxy error to %s: %s", url, e)
        return jsonify({"error": "Zulip proxy error"}), 502
```

- [ ] **Step 3: Add the Zulip proxy route handler**

After the `agrienergy_proxy` route (around line 3077), add:

```python
# =============================================================================
# Zulip Communications Proxy
# =============================================================================

def _zulip_auth_and_tenant():
    """Authenticate user and extract tenant for Zulip routes. Returns (email, api_key, tenant, payload) or error response."""
    token = get_request_token()
    if not token:
        return jsonify({"error": "Missing or invalid authorization"}), 401
    payload = validate_jwt_token(token)
    if not payload:
        return jsonify({"error": "Invalid or expired token"}), 401
    tenant = extract_tenant_id(payload)
    if not tenant:
        return jsonify({"error": "Tenant not present in token"}), 401
    if not rate_limit(tenant):
        return jsonify({"error": "Rate limit exceeded"}), 429

    email = payload.get("email")
    if not email:
        return jsonify({"error": "Email not present in token"}), 401

    api_key = _get_zulip_api_key(email)
    if not api_key:
        return jsonify({"error": "Zulip account not found. Please log in to Zulip first via SSO."}), 404

    return email, api_key, tenant, payload


@app.route("/api/zulip/streams", methods=["GET"])
def zulip_streams():
    """List Zulip streams filtered by tenant."""
    result = _zulip_auth_and_tenant()
    if isinstance(result, tuple) and len(result) == 2:
        return result  # Error response
    email, api_key, tenant, payload = result

    try:
        resp = requests.get(
            f"{ZULIP_SERVICE_URL}/api/v1/streams",
            auth=(email, api_key),
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()

        # Filter streams: only tenant's streams + platform-announcements
        tenant_prefix = f"tenant-{tenant}-"
        filtered = [
            s for s in data.get("streams", [])
            if s["name"].startswith(tenant_prefix) or s["name"] == "platform-announcements"
        ]
        data["streams"] = filtered
        return jsonify(data), 200
    except Exception as e:
        logger.error("Zulip streams error: %s", e)
        return jsonify({"error": "Failed to fetch streams"}), 502


@app.route("/api/zulip/streams/<int:stream_id>/topics", methods=["GET"])
def zulip_stream_topics(stream_id):
    """Get topics for a stream."""
    result = _zulip_auth_and_tenant()
    if isinstance(result, tuple) and len(result) == 2:
        return result
    email, api_key, tenant, payload = result
    return _zulip_proxy_request(email, api_key, f"users/me/{stream_id}/topics", tenant)


@app.route("/api/zulip/messages", methods=["GET"])
def zulip_get_messages():
    """Get messages (with narrow for stream/topic/DM filtering)."""
    result = _zulip_auth_and_tenant()
    if isinstance(result, tuple) and len(result) == 2:
        return result
    email, api_key, tenant, payload = result

    # Validate narrow parameter contains only allowed streams
    import json as json_mod
    narrow = request.args.get("narrow")
    if narrow:
        try:
            narrow_list = json_mod.loads(narrow)
            for clause in narrow_list:
                if clause.get("operator") == "stream":
                    stream_name = clause.get("operand", "")
                    tenant_prefix = f"tenant-{tenant}-"
                    if not stream_name.startswith(tenant_prefix) and stream_name != "platform-announcements":
                        return jsonify({"error": "Access denied to stream"}), 403
        except (json_mod.JSONDecodeError, TypeError):
            pass  # Let Zulip handle malformed narrow

    return _zulip_proxy_request(email, api_key, "messages", tenant)


@app.route("/api/zulip/messages", methods=["POST"])
def zulip_send_message():
    """Send a message (quick-reply). Validates target stream belongs to tenant."""
    result = _zulip_auth_and_tenant()
    if isinstance(result, tuple) and len(result) == 2:
        return result
    email, api_key, tenant, payload = result

    data = request.get_json(silent=True) or {}
    msg_type = data.get("type", "")
    if msg_type == "stream":
        stream_name = data.get("to", "")
        tenant_prefix = f"tenant-{tenant}-"
        if not stream_name.startswith(tenant_prefix):
            return jsonify({"error": "Cannot send to streams outside your tenant"}), 403

    return _zulip_proxy_request(email, api_key, "messages", tenant)


@app.route("/api/zulip/messages/<int:message_id>/reactions", methods=["POST", "DELETE"])
def zulip_reactions(message_id):
    """Add/remove emoji reaction."""
    result = _zulip_auth_and_tenant()
    if isinstance(result, tuple) and len(result) == 2:
        return result
    email, api_key, tenant, payload = result
    return _zulip_proxy_request(email, api_key, f"messages/{message_id}/reactions", tenant)


@app.route("/api/zulip/users/me", methods=["GET"])
def zulip_user_me():
    """Get current user profile and unread counts."""
    result = _zulip_auth_and_tenant()
    if isinstance(result, tuple) and len(result) == 2:
        return result
    email, api_key, tenant, payload = result
    return _zulip_proxy_request(email, api_key, "users/me", tenant)


@app.route("/api/zulip/events/register", methods=["POST"])
def zulip_register_events():
    """Register an event queue for long-polling."""
    result = _zulip_auth_and_tenant()
    if isinstance(result, tuple) and len(result) == 2:
        return result
    email, api_key, tenant, payload = result
    return _zulip_proxy_request(email, api_key, "register", tenant)


@app.route("/api/zulip/events", methods=["GET", "DELETE"])
def zulip_events():
    """Long-poll for events or delete event queue."""
    result = _zulip_auth_and_tenant()
    if isinstance(result, tuple) and len(result) == 2:
        return result
    email, api_key, tenant, payload = result
    return _zulip_proxy_request(email, api_key, "events", tenant)


@app.route("/api/zulip/provisioning/<path:subpath>", methods=["POST", "DELETE"])
def zulip_provisioning(subpath):
    """Proxy provisioning requests to the provisioner service.
    Only platform admins can call these.
    """
    token = get_request_token()
    if not token:
        return jsonify({"error": "Missing authorization"}), 401
    payload = validate_jwt_token(token)
    if not payload:
        return jsonify({"error": "Invalid token"}), 401
    if not has_role("platform_admin", payload):
        return jsonify({"error": "Platform admin role required"}), 403

    provisioner_url = os.getenv("ZULIP_PROVISIONER_URL", "http://zulip-provisioner-service:5000")
    url = f"{provisioner_url}/api/provisioning/{subpath}"
    headers = {
        "Content-Type": request.headers.get("Content-Type", "application/json"),
        "X-Tenant-ID": extract_tenant_id(payload) or "",
    }
    try:
        resp = requests.request(
            method=request.method,
            url=url,
            headers=headers,
            data=request.get_data(),
            timeout=30,
        )
        return make_response(resp.content, resp.status_code, {
            "Content-Type": resp.headers.get("Content-Type", "application/json"),
        })
    except Exception as e:
        logger.error("Zulip provisioner proxy error: %s", e)
        return jsonify({"error": "Provisioner unavailable"}), 502
```

- [ ] **Step 4: Add `redis` to api-gateway requirements.txt**

In `nkz/services/api-gateway/requirements.txt`, add:

```
redis==5.2.1
```

- [ ] **Step 5: Add env vars to api-gateway K8s deployment**

In `nkz/k8s/core/services/api-gateway-deployment.yaml`, add these env vars to the container spec:

```yaml
- name: ZULIP_SERVICE_URL
  value: "http://zulip-service:80"
- name: ZULIP_BOT_EMAIL
  valueFrom:
    secretKeyRef:
      name: zulip-secret
      key: bot-email
- name: ZULIP_BOT_API_KEY
  valueFrom:
    secretKeyRef:
      name: zulip-secret
      key: bot-api-key
- name: ZULIP_PROVISIONER_URL
  value: "http://zulip-provisioner-service:5000"
```

- [ ] **Step 6: Commit**

```bash
cd ~/Documents/nekazari/nkz
git add services/api-gateway/fiware_api_gateway.py services/api-gateway/requirements.txt k8s/core/services/api-gateway-deployment.yaml
git commit -m "feat(api-gateway): add Zulip proxy routes with JWT-to-API-key bridge and tenant filtering"
```

---

## Phase 2: Provisioner Service Rewrite

### Task 2: Rewrite provisioner backend

**Files:**
- Rewrite: `nkz-module-zulip/backend/app.py`
- Rewrite: `nkz-module-zulip/backend/zulip_client.py`
- Modify: `nkz-module-zulip/backend/config.py`
- Delete: `nkz-module-zulip/backend/keycloak_client.py`
- Modify: `nkz-module-zulip/backend/requirements.txt`

- [ ] **Step 1: Update config.py**

Replace `nkz-module-zulip/backend/config.py` with:

```python
import os


class Config:
    # Zulip (admin/bot operations)
    ZULIP_URL = os.environ.get("ZULIP_URL", "http://zulip-service")
    ZULIP_BOT_EMAIL = os.environ.get("ZULIP_BOT_EMAIL", "")
    ZULIP_BOT_API_KEY = os.environ.get("ZULIP_BOT_API_KEY", "")

    # PostgreSQL (for reading communications_config)
    POSTGRES_URL = os.environ.get(
        "POSTGRES_URL",
        "postgresql://zulip_provisioner:@postgresql-service:5432/nekazari",
    )

    # Default stream templates (fallback if DB config not available)
    DEFAULT_STREAM_TEMPLATES = [
        {"suffix": "general", "description": "Open team communication"},
        {"suffix": "alerts", "description": "Automated IoT and risk alerts"},
    ]
```

- [ ] **Step 2: Rewrite zulip_client.py**

Replace `nkz-module-zulip/backend/zulip_client.py` with:

```python
"""Zulip API client for tenant provisioning operations."""

import logging
from typing import Optional

import requests

from config import Config

logger = logging.getLogger(__name__)


class ZulipClient:
    """Manages streams and user subscriptions for tenant provisioning."""

    def __init__(self):
        self.base_url = Config.ZULIP_URL
        self.bot_email = Config.ZULIP_BOT_EMAIL
        self.bot_api_key = Config.ZULIP_BOT_API_KEY

    @property
    def _auth(self):
        return (self.bot_email, self.bot_api_key)

    def health_check(self) -> bool:
        """Check if Zulip server is reachable."""
        try:
            resp = requests.get(
                f"{self.base_url}/api/v1/server_settings",
                timeout=5,
            )
            return resp.status_code == 200
        except requests.RequestException:
            return False

    def create_stream(self, name: str, description: str, invite_only: bool = True) -> bool:
        """Create a stream and subscribe the bot to it."""
        resp = requests.post(
            f"{self.base_url}/api/v1/users/me/subscriptions",
            auth=self._auth,
            data={
                "subscriptions": f'[{{"name": "{name}", "description": "{description}"}}]',
                "invite_only": str(invite_only).lower(),
            },
            timeout=15,
        )
        if resp.status_code == 200:
            logger.info("Created stream: %s", name)
            return True
        logger.error("Failed to create stream %s: %s", name, resp.text)
        return False

    def get_stream_id(self, name: str) -> Optional[int]:
        """Get stream ID by name."""
        resp = requests.get(
            f"{self.base_url}/api/v1/get_stream_id",
            auth=self._auth,
            params={"stream": name},
            timeout=10,
        )
        if resp.status_code == 200:
            return resp.json().get("stream_id")
        return None

    def subscribe_user(self, user_email: str, stream_name: str) -> bool:
        """Subscribe a user to a stream."""
        resp = requests.post(
            f"{self.base_url}/api/v1/users/me/subscriptions",
            auth=self._auth,
            data={
                "subscriptions": f'[{{"name": "{stream_name}"}}]',
                "principals": f'["{user_email}"]',
            },
            timeout=15,
        )
        if resp.status_code == 200:
            logger.info("Subscribed %s to %s", user_email, stream_name)
            return True
        logger.error("Failed to subscribe %s to %s: %s", user_email, stream_name, resp.text)
        return False

    def unsubscribe_user(self, user_email: str, stream_name: str) -> bool:
        """Unsubscribe a user from a stream."""
        resp = requests.patch(
            f"{self.base_url}/api/v1/users/me/subscriptions",
            auth=self._auth,
            data={
                "delete": f'["{stream_name}"]',
                "principals": f'["{user_email}"]',
            },
            timeout=15,
        )
        if resp.status_code == 200:
            logger.info("Unsubscribed %s from %s", user_email, stream_name)
            return True
        logger.error("Failed to unsubscribe %s from %s: %s", user_email, stream_name, resp.text)
        return False

    def archive_stream(self, stream_id: int) -> bool:
        """Archive (deactivate) a stream."""
        resp = requests.delete(
            f"{self.base_url}/api/v1/streams/{stream_id}",
            auth=self._auth,
            timeout=15,
        )
        if resp.status_code == 200:
            logger.info("Archived stream ID: %d", stream_id)
            return True
        logger.error("Failed to archive stream %d: %s", stream_id, resp.text)
        return False

    def post_message(self, stream: str, topic: str, content: str) -> dict:
        """Post a message to a stream/topic using bot credentials."""
        resp = requests.post(
            f"{self.base_url}/api/v1/messages",
            auth=self._auth,
            data={
                "type": "stream",
                "to": stream,
                "topic": topic,
                "content": content,
            },
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()

    def get_user_by_email(self, email: str) -> Optional[dict]:
        """Get Zulip user by email. Returns None if not found."""
        resp = requests.get(
            f"{self.base_url}/api/v1/users/{email}",
            auth=self._auth,
            timeout=10,
        )
        if resp.status_code == 200:
            return resp.json().get("user")
        return None
```

- [ ] **Step 3: Rewrite app.py**

Replace `nkz-module-zulip/backend/app.py` with:

```python
"""Zulip Provisioner — manages tenant lifecycle in Zulip.

Endpoints:
  POST   /api/provisioning/tenant           — Create streams for a new tenant
  DELETE /api/provisioning/tenant/<id>      — Archive tenant streams
  POST   /api/provisioning/tenant/<id>/user — Subscribe user to tenant streams
  DELETE /api/provisioning/tenant/<id>/user/<email> — Unsubscribe user
  POST   /api/provisioning/sync            — Reconcile desired vs actual state
  POST   /api/provisioning/announce        — Post to platform-announcements
  GET    /api/provisioning/bot/status      — Bot health check
  GET    /health                           — K8s health check
"""

import logging
import os

from flask import Flask, jsonify, request
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from config import Config
from zulip_client import ZulipClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def _get_stream_templates() -> list[dict]:
    """Read stream templates from DB, falling back to config defaults."""
    try:
        import psycopg2
        conn = psycopg2.connect(Config.POSTGRES_URL)
        cur = conn.cursor()
        cur.execute(
            "SELECT value FROM admin_platform.communications_config WHERE key = 'stream_templates'"
        )
        row = cur.fetchone()
        cur.close()
        conn.close()
        if row and row[0]:
            return row[0]  # JSONB returns as Python list
    except Exception:
        logger.warning("Could not read stream templates from DB, using defaults")
    return Config.DEFAULT_STREAM_TEMPLATES


def create_app():
    app = Flask(__name__)

    try:
        redis_url = os.environ.get("REDIS_URL", "redis://redis-service:6379/4")
        limiter = Limiter(
            get_remote_address,
            app=app,
            storage_uri=redis_url,
            default_limits=["60 per minute"],
        )
    except Exception:
        logger.warning("Redis unavailable for rate limiter, falling back to memory://")
        limiter = Limiter(
            get_remote_address,
            app=app,
            storage_uri="memory://",
            default_limits=["60 per minute"],
        )

    zulip = ZulipClient()

    @app.route("/health")
    @limiter.exempt
    def health():
        zulip_ok = zulip.health_check()
        return jsonify({
            "status": "healthy" if zulip_ok else "degraded",
            "zulip": "up" if zulip_ok else "down",
        }), 200 if zulip_ok else 503

    @app.route("/api/provisioning/bot/status", methods=["GET"])
    def bot_status():
        """Check bot connectivity and return status."""
        zulip_ok = zulip.health_check()
        return jsonify({
            "connected": zulip_ok,
            "bot_email": Config.ZULIP_BOT_EMAIL,
        }), 200

    @app.route("/api/provisioning/tenant", methods=["POST"])
    def create_tenant():
        """Create Zulip streams for a new tenant.

        Expected JSON: {"tenant_id": "farm-acme", "tenant_name": "Acme Farms"}
        Called by tenant-webhook when a new tenant is created.
        """
        data = request.get_json()
        if not data:
            return jsonify({"error": "JSON body required"}), 400

        tenant_id = data.get("tenant_id")
        tenant_name = data.get("tenant_name")
        if not tenant_id or not tenant_name:
            return jsonify({"error": "tenant_id and tenant_name required"}), 400

        templates = _get_stream_templates()
        created = []
        failed = []

        for tmpl in templates:
            stream_name = f"tenant-{tenant_id}-{tmpl['suffix']}"
            description = f"[{tenant_name}] {tmpl['description']}"
            if zulip.create_stream(stream_name, description, invite_only=True):
                created.append(stream_name)
            else:
                failed.append(stream_name)

        # Subscribe bot to alerts stream for automated notifications
        alerts_stream = f"tenant-{tenant_id}-alerts"
        zulip.subscribe_user(Config.ZULIP_BOT_EMAIL, alerts_stream)

        status_code = 201 if not failed else 207
        return jsonify({
            "status": "provisioned" if not failed else "partial",
            "tenant_id": tenant_id,
            "created": created,
            "failed": failed,
        }), status_code

    @app.route("/api/provisioning/tenant/<tenant_id>", methods=["DELETE"])
    def archive_tenant(tenant_id):
        """Archive all streams for a tenant (preserves history)."""
        templates = _get_stream_templates()
        archived = []
        failed = []

        for tmpl in templates:
            stream_name = f"tenant-{tenant_id}-{tmpl['suffix']}"
            stream_id = zulip.get_stream_id(stream_name)
            if stream_id is not None:
                if zulip.archive_stream(stream_id):
                    archived.append(stream_name)
                else:
                    failed.append(stream_name)

        return jsonify({
            "status": "archived" if not failed else "partial",
            "tenant_id": tenant_id,
            "archived": archived,
            "failed": failed,
        }), 200

    @app.route("/api/provisioning/tenant/<tenant_id>/user", methods=["POST"])
    def add_user(tenant_id):
        """Subscribe a user to all tenant streams.

        Expected JSON: {"email": "user@example.com"}
        """
        data = request.get_json()
        if not data or not data.get("email"):
            return jsonify({"error": "email required"}), 400

        email = data["email"]
        templates = _get_stream_templates()
        subscribed = []

        for tmpl in templates:
            stream_name = f"tenant-{tenant_id}-{tmpl['suffix']}"
            if zulip.subscribe_user(email, stream_name):
                subscribed.append(stream_name)

        return jsonify({
            "status": "subscribed",
            "email": email,
            "streams": subscribed,
        }), 200

    @app.route("/api/provisioning/tenant/<tenant_id>/user/<email>", methods=["DELETE"])
    def remove_user(tenant_id, email):
        """Unsubscribe a user from all tenant streams."""
        templates = _get_stream_templates()
        unsubscribed = []

        for tmpl in templates:
            stream_name = f"tenant-{tenant_id}-{tmpl['suffix']}"
            if zulip.unsubscribe_user(email, stream_name):
                unsubscribed.append(stream_name)

        return jsonify({
            "status": "unsubscribed",
            "email": email,
            "streams": unsubscribed,
        }), 200

    @app.route("/api/provisioning/sync", methods=["POST"])
    def sync():
        """Reconcile: ensure all tenants have their expected streams.

        Expected JSON: {"tenants": [{"tenant_id": "x", "tenant_name": "X"}, ...]}
        """
        data = request.get_json()
        if not data or not data.get("tenants"):
            return jsonify({"error": "tenants array required"}), 400

        templates = _get_stream_templates()
        results = []

        for tenant in data["tenants"]:
            tid = tenant["tenant_id"]
            tname = tenant["tenant_name"]
            created = []
            for tmpl in templates:
                stream_name = f"tenant-{tid}-{tmpl['suffix']}"
                stream_id = zulip.get_stream_id(stream_name)
                if stream_id is None:
                    desc = f"[{tname}] {tmpl['description']}"
                    if zulip.create_stream(stream_name, desc, invite_only=True):
                        created.append(stream_name)
            results.append({"tenant_id": tid, "created": created})

        return jsonify({"status": "synced", "results": results}), 200

    @app.route("/api/provisioning/announce", methods=["POST"])
    def announce():
        """Post an announcement to #platform-announcements.

        Expected JSON: {"topic": "maintenance", "content": "Scheduled maintenance..."}
        """
        data = request.get_json()
        if not data or not data.get("content"):
            return jsonify({"error": "content required"}), 400

        topic = data.get("topic", "general")
        content = data["content"]

        try:
            result = zulip.post_message(
                stream="platform-announcements",
                topic=topic,
                content=content,
            )
            return jsonify({"status": "sent", "message_id": result.get("id")}), 200
        except Exception:
            logger.exception("Failed to post announcement")
            return jsonify({"error": "Failed to send announcement"}), 500

    return app


if __name__ == "__main__":
    create_app().run(host="0.0.0.0", port=5000, debug=True)
```

- [ ] **Step 4: Delete keycloak_client.py**

```bash
cd ~/Documents/nekazari/nkz-module-zulip
rm backend/keycloak_client.py
```

OIDC client creation is handled by `scripts/keycloak-create-zulip-client.sh`. The provisioner does not need to manage Keycloak clients.

- [ ] **Step 5: Update requirements.txt**

Replace `nkz-module-zulip/backend/requirements.txt` with:

```
flask==3.1.1
gunicorn==23.0.0
requests==2.32.3
flask-limiter==3.12
psycopg2-binary==2.9.10
```

- [ ] **Step 6: Update provisioner K8s deployment env vars**

In `nkz-module-zulip/k8s/provisioner-deployment.yaml`, replace the entire `env` block with:

```yaml
env:
  - name: ZULIP_URL
    value: "http://zulip-service"
  - name: ZULIP_BOT_EMAIL
    valueFrom:
      secretKeyRef:
        name: zulip-secret
        key: bot-email
  - name: ZULIP_BOT_API_KEY
    valueFrom:
      secretKeyRef:
        name: zulip-secret
        key: bot-api-key
  - name: POSTGRES_URL
    value: "postgresql://zulip_provisioner:@postgresql-service:5432/nekazari"
  - name: REDIS_URL
    value: "redis://redis-service:6379/4"
```

- [ ] **Step 7: Commit**

```bash
cd ~/Documents/nekazari/nkz-module-zulip
git add backend/ k8s/provisioner-deployment.yaml
git commit -m "feat(provisioner): rewrite with tenant stream lifecycle management"
```

---

## Phase 3: DB Migration

### Task 3: Create communications_config table

**Files:**
- Create: `nkz/config/timescaledb/migrations/065_communications_config.sql`

- [ ] **Step 1: Write the migration**

Create `nkz/config/timescaledb/migrations/065_communications_config.sql`:

```sql
-- 065: Communications module configuration
-- Stores bot config, notification templates, and stream templates
-- for the Zulip communications hub.

CREATE TABLE IF NOT EXISTS admin_platform.communications_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Default stream templates
INSERT INTO admin_platform.communications_config (key, value)
VALUES (
    'stream_templates',
    '[
        {"suffix": "general", "description": "Open team communication"},
        {"suffix": "alerts", "description": "Automated IoT and risk alerts"}
    ]'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- Default notification templates
INSERT INTO admin_platform.communications_config (key, value)
VALUES (
    'notification_templates',
    '[
        {
            "id": "iot_alert",
            "name": "IoT Alert",
            "topic": "iot-alerts",
            "template": "**{severity} Alert** — {sensor_name}\n\nValue: `{value}` (threshold: `{threshold}`)\nTime: {timestamp}\n\n[View entity]({entity_link})"
        },
        {
            "id": "risk_warning",
            "name": "Risk Warning",
            "topic": "risk-warnings",
            "template": "**Risk: {risk_type}** — {parcel_name}\n\nLevel: {level}\nDetails: {details}\nTime: {timestamp}"
        },
        {
            "id": "maintenance",
            "name": "Maintenance Notice",
            "topic": "maintenance",
            "template": "**Scheduled Maintenance**\n\nDate: {date}\nDuration: {duration}\nAffected services: {services}\n\n{details}"
        }
    ]'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- Bot configuration placeholder
INSERT INTO admin_platform.communications_config (key, value)
VALUES (
    'bot_config',
    '{"announcements_stream": "platform-announcements"}'::jsonb
)
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Commit**

```bash
cd ~/Documents/nekazari/nkz
git add config/timescaledb/migrations/065_communications_config.sql
git commit -m "feat(db): add communications_config table for Zulip hub settings"
```

---

## Phase 4: Frontend — Communications Hub

### Task 4: TypeScript types and utilities

**Files:**
- Create: `nkz-module-zulip/src/types/zulip.ts`
- Create: `nkz-module-zulip/src/utils/sanitize.ts`
- Create: `nkz-module-zulip/src/utils/time.ts`

- [ ] **Step 1: Create Zulip API types**

Create `nkz-module-zulip/src/types/zulip.ts`:

```typescript
export interface ZulipStream {
  stream_id: number;
  name: string;
  description: string;
  invite_only: boolean;
  is_muted: boolean;
}

export interface ZulipTopic {
  name: string;
  max_id: number;
}

export interface ZulipMessage {
  id: number;
  sender_id: number;
  sender_email: string;
  sender_full_name: string;
  avatar_url: string;
  content: string; // Pre-rendered HTML from Zulip
  content_type: string;
  timestamp: number; // Unix epoch seconds
  stream_id: number;
  subject: string; // topic name
  display_recipient: string | ZulipDMRecipient[];
  type: 'stream' | 'private';
  flags: string[];
}

export interface ZulipDMRecipient {
  id: number;
  email: string;
  full_name: string;
}

export interface ZulipUnreadCount {
  stream_id: number;
  topic: string;
  unread_message_ids: number[];
}

export interface ZulipEvent {
  type: string;
  id: number;
  message?: ZulipMessage;
  [key: string]: unknown;
}

export interface ZulipEventQueueResponse {
  queue_id: string;
  last_event_id: number;
  unread_msgs: {
    streams: ZulipUnreadCount[];
    pms: { sender_id: number; unread_message_ids: number[] }[];
    count: number;
  };
}

export type ConnectionState = 'connected' | 'reconnecting' | 'error';
```

- [ ] **Step 2: Create sanitize utility**

Create `nkz-module-zulip/src/utils/sanitize.ts`:

```typescript
const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'em', 'code', 'pre', 'a', 'ul', 'ol', 'li',
  'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'div',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'del',
]);

const ALLOWED_ATTRS = new Set([
  'href', 'target', 'rel', 'src', 'alt', 'class', 'title',
]);

/**
 * Basic sanitization of Zulip-rendered HTML.
 * Zulip's server already renders Markdown to safe HTML, but we strip
 * any unexpected tags/attributes as defense-in-depth.
 */
export function sanitizeZulipHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  sanitizeNode(doc.body);
  return doc.body.innerHTML;
}

function sanitizeNode(node: Node): void {
  const children = Array.from(node.childNodes);
  for (const child of children) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      const tag = el.tagName.toLowerCase();

      if (!ALLOWED_TAGS.has(tag)) {
        // Replace disallowed tag with its text content
        const text = document.createTextNode(el.textContent || '');
        node.replaceChild(text, child);
        continue;
      }

      // Remove disallowed attributes
      const attrs = Array.from(el.attributes);
      for (const attr of attrs) {
        if (!ALLOWED_ATTRS.has(attr.name)) {
          el.removeAttribute(attr.name);
        }
      }

      // Force external links to open in new tab safely
      if (tag === 'a') {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }

      sanitizeNode(el);
    }
  }
}
```

- [ ] **Step 3: Create time utility**

Create `nkz-module-zulip/src/utils/time.ts`:

```typescript
/**
 * Format a Unix timestamp (seconds) as a relative time string.
 * Uses the user's locale for formatting.
 */
export function formatRelativeTime(epochSeconds: number): string {
  const now = Date.now() / 1000;
  const diff = now - epochSeconds;

  if (diff < 60) return '< 1 min';
  if (diff < 3600) return `${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;

  const date = new Date(epochSeconds * 1000);
  const today = new Date();

  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `ayer ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  }

  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
```

- [ ] **Step 4: Commit**

```bash
cd ~/Documents/nekazari/nkz-module-zulip
git add src/types/zulip.ts src/utils/sanitize.ts src/utils/time.ts
git commit -m "feat: add Zulip API types and utility functions"
```

### Task 5: API hooks

**Files:**
- Create: `nkz-module-zulip/src/hooks/useZulipApi.ts`
- Create: `nkz-module-zulip/src/hooks/useZulipEvents.ts`

- [ ] **Step 1: Create useZulipApi hook**

Create `nkz-module-zulip/src/hooks/useZulipApi.ts`:

```typescript
import { useCallback } from 'react';

const API_BASE = '/api/zulip';

/**
 * Wrapper for Zulip API calls through api-gateway proxy.
 * Auth is handled automatically via httpOnly cookie (nkz_token).
 */
async function zulipFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${window.__ENV__?.VITE_API_URL || ''}${API_BASE}${path}`;
  const resp = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    },
    ...options,
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `Zulip API error: ${resp.status}`);
  }

  return resp.json();
}

export function useZulipApi() {
  const getStreams = useCallback(() => {
    return zulipFetch<{ streams: import('../types/zulip').ZulipStream[] }>('/streams');
  }, []);

  const getTopics = useCallback((streamId: number) => {
    return zulipFetch<{ topics: import('../types/zulip').ZulipTopic[] }>(
      `/streams/${streamId}/topics`
    );
  }, []);

  const getMessages = useCallback(
    (narrow: Array<{ operator: string; operand: string | number }>, numBefore = 20, numAfter = 0) => {
      const params = new URLSearchParams({
        narrow: JSON.stringify(narrow),
        num_before: String(numBefore),
        num_after: String(numAfter),
        anchor: 'newest',
      });
      return zulipFetch<{ messages: import('../types/zulip').ZulipMessage[] }>(
        `/messages?${params}`
      );
    },
    []
  );

  const sendMessage = useCallback(
    (params: { type: 'stream' | 'direct'; to: string | number[]; topic?: string; content: string }) => {
      return zulipFetch<{ id: number }>('/messages', {
        method: 'POST',
        body: JSON.stringify(params),
      });
    },
    []
  );

  const addReaction = useCallback((messageId: number, emojiName: string) => {
    return zulipFetch(`/messages/${messageId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji_name: emojiName }),
    });
  }, []);

  const getProfile = useCallback(() => {
    return zulipFetch<{ user_id: number; email: string; full_name: string }>('/users/me');
  }, []);

  return { getStreams, getTopics, getMessages, sendMessage, addReaction, getProfile };
}
```

- [ ] **Step 2: Create useZulipEvents hook**

Create `nkz-module-zulip/src/hooks/useZulipEvents.ts`:

```typescript
import { useEffect, useRef, useCallback, useState } from 'react';
import type { ZulipEvent, ZulipEventQueueResponse, ConnectionState } from '../types/zulip';

const API_BASE = '/api/zulip';

function apiUrl(path: string): string {
  return `${window.__ENV__?.VITE_API_URL || ''}${API_BASE}${path}`;
}

async function fetchJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const resp = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!resp.ok) throw new Error(`Event API error: ${resp.status}`);
  return resp.json();
}

interface UseZulipEventsOptions {
  onEvent: (event: ZulipEvent) => void;
  onInitialState?: (state: ZulipEventQueueResponse) => void;
  enabled?: boolean;
}

/**
 * Long-polling event loop for real-time Zulip updates.
 * Registers an event queue, polls for events, and auto-reconnects.
 */
export function useZulipEvents({ onEvent, onInitialState, enabled = true }: UseZulipEventsOptions) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('reconnecting');
  const queueRef = useRef<{ queueId: string; lastEventId: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const backoffRef = useRef(1000);

  const register = useCallback(async () => {
    try {
      const data = await fetchJson<ZulipEventQueueResponse>(
        apiUrl('/events/register'),
        {
          method: 'POST',
          body: JSON.stringify({
            event_types: JSON.stringify(['message', 'update_message', 'subscription', 'reaction']),
            apply_markdown: true,
            all_public_streams: false,
          }),
        }
      );
      queueRef.current = { queueId: data.queue_id, lastEventId: data.last_event_id };
      backoffRef.current = 1000;
      setConnectionState('connected');
      onInitialState?.(data);
      return true;
    } catch {
      setConnectionState('error');
      return false;
    }
  }, [onInitialState]);

  const poll = useCallback(async () => {
    if (!queueRef.current || !mountedRef.current) return;

    const { queueId, lastEventId } = queueRef.current;
    abortRef.current = new AbortController();

    try {
      const params = new URLSearchParams({
        queue_id: queueId,
        last_event_id: String(lastEventId),
      });
      const data = await fetchJson<{ events: ZulipEvent[] }>(
        apiUrl(`/events?${params}`),
        { signal: abortRef.current.signal }
      );

      if (!mountedRef.current) return;

      for (const event of data.events) {
        queueRef.current!.lastEventId = event.id;
        onEvent(event);
      }

      backoffRef.current = 1000;
      setConnectionState('connected');

      // Continue polling
      if (mountedRef.current) poll();
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;

      setConnectionState('reconnecting');

      // Queue expired or error — re-register after backoff
      const delay = Math.min(backoffRef.current, 30000);
      backoffRef.current = delay * 2;

      setTimeout(async () => {
        if (!mountedRef.current) return;
        const ok = await register();
        if (ok && mountedRef.current) poll();
      }, delay);
    }
  }, [onEvent, register]);

  useEffect(() => {
    mountedRef.current = true;

    if (!enabled) {
      setConnectionState('error');
      return;
    }

    (async () => {
      const ok = await register();
      if (ok && mountedRef.current) poll();
    })();

    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();

      // Cleanup queue
      if (queueRef.current) {
        const params = new URLSearchParams({ queue_id: queueRef.current.queueId });
        fetch(apiUrl(`/events?${params}`), {
          method: 'DELETE',
          credentials: 'include',
        }).catch(() => {});
        queueRef.current = null;
      }
    };
  }, [enabled, register, poll]);

  return { connectionState };
}
```

- [ ] **Step 3: Commit**

```bash
cd ~/Documents/nekazari/nkz-module-zulip
git add src/hooks/useZulipApi.ts src/hooks/useZulipEvents.ts
git commit -m "feat: add Zulip API and long-polling event hooks"
```

### Task 6: Shared UI components

**Files:**
- Create: `nkz-module-zulip/src/components/ConnectionStatus.tsx`
- Create: `nkz-module-zulip/src/components/MessageBubble.tsx`
- Create: `nkz-module-zulip/src/components/QuickReply.tsx`

- [ ] **Step 1: Create ConnectionStatus component**

Create `nkz-module-zulip/src/components/ConnectionStatus.tsx`:

```tsx
import React from 'react';
import { useTranslation } from '@nekazari/sdk';
import type { ConnectionState } from '../types/zulip';

interface Props {
  state: ConnectionState;
}

const STATUS_STYLES: Record<ConnectionState, { dot: string; textKey: string }> = {
  connected: { dot: 'bg-green-500', textKey: 'hub.connected' },
  reconnecting: { dot: 'bg-yellow-500 animate-pulse', textKey: 'hub.reconnecting' },
  error: { dot: 'bg-red-500', textKey: 'hub.disconnected' },
};

const ConnectionStatus: React.FC<Props> = ({ state }) => {
  const { t } = useTranslation('zulip');
  const { dot, textKey } = STATUS_STYLES[state];

  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      <span className="text-xs text-slate-500 dark:text-slate-400">{t(textKey)}</span>
    </div>
  );
};

export default ConnectionStatus;
```

- [ ] **Step 2: Create MessageBubble component**

Create `nkz-module-zulip/src/components/MessageBubble.tsx`:

```tsx
import React, { useMemo } from 'react';
import type { ZulipMessage } from '../types/zulip';
import { sanitizeZulipHtml } from '../utils/sanitize';
import { formatRelativeTime } from '../utils/time';

interface Props {
  message: ZulipMessage;
}

const MessageBubble: React.FC<Props> = ({ message }) => {
  const safeHtml = useMemo(() => sanitizeZulipHtml(message.content), [message.content]);
  const time = useMemo(() => formatRelativeTime(message.timestamp), [message.timestamp]);

  return (
    <div className="flex gap-2 py-1.5 px-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded">
      <img
        src={message.avatar_url}
        alt=""
        className="w-7 h-7 rounded-full flex-shrink-0 mt-0.5"
        loading="lazy"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
            {message.sender_full_name}
          </span>
          <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">
            {time}
          </span>
        </div>
        <div
          className="text-sm text-slate-700 dark:text-slate-300 [&_p]:my-0.5 [&_code]:bg-slate-100 dark:[&_code]:bg-slate-700 [&_code]:px-1 [&_code]:rounded [&_a]:text-blue-600 dark:[&_a]:text-blue-400 [&_a]:underline break-words"
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
      </div>
    </div>
  );
};

export default MessageBubble;
```

- [ ] **Step 3: Create QuickReply component**

Create `nkz-module-zulip/src/components/QuickReply.tsx`:

```tsx
import React, { useState, useCallback, useRef } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { Send } from 'lucide-react';

interface Props {
  onSend: (content: string) => Promise<void>;
  disabled?: boolean;
}

const QuickReply: React.FC<Props> = ({ onSend, disabled = false }) => {
  const { t } = useTranslation('zulip');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);
    try {
      await onSend(trimmed);
      setText('');
      inputRef.current?.focus();
    } catch {
      // Error handling is in the parent
    } finally {
      setSending(false);
    }
  }, [text, sending, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="flex items-end gap-2 p-2 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
      <textarea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('quickReply.placeholder')}
        disabled={disabled || sending}
        rows={1}
        className="flex-1 resize-none rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
      />
      <button
        onClick={handleSend}
        disabled={disabled || sending || !text.trim()}
        className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
        aria-label={t('quickReply.send')}
      >
        <Send className="w-4 h-4" />
      </button>
    </div>
  );
};

export default QuickReply;
```

- [ ] **Step 4: Commit**

```bash
cd ~/Documents/nekazari/nkz-module-zulip
git add src/components/ConnectionStatus.tsx src/components/MessageBubble.tsx src/components/QuickReply.tsx
git commit -m "feat: add shared UI components — ConnectionStatus, MessageBubble, QuickReply"
```

### Task 7: Panel components

**Files:**
- Create: `nkz-module-zulip/src/components/AlertsPanel.tsx`
- Create: `nkz-module-zulip/src/components/StreamsPanel.tsx`
- Create: `nkz-module-zulip/src/components/StreamDetail.tsx`
- Create: `nkz-module-zulip/src/components/DirectMessagesPanel.tsx`
- Create: `nkz-module-zulip/src/components/AnnouncementsPanel.tsx`

- [ ] **Step 1: Create AlertsPanel**

Create `nkz-module-zulip/src/components/AlertsPanel.tsx`:

```tsx
import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import type { ZulipMessage, ZulipStream } from '../types/zulip';
import { useZulipApi } from '../hooks/useZulipApi';
import MessageBubble from './MessageBubble';

interface Props {
  alertsStream: ZulipStream | null;
  newMessages: ZulipMessage[];
}

const AlertsPanel: React.FC<Props> = ({ alertsStream, newMessages }) => {
  const { t } = useTranslation('zulip');
  const { getMessages } = useZulipApi();
  const [messages, setMessages] = useState<ZulipMessage[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [loading, setLoading] = useState(false);

  const loadMessages = useCallback(async () => {
    if (!alertsStream) return;
    setLoading(true);
    try {
      const data = await getMessages(
        [{ operator: 'stream', operand: alertsStream.name }],
        10
      );
      setMessages(data.messages);
    } catch {
      // Silent — panel shows empty state
    } finally {
      setLoading(false);
    }
  }, [alertsStream, getMessages]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // Append real-time messages
  useEffect(() => {
    if (newMessages.length === 0) return;
    setMessages((prev) => {
      const ids = new Set(prev.map((m) => m.id));
      const fresh = newMessages.filter((m) => !ids.has(m.id));
      return [...prev, ...fresh];
    });
  }, [newMessages]);

  const unreadCount = messages.filter((m) => !m.flags.includes('read')).length;

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />
          <span className="text-sm font-semibold text-red-800 dark:text-red-300">
            {t('alerts.title')}
          </span>
          {unreadCount > 0 && (
            <span className="px-1.5 py-0.5 text-xs font-medium bg-red-600 text-white rounded-full">
              {unreadCount}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-red-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-red-400" />
        )}
      </button>
      {expanded && (
        <div className="max-h-64 overflow-y-auto bg-white dark:bg-slate-900">
          {loading && messages.length === 0 ? (
            <p className="text-sm text-slate-400 p-4 text-center">{t('loading')}</p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-slate-400 p-4 text-center">{t('alerts.empty')}</p>
          ) : (
            messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
          )}
        </div>
      )}
    </div>
  );
};

export default AlertsPanel;
```

- [ ] **Step 2: Create StreamDetail**

Create `nkz-module-zulip/src/components/StreamDetail.tsx`:

```tsx
import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { ExternalLink } from 'lucide-react';
import type { ZulipMessage, ZulipTopic } from '../types/zulip';
import { useZulipApi } from '../hooks/useZulipApi';
import MessageBubble from './MessageBubble';
import QuickReply from './QuickReply';

interface Props {
  streamId: number;
  streamName: string;
  newMessages: ZulipMessage[];
}

const StreamDetail: React.FC<Props> = ({ streamId, streamName, newMessages }) => {
  const { t } = useTranslation('zulip');
  const { getTopics, getMessages, sendMessage } = useZulipApi();
  const [topics, setTopics] = useState<ZulipTopic[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [messages, setMessages] = useState<ZulipMessage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await getTopics(streamId);
        setTopics(data.topics.slice(0, 10));
      } catch {
        // Silently fail
      }
    })();
  }, [streamId, getTopics]);

  const loadTopicMessages = useCallback(
    async (topic: string) => {
      setSelectedTopic(topic);
      setLoading(true);
      try {
        const data = await getMessages(
          [
            { operator: 'stream', operand: streamName },
            { operator: 'topic', operand: topic },
          ],
          15
        );
        setMessages(data.messages);
      } catch {
        setMessages([]);
      } finally {
        setLoading(false);
      }
    },
    [streamName, getMessages]
  );

  // Append real-time messages for selected topic
  useEffect(() => {
    if (!selectedTopic || newMessages.length === 0) return;
    const relevant = newMessages.filter(
      (m) => m.stream_id === streamId && m.subject === selectedTopic
    );
    if (relevant.length === 0) return;
    setMessages((prev) => {
      const ids = new Set(prev.map((m) => m.id));
      return [...prev, ...relevant.filter((m) => !ids.has(m.id))];
    });
  }, [newMessages, streamId, selectedTopic]);

  const handleSend = useCallback(
    async (content: string) => {
      if (!selectedTopic) return;
      await sendMessage({ type: 'stream', to: streamName, topic: selectedTopic, content });
    },
    [selectedTopic, streamName, sendMessage]
  );

  const zulipUrl = window.__ENV__?.VITE_ZULIP_URL || '';

  return (
    <div className="border-t border-slate-100 dark:border-slate-800">
      {/* Topic list */}
      <div className="flex flex-wrap gap-1 p-2">
        {topics.map((topic) => (
          <button
            key={topic.name}
            onClick={() => loadTopicMessages(topic.name)}
            className={`text-xs px-2 py-1 rounded-full border transition-colors ${
              selectedTopic === topic.name
                ? 'bg-blue-100 dark:bg-blue-900/40 border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300'
                : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            {topic.name}
          </button>
        ))}
      </div>

      {/* Messages for selected topic */}
      {selectedTopic && (
        <div>
          <div className="max-h-72 overflow-y-auto">
            {loading ? (
              <p className="text-sm text-slate-400 p-4 text-center">{t('loading')}</p>
            ) : messages.length === 0 ? (
              <p className="text-sm text-slate-400 p-4 text-center">{t('noMessages')}</p>
            ) : (
              messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
            )}
          </div>
          <QuickReply onSend={handleSend} />
          {zulipUrl && (
            <div className="px-3 py-1.5 text-center">
              <a
                href={`${zulipUrl}/#narrow/stream/${encodeURIComponent(streamName)}/topic/${encodeURIComponent(selectedTopic)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
              >
                {t('hub.openInZulip')} <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default StreamDetail;
```

- [ ] **Step 3: Create StreamsPanel**

Create `nkz-module-zulip/src/components/StreamsPanel.tsx`:

```tsx
import React, { useState } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { Hash, ChevronDown, ChevronUp } from 'lucide-react';
import type { ZulipStream, ZulipMessage, ZulipUnreadCount } from '../types/zulip';
import StreamDetail from './StreamDetail';

interface Props {
  streams: ZulipStream[];
  unreads: ZulipUnreadCount[];
  newMessages: ZulipMessage[];
}

const StreamsPanel: React.FC<Props> = ({ streams, unreads, newMessages }) => {
  const { t } = useTranslation('zulip');
  const [expanded, setExpanded] = useState(true);
  const [openStreamId, setOpenStreamId] = useState<number | null>(null);

  // Filter out alerts and announcements streams (handled by dedicated panels)
  const regularStreams = streams.filter(
    (s) => !s.name.endsWith('-alerts') && s.name !== 'platform-announcements'
  );

  const getUnreadCount = (streamId: number) => {
    return unreads
      .filter((u) => u.stream_id === streamId)
      .reduce((sum, u) => sum + u.unread_message_ids.length, 0);
  };

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Hash className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t('streams.title')}
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        )}
      </button>
      {expanded && (
        <div className="bg-white dark:bg-slate-900">
          {regularStreams.length === 0 ? (
            <p className="text-sm text-slate-400 p-4 text-center">{t('streams.empty')}</p>
          ) : (
            regularStreams.map((stream) => {
              const count = getUnreadCount(stream.stream_id);
              const isOpen = openStreamId === stream.stream_id;
              return (
                <div key={stream.stream_id}>
                  <button
                    onClick={() => setOpenStreamId(isOpen ? null : stream.stream_id)}
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors border-b border-slate-100 dark:border-slate-800 last:border-b-0"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Hash className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <span className="text-sm text-slate-700 dark:text-slate-300 truncate">
                        {stream.name.replace(/^tenant-[^-]+-/, '')}
                      </span>
                    </div>
                    {count > 0 && (
                      <span className="px-1.5 py-0.5 text-xs font-medium bg-blue-600 text-white rounded-full flex-shrink-0">
                        {count}
                      </span>
                    )}
                  </button>
                  {isOpen && (
                    <StreamDetail
                      streamId={stream.stream_id}
                      streamName={stream.name}
                      newMessages={newMessages}
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

export default StreamsPanel;
```

- [ ] **Step 4: Create DirectMessagesPanel**

Create `nkz-module-zulip/src/components/DirectMessagesPanel.tsx`:

```tsx
import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { MessageSquare, ChevronDown, ChevronUp } from 'lucide-react';
import type { ZulipMessage } from '../types/zulip';
import { useZulipApi } from '../hooks/useZulipApi';
import MessageBubble from './MessageBubble';
import QuickReply from './QuickReply';

interface DMConversation {
  peerId: number;
  peerEmail: string;
  peerName: string;
  avatarUrl: string;
  unreadCount: number;
}

interface Props {
  dmUnreads: { sender_id: number; unread_message_ids: number[] }[];
  newMessages: ZulipMessage[];
}

const DirectMessagesPanel: React.FC<Props> = ({ dmUnreads, newMessages }) => {
  const { t } = useTranslation('zulip');
  const { getMessages, sendMessage } = useZulipApi();
  const [expanded, setExpanded] = useState(false);
  const [conversations, setConversations] = useState<DMConversation[]>([]);
  const [openPeerId, setOpenPeerId] = useState<number | null>(null);
  const [peerMessages, setPeerMessages] = useState<ZulipMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Build conversation list from recent DMs
  useEffect(() => {
    (async () => {
      try {
        const data = await getMessages([{ operator: 'is', operand: 'private' }], 30);
        const peerMap = new Map<number, DMConversation>();

        for (const msg of data.messages) {
          if (msg.type !== 'private' || !Array.isArray(msg.display_recipient)) continue;
          for (const r of msg.display_recipient) {
            if (r.email === msg.sender_email && msg.display_recipient.length > 1) continue;
            if (!peerMap.has(r.id)) {
              const unread = dmUnreads.find((u) => u.sender_id === r.id);
              peerMap.set(r.id, {
                peerId: r.id,
                peerEmail: r.email,
                peerName: r.full_name,
                avatarUrl: msg.avatar_url,
                unreadCount: unread?.unread_message_ids.length || 0,
              });
            }
          }
        }
        setConversations(Array.from(peerMap.values()));
      } catch {
        // Silent
      }
    })();
  }, [getMessages, dmUnreads]);

  const openConversation = useCallback(
    async (peerId: number, peerEmail: string) => {
      setOpenPeerId(peerId);
      setLoadingMessages(true);
      try {
        const data = await getMessages(
          [{ operator: 'pm-with', operand: peerEmail }],
          20
        );
        setPeerMessages(data.messages);
      } catch {
        setPeerMessages([]);
      } finally {
        setLoadingMessages(false);
      }
    },
    [getMessages]
  );

  // Append real-time DMs
  useEffect(() => {
    if (!openPeerId || newMessages.length === 0) return;
    const relevant = newMessages.filter(
      (m) => m.type === 'private' && (m.sender_id === openPeerId || m.display_recipient === openPeerId)
    );
    if (relevant.length === 0) return;
    setPeerMessages((prev) => {
      const ids = new Set(prev.map((m) => m.id));
      return [...prev, ...relevant.filter((m) => !ids.has(m.id))];
    });
  }, [newMessages, openPeerId]);

  const handleSend = useCallback(
    async (content: string) => {
      if (openPeerId === null) return;
      const peer = conversations.find((c) => c.peerId === openPeerId);
      if (!peer) return;
      await sendMessage({ type: 'direct', to: [openPeerId], content });
    },
    [openPeerId, conversations, sendMessage]
  );

  const totalUnread = dmUnreads.reduce((sum, u) => sum + u.unread_message_ids.length, 0);

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
      >
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-purple-600 dark:text-purple-400" />
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t('dm.title')}
          </span>
          {totalUnread > 0 && (
            <span className="px-1.5 py-0.5 text-xs font-medium bg-purple-600 text-white rounded-full">
              {totalUnread}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        )}
      </button>
      {expanded && (
        <div className="bg-white dark:bg-slate-900">
          {conversations.length === 0 ? (
            <p className="text-sm text-slate-400 p-4 text-center">{t('dm.empty')}</p>
          ) : (
            conversations.map((conv) => (
              <div key={conv.peerId}>
                <button
                  onClick={() =>
                    openPeerId === conv.peerId
                      ? setOpenPeerId(null)
                      : openConversation(conv.peerId, conv.peerEmail)
                  }
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors border-b border-slate-100 dark:border-slate-800"
                >
                  <img
                    src={conv.avatarUrl}
                    alt=""
                    className="w-7 h-7 rounded-full flex-shrink-0"
                  />
                  <span className="text-sm text-slate-700 dark:text-slate-300 truncate flex-1 text-left">
                    {conv.peerName}
                  </span>
                  {conv.unreadCount > 0 && (
                    <span className="px-1.5 py-0.5 text-xs font-medium bg-purple-600 text-white rounded-full">
                      {conv.unreadCount}
                    </span>
                  )}
                </button>
                {openPeerId === conv.peerId && (
                  <div className="border-t border-slate-100 dark:border-slate-800">
                    <div className="max-h-64 overflow-y-auto">
                      {loadingMessages ? (
                        <p className="text-sm text-slate-400 p-4 text-center">{t('loading')}</p>
                      ) : (
                        peerMessages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
                      )}
                    </div>
                    <QuickReply onSend={handleSend} />
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default DirectMessagesPanel;
```

- [ ] **Step 5: Create AnnouncementsPanel**

Create `nkz-module-zulip/src/components/AnnouncementsPanel.tsx`:

```tsx
import React, { useState, useEffect } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { Megaphone, ChevronDown, ChevronUp } from 'lucide-react';
import type { ZulipMessage, ZulipStream } from '../types/zulip';
import { useZulipApi } from '../hooks/useZulipApi';
import MessageBubble from './MessageBubble';

interface Props {
  announcementsStream: ZulipStream | null;
  newMessages: ZulipMessage[];
}

const AnnouncementsPanel: React.FC<Props> = ({ announcementsStream, newMessages }) => {
  const { t } = useTranslation('zulip');
  const { getMessages } = useZulipApi();
  const [messages, setMessages] = useState<ZulipMessage[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!announcementsStream) return;
    (async () => {
      try {
        const data = await getMessages(
          [{ operator: 'stream', operand: announcementsStream.name }],
          5
        );
        setMessages(data.messages);
      } catch {
        // Silent
      }
    })();
  }, [announcementsStream, getMessages]);

  // Append real-time announcements
  useEffect(() => {
    if (newMessages.length === 0) return;
    setMessages((prev) => {
      const ids = new Set(prev.map((m) => m.id));
      const fresh = newMessages.filter((m) => !ids.has(m.id));
      return [...prev, ...fresh];
    });
  }, [newMessages]);

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Megaphone className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            {t('announcements.title')}
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-amber-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-amber-400" />
        )}
      </button>
      {expanded && (
        <div className="max-h-48 overflow-y-auto bg-white dark:bg-slate-900">
          {messages.length === 0 ? (
            <p className="text-sm text-slate-400 p-4 text-center">{t('announcements.empty')}</p>
          ) : (
            messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
          )}
        </div>
      )}
    </div>
  );
};

export default AnnouncementsPanel;
```

- [ ] **Step 6: Commit**

```bash
cd ~/Documents/nekazari/nkz-module-zulip
git add src/components/AlertsPanel.tsx src/components/StreamsPanel.tsx src/components/StreamDetail.tsx src/components/DirectMessagesPanel.tsx src/components/AnnouncementsPanel.tsx
git commit -m "feat: add panel components — Alerts, Streams, DMs, Announcements"
```

### Task 8: CommunicationsHub page root and i18n

**Files:**
- Rewrite: `nkz-module-zulip/src/App.tsx`
- Modify: `nkz-module-zulip/src/locales/es/zulip.json`
- Modify: `nkz-module-zulip/src/locales/en/zulip.json`
- Modify: `nkz-module-zulip/src/locales/ca/zulip.json`
- Modify: `nkz-module-zulip/src/locales/eu/zulip.json`
- Modify: `nkz-module-zulip/src/locales/fr/zulip.json`
- Modify: `nkz-module-zulip/src/locales/pt/zulip.json`

- [ ] **Step 1: Rewrite App.tsx as CommunicationsHub**

Replace `nkz-module-zulip/src/App.tsx` with:

```tsx
import './i18n';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { ExternalLink, MessageCircle } from 'lucide-react';
import type { ZulipStream, ZulipMessage, ZulipUnreadCount, ZulipEvent, ZulipEventQueueResponse } from './types/zulip';
import { useZulipApi } from './hooks/useZulipApi';
import { useZulipEvents } from './hooks/useZulipEvents';
import ConnectionStatus from './components/ConnectionStatus';
import AlertsPanel from './components/AlertsPanel';
import StreamsPanel from './components/StreamsPanel';
import DirectMessagesPanel from './components/DirectMessagesPanel';
import AnnouncementsPanel from './components/AnnouncementsPanel';

const CommunicationsHub: React.FC = () => {
  const { t } = useTranslation('zulip');
  const { getStreams } = useZulipApi();

  const [streams, setStreams] = useState<ZulipStream[]>([]);
  const [unreads, setUnreads] = useState<ZulipUnreadCount[]>([]);
  const [dmUnreads, setDmUnreads] = useState<{ sender_id: number; unread_message_ids: number[] }[]>([]);
  const [newMessages, setNewMessages] = useState<ZulipMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const newMsgRef = useRef<ZulipMessage[]>([]);

  // Load streams on mount
  useEffect(() => {
    (async () => {
      try {
        const data = await getStreams();
        setStreams(data.streams);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
        setLoading(false);
      }
    })();
  }, [getStreams]);

  // Handle initial state from event queue registration
  const onInitialState = useCallback((state: ZulipEventQueueResponse) => {
    setUnreads(state.unread_msgs.streams);
    setDmUnreads(state.unread_msgs.pms);
  }, []);

  // Handle real-time events
  const onEvent = useCallback((event: ZulipEvent) => {
    if (event.type === 'message' && event.message) {
      const msg = event.message;
      newMsgRef.current = [...newMsgRef.current, msg];
      setNewMessages([...newMsgRef.current]);
    }
  }, []);

  const { connectionState } = useZulipEvents({
    onEvent,
    onInitialState,
    enabled: !loading && !error,
  });

  // Find special streams
  const alertsStream = streams.find((s) => s.name.endsWith('-alerts')) || null;
  const announcementsStream = streams.find((s) => s.name === 'platform-announcements') || null;

  // Filter new messages by type
  const alertMessages = newMessages.filter(
    (m) => m.type === 'stream' && alertsStream && m.stream_id === alertsStream.stream_id
  );
  const announcementMessages = newMessages.filter(
    (m) => m.type === 'stream' && announcementsStream && m.stream_id === announcementsStream.stream_id
  );
  const streamMessages = newMessages.filter(
    (m) =>
      m.type === 'stream' &&
      (!alertsStream || m.stream_id !== alertsStream.stream_id) &&
      (!announcementsStream || m.stream_id !== announcementsStream.stream_id)
  );
  const dmMessages = newMessages.filter((m) => m.type === 'private');

  const zulipUrl = window.__ENV__?.VITE_ZULIP_URL || '';

  if (loading) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-slate-50 dark:bg-slate-900">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('loading')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-slate-50 dark:bg-slate-900">
        <div className="text-center p-8">
          <MessageCircle className="w-12 h-12 mx-auto mb-4 text-slate-400" />
          <p className="text-slate-600 dark:text-slate-400 mb-2">{t('connectionError')}</p>
          <p className="text-sm text-slate-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full bg-slate-50 dark:bg-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="flex items-center gap-3">
          <MessageCircle className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <h1 className="text-base font-semibold text-slate-800 dark:text-slate-100">
            {t('title')}
          </h1>
          <ConnectionStatus state={connectionState} />
        </div>
        {zulipUrl && (
          <a
            href={zulipUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium px-3 py-1.5 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
          >
            {t('hub.openFull')}
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {/* Panels */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <AlertsPanel alertsStream={alertsStream} newMessages={alertMessages} />
        <StreamsPanel streams={streams} unreads={unreads} newMessages={streamMessages} />
        <DirectMessagesPanel dmUnreads={dmUnreads} newMessages={dmMessages} />
        <AnnouncementsPanel announcementsStream={announcementsStream} newMessages={announcementMessages} />

        {/* Footer */}
        <p className="text-center text-xs text-slate-400 dark:text-slate-500 py-2">
          {t('poweredBy')}
        </p>
      </div>
    </div>
  );
};

export default CommunicationsHub;
```

- [ ] **Step 2: Update moduleEntry.ts import**

In `nkz-module-zulip/src/moduleEntry.ts`, update the import name (the default export name changed but the import path is the same, so no change needed — `import ZulipEmbed from './App'` still imports the default export `CommunicationsHub`). Actually, rename for clarity:

Replace `nkz-module-zulip/src/moduleEntry.ts` with:

```typescript
import './i18n';
import CommunicationsHub from './App';
import pkg from '../package.json';

const MODULE_ID = 'zulip';

if (typeof window !== 'undefined' && window.__NKZ__) {
  window.__NKZ__.register({
    id: MODULE_ID,
    main: CommunicationsHub,
    version: pkg.version,
  });
}
```

- [ ] **Step 3: Update Spanish locale**

Replace `nkz-module-zulip/src/locales/es/zulip.json` with:

```json
{
  "title": "Comunicaciones",
  "loading": "Cargando...",
  "connectionError": "No se pudo conectar con el servidor de comunicaciones",
  "retry": "Reintentar",
  "noMessages": "No hay mensajes aún",
  "poweredBy": "Powered by Zulip",
  "hub.connected": "Conectado",
  "hub.reconnecting": "Reconectando...",
  "hub.disconnected": "Desconectado",
  "hub.openFull": "Abrir Zulip",
  "hub.openInZulip": "Abrir en Zulip",
  "alerts.title": "Alertas IoT",
  "alerts.empty": "Sin alertas activas",
  "streams.title": "Canales del equipo",
  "streams.empty": "No hay canales disponibles",
  "dm.title": "Mensajes directos",
  "dm.empty": "Sin conversaciones",
  "announcements.title": "Anuncios de plataforma",
  "announcements.empty": "Sin anuncios recientes",
  "quickReply.placeholder": "Escribe un mensaje...",
  "quickReply.send": "Enviar"
}
```

- [ ] **Step 4: Update English locale**

Replace `nkz-module-zulip/src/locales/en/zulip.json` with:

```json
{
  "title": "Communications",
  "loading": "Loading...",
  "connectionError": "Could not connect to communications server",
  "retry": "Retry",
  "noMessages": "No messages yet",
  "poweredBy": "Powered by Zulip",
  "hub.connected": "Connected",
  "hub.reconnecting": "Reconnecting...",
  "hub.disconnected": "Disconnected",
  "hub.openFull": "Open Zulip",
  "hub.openInZulip": "Open in Zulip",
  "alerts.title": "IoT Alerts",
  "alerts.empty": "No active alerts",
  "streams.title": "Team channels",
  "streams.empty": "No channels available",
  "dm.title": "Direct messages",
  "dm.empty": "No conversations",
  "announcements.title": "Platform announcements",
  "announcements.empty": "No recent announcements",
  "quickReply.placeholder": "Type a message...",
  "quickReply.send": "Send"
}
```

- [ ] **Step 5: Update remaining locales (ca, eu, fr, pt)**

Copy the English locale as base for `ca`, `eu`, `fr`, `pt` (each file gets the same keys with English values as fallback):

For each of `ca/zulip.json`, `eu/zulip.json`, `fr/zulip.json`, `pt/zulip.json`, replace with the same content as `en/zulip.json`.

- [ ] **Step 6: Commit**

```bash
cd ~/Documents/nekazari/nkz-module-zulip
git add src/App.tsx src/moduleEntry.ts src/locales/
git commit -m "feat: implement CommunicationsHub with all panels and i18n"
```

---

## Phase 5: Build and Deploy

### Task 9: Build and upload IIFE bundle

- [ ] **Step 1: Install dependencies and build**

```bash
cd ~/Documents/nekazari/nkz-module-zulip
npm install
npm run build:module
```

Expected: `dist/nekazari-module.js` generated (IIFE bundle).

- [ ] **Step 2: Verify build output**

```bash
ls -la dist/nekazari-module.js
# Should be a single JS file, roughly 15-30 kB
```

- [ ] **Step 3: Upload to MinIO**

```bash
mc cp dist/nekazari-module.js minio/nekazari-frontend/modules/zulip/nkz-module.js
```

Note: MinIO alias `minio` must be configured. If not:
```bash
mc alias set minio https://minio.robotika.cloud <access-key> <secret-key>
```

- [ ] **Step 4: Verify upload**

```bash
mc ls minio/nekazari-frontend/modules/zulip/
# Should show nkz-module.js
```

### Task 10: Build and push provisioner Docker image

- [ ] **Step 1: Build Docker image**

```bash
cd ~/Documents/nekazari/nkz-module-zulip
docker build -t ghcr.io/nkz-os/nkz-module-zulip/provisioner:latest backend/
```

- [ ] **Step 2: Push to GHCR**

```bash
docker push ghcr.io/nkz-os/nkz-module-zulip/provisioner:latest
```

- [ ] **Step 3: Verify package is public on GHCR**

Go to `https://github.com/orgs/nkz-os/packages` → find `nkz-module-zulip/provisioner` → Settings → Change visibility → Public.

- [ ] **Step 4: Scale up provisioner**

Update `k8s/provisioner-deployment.yaml`: change `replicas: 0` to `replicas: 1`, remove the "Image not built yet" comment.

```bash
cd ~/Documents/nekazari/nkz-module-zulip
git add k8s/provisioner-deployment.yaml
git commit -m "ops: scale up provisioner to 1 replica"
```

### Task 11: Deploy api-gateway changes

- [ ] **Step 1: Rebuild and deploy api-gateway**

On the server:

```bash
cd ~/nkz
sudo docker build --network=host --no-cache -t ghcr.io/nkz-os/nkz/api-gateway:latest services/api-gateway/
sudo docker save ghcr.io/nkz-os/nkz/api-gateway:latest | sudo k3s ctr images import -
sudo kubectl apply -f k8s/core/services/api-gateway-deployment.yaml
sudo kubectl rollout restart deployment/api-gateway -n nekazari
sudo kubectl rollout status deployment/api-gateway -n nekazari --timeout=120s
```

- [ ] **Step 2: Run DB migration**

```bash
sudo kubectl exec -it deployment/postgresql -n nekazari -- psql -U postgres -d nekazari -f - < config/timescaledb/migrations/065_communications_config.sql
```

- [ ] **Step 3: Verify proxy routes**

```bash
# Test from within the cluster (use a pod with curl)
curl -s http://api-gateway-service:5000/api/zulip/streams
# Should return 401 (no auth) — not 404 (route not found)
```

---

## Phase 6: Platform Admin Panel (Future)

> This phase depends on all previous phases being deployed and validated.
> It will be planned in a separate implementation plan after the hub is functional.

The Platform Admin panel (bot management, announcements, templates, stream config) should be implemented as a section within the existing host admin UI at `nkz/apps/host`. This is a separate implementation plan because:
- It requires changes to the host app (different repo, different build process)
- It should be validated after the core hub is working
- It can be iterated on independently

---

## Verification Checklist

After all phases are deployed:

- [ ] User logs into NKZ → navigates to `/communications` → sees the hub with panels
- [ ] Alerts panel shows messages from `#tenant-{id}-alerts`
- [ ] Streams panel shows only tenant streams (not other tenants')
- [ ] Quick-reply sends a message attributed to the logged-in user
- [ ] DMs panel shows direct messages
- [ ] Announcements panel shows `#platform-announcements` messages
- [ ] Connection status indicator shows "Connected"
- [ ] "Open Zulip" button opens `messaging.robotika.cloud` in new tab
- [ ] Hub works on 350px viewport (mobile)
- [ ] No cross-tenant data leakage (test with two different tenant users)
