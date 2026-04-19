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

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------

    @app.route("/health")
    @limiter.exempt
    def health():
        return jsonify({"status": "healthy"}), 200

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
    def provision_tenant():
        """Create private streams for a new tenant.

        Body: {"tenant_id": "farm-acme", "tenant_name": "Acme Farms"}
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
    def deprovision_tenant(tenant_id: str):
        """Archive all streams belonging to a tenant."""
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
    def subscribe_user(tenant_id: str):
        """Subscribe a user to all tenant streams.

        Body: {"email": "user@example.com"}
        """
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

        return jsonify({
            "email": email,
            "streams_subscribed": subscribed,
            "streams_failed": errors,
        }), 200 if not errors else 207

    @app.route(
        "/api/provisioning/tenant/<tenant_id>/user/<path:email>",
        methods=["DELETE"],
    )
    def unsubscribe_user(tenant_id: str, email: str):
        """Unsubscribe a user from all tenant streams."""
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
    def sync_tenants():
        """Reconcile stream state for a list of tenants.

        Body: {"tenants": [{"tenant_id": "x", "tenant_name": "X"}, ...]}

        Creates any missing streams. Does NOT archive unknown ones
        (that would be destructive without explicit intent).
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

            results.append({
                "tenant_id": tid,
                "created": created,
                "already_existed": skipped,
            })

        return jsonify({"results": results}), 200

    # ------------------------------------------------------------------
    # Announcements
    # ------------------------------------------------------------------

    @app.route("/api/provisioning/announce", methods=["POST"])
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
