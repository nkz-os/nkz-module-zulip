"""Zulip Provisioner — Flask app for tenant stream lifecycle management.

Endpoints:
  GET  /health                                  — K8s probe (limiter exempt)
  GET  /api/provisioning/bot/status             — Bot connectivity check
  POST /api/provisioning/tenant                 — Create streams for tenant
  DELETE /api/provisioning/tenant/<id>          — Archive tenant streams
  POST /api/provisioning/tenant/<id>/user       — Subscribe user to tenant streams
  DELETE /api/provisioning/tenant/<id>/user/<e> — Unsubscribe user
  POST /api/provisioning/sync                   — Reconcile tenant stream state
  POST /api/provisioning/announce               — Post to platform-announcements
"""

import json
import logging
import os
from functools import wraps

import psycopg2
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


def _get_stream_templates():
    """Read stream templates from PostgreSQL, falling back to defaults."""
    try:
        conn = psycopg2.connect(Config.POSTGRES_URL)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT value FROM admin_platform.communications_config "
                    "WHERE key = 'stream_templates'"
                )
                row = cur.fetchone()
                if row:
                    templates = json.loads(row[0])
                    if isinstance(templates, list) and templates:
                        return templates
        finally:
            conn.close()
    except Exception:
        logger.debug("Could not read stream templates from DB, using defaults")
    return Config.DEFAULT_STREAM_TEMPLATES


def _stream_name(tenant_id: str, suffix: str) -> str:
    """Build a canonical stream name for a tenant."""
    return f"tenant-{tenant_id}-{suffix}"


def require_auth(roles=None):
    """Decorator that validates api-gateway injected auth headers.

    Checks presence of X-Tenant-ID and optionally X-User-Roles.
    Does NOT validate JWTs — that's the api-gateway's responsibility.
    """
    if roles is None:
        roles = []

    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            tenant_id = request.headers.get("X-Tenant-ID")
            if not tenant_id:
                return jsonify({"error": "Missing X-Tenant-ID header"}), 401

            if roles:
                user_roles = request.headers.get("X-User-Roles", "")
                user_role_list = [
                    r.strip() for r in user_roles.split(",") if r.strip()
                ]
                if not any(r in user_role_list for r in roles):
                    return jsonify({"error": "Insufficient permissions"}), 403

            return f(*args, **kwargs)

        return wrapper

    return decorator


def validate_tenant_match(body_tenant_id: str) -> bool:
    """Check that the tenant_id in the request body matches the header."""
    header_tenant = request.headers.get("X-Tenant-ID", "")
    return body_tenant_id == header_tenant


def _ensure_global_streams(zulip_client):
    """Create global (cross-tenant) streams if they don't exist.

    These are NOT tenant-prefixed. Fails silently if streams exist.
    """
    global_names = [s["name"] for s in Config.GLOBAL_STREAMS] + [
        "platform-announcements"
    ]
    for name in global_names:
        stream_id = zulip_client.get_stream_id(name)
        if stream_id is not None:
            logger.debug("Global stream #%s already exists (id=%d)", name, stream_id)
            continue
        desc = "Platform-wide announcements"
        if name == "general-forum":
            desc = "Cross-tenant general forum"
        if zulip_client.create_stream(name, desc, invite_only=False):
            logger.info("Created global stream #%s", name)
        else:
            logger.error("Failed to create global stream #%s", name)


def create_app():
    app = Flask(__name__)

    # Rate limiter with Redis fallback to memory
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

    # Ensure global streams exist on startup (idempotent, non-fatal)
    try:
        _ensure_global_streams(zulip)
    except Exception:
        logger.warning(
            "Could not verify global streams on startup (Zulip unreachable?). "
            "Will retry on next /sync or /readyz probe."
        )

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------

    @app.route("/health")
    @limiter.exempt
    def health():
        return jsonify({"status": "healthy"}), 200

    @app.route("/readyz")
    @limiter.exempt
    def readyz():
        """Readiness probe — checks Zulip connectivity."""
        if zulip.health_check():
            return jsonify({"status": "ready"}), 200
        return jsonify({"status": "not ready", "reason": "zulip unreachable"}), 503

    # ------------------------------------------------------------------
    # Bot status
    # ------------------------------------------------------------------

    @app.route("/api/provisioning/bot/status")
    def bot_status():
        ok = zulip.health_check()
        return jsonify({
            "connected": ok,
            "bot_email": Config.ZULIP_BOT_EMAIL or None,
        }), 200 if ok else 503

    # ------------------------------------------------------------------
    # Tenant lifecycle
    # ------------------------------------------------------------------

    @app.route("/api/provisioning/tenant", methods=["POST"])
    @require_auth(roles=["admin"])
    def provision_tenant():
        """Create private streams for a new tenant.

        Body: {"tenant_id": "farm-acme", "tenant_name": "Acme Farms"}
        """
        data = request.get_json()
        if not data:
            return jsonify({"error": "JSON body required"}), 400

        tenant_id = data.get("tenant_id")
        if not validate_tenant_match(tenant_id):
            return jsonify({"error": "tenant_id does not match X-Tenant-ID"}), 403

        tenant_name = data.get("tenant_name")
        if not tenant_id or not tenant_name:
            return jsonify({"error": "tenant_id and tenant_name required"}), 400

        templates = _get_stream_templates()
        created = []
        errors = []

        for tpl in templates:
            name = _stream_name(tenant_id, tpl["suffix"])
            desc = f"[{tenant_name}] {tpl['description']}"
            if zulip.create_stream(name, desc, invite_only=True):
                created.append(name)
            else:
                errors.append(name)

        status_code = 201 if not errors else 207
        return jsonify({
            "status": "provisioned" if not errors else "partial",
            "tenant_id": tenant_id,
            "streams_created": created,
            "streams_failed": errors,
        }), status_code

    @app.route("/api/provisioning/tenant/<tenant_id>", methods=["DELETE"])
    @require_auth(roles=["admin"])
    def deprovision_tenant(tenant_id: str):
        """Archive all streams belonging to a tenant."""
        if not validate_tenant_match(tenant_id):
            return jsonify({"error": "tenant_id does not match X-Tenant-ID"}), 403
        templates = _get_stream_templates()
        archived = []
        errors = []

        for tpl in templates:
            name = _stream_name(tenant_id, tpl["suffix"])
            stream_id = zulip.get_stream_id(name)
            if stream_id is None:
                continue  # stream does not exist, nothing to archive
            if zulip.archive_stream(stream_id):
                archived.append(name)
            else:
                errors.append(name)

        return jsonify({
            "status": "archived" if not errors else "partial",
            "tenant_id": tenant_id,
            "streams_archived": archived,
            "streams_failed": errors,
        }), 200

    # ------------------------------------------------------------------
    # User management
    # ------------------------------------------------------------------

    @app.route("/api/provisioning/tenant/<tenant_id>/user", methods=["POST"])
    @require_auth(roles=["admin"])
    def subscribe_user(tenant_id: str):
        """Subscribe a user to all tenant streams.

        Body: {"email": "user@example.com"}
        """
        if not validate_tenant_match(tenant_id):
            return jsonify({"error": "tenant_id does not match X-Tenant-ID"}), 403

        data = request.get_json()
        if not data or not data.get("email"):
            return jsonify({"error": "email required"}), 400

        email = data["email"]
        templates = _get_stream_templates()
        subscribed = []
        errors = []

        for tpl in templates:
            name = _stream_name(tenant_id, tpl["suffix"])
            if zulip.subscribe_user(email, name):
                subscribed.append(name)
            else:
                errors.append(name)

        # Also subscribe to global forum
        if zulip.subscribe_user(email, "general-forum"):
            subscribed.append("general-forum")
        else:
            errors.append("general-forum")

        return jsonify({
            "email": email,
            "streams_subscribed": subscribed,
            "streams_failed": errors,
        }), 200 if not errors else 207

    @app.route(
        "/api/provisioning/tenant/<tenant_id>/user/<path:email>",
        methods=["DELETE"],
    )
    @require_auth(roles=["admin"])
    def unsubscribe_user(tenant_id: str, email: str):
        """Unsubscribe a user from all tenant streams."""
        if not validate_tenant_match(tenant_id):
            return jsonify({"error": "tenant_id does not match X-Tenant-ID"}), 403
        templates = _get_stream_templates()
        unsubscribed = []
        errors = []

        for tpl in templates:
            name = _stream_name(tenant_id, tpl["suffix"])
            if zulip.unsubscribe_user(email, name):
                unsubscribed.append(name)
            else:
                errors.append(name)

        return jsonify({
            "email": email,
            "streams_unsubscribed": unsubscribed,
            "streams_failed": errors,
        }), 200 if not errors else 207

    # ------------------------------------------------------------------
    # Sync / reconciliation
    # ------------------------------------------------------------------

    @app.route("/api/provisioning/sync", methods=["POST"])
    @require_auth(roles=["admin"])
    def sync_tenants():
        """Reconcile stream state and user subscriptions for tenants.

        Body: {"tenants": [{"tenant_id": "x", "tenant_name": "X"}, ...]}

        Creates missing streams. Subscribes known users to existing
        tenant streams. Does NOT archive unknown streams.
        """
        data = request.get_json()
        if not data or not isinstance(data.get("tenants"), list):
            return jsonify({"error": "tenants list required"}), 400

        templates = _get_stream_templates()
        results = []

        for tenant in data["tenants"]:
            tid = tenant.get("tenant_id")
            tname = tenant.get("tenant_name", tid)
            if not tid:
                continue

            created = []
            skipped = []
            for tpl in templates:
                name = _stream_name(tid, tpl["suffix"])
                stream_id = zulip.get_stream_id(name)
                if stream_id is not None:
                    skipped.append(name)
                    continue
                desc = f"[{tname}] {tpl['description']}"
                if zulip.create_stream(name, desc, invite_only=True):
                    created.append(name)

            # Subscribe known users to tenant streams + global forum
            subscribed = []
            try:
                conn = psycopg2.connect(Config.POSTGRES_URL)
                try:
                    with conn.cursor() as cur:
                        cur.execute(
                            "SELECT email FROM admin_platform.tenant_users "
                            "WHERE tenant_id = %s",
                            (tid,),
                        )
                        emails = [row[0] for row in cur.fetchall()]
                finally:
                    conn.close()

                for email in emails:
                    for tpl in templates:
                        name = _stream_name(tid, tpl["suffix"])
                        zulip.subscribe_user(email, name)
                    zulip.subscribe_user(email, "general-forum")
                    subscribed.append(email)
            except Exception:
                logger.exception("Failed to sync users for tenant %s", tid)

            results.append({
                "tenant_id": tid,
                "created": created,
                "already_existed": skipped,
                "users_synced": len(set(subscribed)),
            })

        return jsonify({"results": results}), 200

    # ------------------------------------------------------------------
    # Announcements
    # ------------------------------------------------------------------

    @app.route("/api/provisioning/announce", methods=["POST"])
    @require_auth(roles=["platform_admin"])
    def announce():
        """Post a message to #platform-announcements.

        Body: {"topic": "Maintenance", "content": "Downtime at 02:00 UTC"}
        """
        data = request.get_json()
        if not data:
            return jsonify({"error": "JSON body required"}), 400

        topic = data.get("topic")
        content = data.get("content")
        if not topic or not content:
            return jsonify({"error": "topic and content required"}), 400

        try:
            result = zulip.post_message(
                stream="platform-announcements",
                topic=topic,
                content=content,
            )
            return jsonify({
                "status": "sent",
                "message_id": result.get("id"),
            }), 200
        except Exception:
            logger.exception("Failed to post announcement")
            return jsonify({"error": "Announcement delivery failed"}), 500

    return app


if __name__ == "__main__":
    create_app().run(host="0.0.0.0", port=5000, debug=True)
