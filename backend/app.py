"""Zulip Provisioner — Flask app for tenant lifecycle management.

Endpoints:
  POST /api/zulip/provision   — Provision Zulip realm + OIDC client for a tenant
  DELETE /api/zulip/provision  — Deprovision a tenant's Zulip realm
  POST /api/zulip/webhook     — Receive messages from FIWARE/n8n connectors
  GET /health                 — Health check (K8s probes)
"""

import logging
import os

from flask import Flask, jsonify, request
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from config import Config
from keycloak_client import KeycloakClient
from zulip_client import ZulipClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


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

    keycloak = KeycloakClient()
    zulip = ZulipClient()

    @app.route("/health")
    @limiter.exempt
    def health():
        zulip_ok = zulip.health_check()
        return jsonify({
            "status": "healthy" if zulip_ok else "degraded",
            "zulip": "up" if zulip_ok else "down",
        }), 200 if zulip_ok else 503

    @app.route("/api/zulip/provision", methods=["POST"])
    def provision_tenant():
        """Provision a Zulip realm and OIDC client for a new tenant.

        Expected JSON body:
        {
            "tenant_id": "farm-acme",
            "tenant_name": "Acme Farms",
            "tier": "basic"  // optional, defaults to "basic"
        }
        """
        data = request.get_json()
        if not data:
            return jsonify({"error": "JSON body required"}), 400

        tenant_id = data.get("tenant_id")
        tenant_name = data.get("tenant_name")
        if not tenant_id or not tenant_name:
            return jsonify({"error": "tenant_id and tenant_name required"}), 400

        try:
            # 1. Create OIDC client in Keycloak
            oidc = keycloak.create_oidc_client(tenant_id)
            logger.info("OIDC client created for tenant %s", tenant_id)

            # 2. Create Zulip realm
            realm = zulip.create_realm(tenant_id, tenant_name)
            logger.info("Zulip realm created for tenant %s", tenant_id)

            # 3. Create default streams
            streams = zulip.create_default_streams(tenant_id)
            logger.info(
                "Created %d default streams for tenant %s",
                len(streams),
                tenant_id,
            )

            return jsonify({
                "status": "provisioned",
                "tenant_id": tenant_id,
                "oidc_client_id": oidc["client_id"],
                "realm": tenant_id,
                "streams": streams,
            }), 201

        except Exception:
            logger.exception("Failed to provision tenant %s", tenant_id)
            return jsonify({"error": "Provisioning failed"}), 500

    @app.route("/api/zulip/provision", methods=["DELETE"])
    def deprovision_tenant():
        """Remove Zulip realm and OIDC client for a tenant.

        Expected JSON body:
        {
            "tenant_id": "farm-acme"
        }
        """
        data = request.get_json()
        if not data or not data.get("tenant_id"):
            return jsonify({"error": "tenant_id required"}), 400

        tenant_id = data["tenant_id"]

        try:
            keycloak.delete_oidc_client(tenant_id)
            # Note: Zulip realm deletion via API may require
            # manage.py or direct DB operation — document in ops playbook
            return jsonify({
                "status": "deprovisioned",
                "tenant_id": tenant_id,
            }), 200
        except Exception:
            logger.exception("Failed to deprovision tenant %s", tenant_id)
            return jsonify({"error": "Deprovisioning failed"}), 500

    @app.route("/api/zulip/webhook", methods=["POST"])
    def receive_webhook():
        """Receive a message from a connector and post to Zulip.

        Expected JSON body:
        {
            "stream": "alertas-riego",
            "topic": "sensor:humidity-01",
            "content": "Humidity dropped below 30%",
            "tenant_id": "farm-acme"
        }
        """
        data = request.get_json()
        if not data:
            return jsonify({"error": "JSON body required"}), 400

        required = ["stream", "topic", "content"]
        missing = [f for f in required if not data.get(f)]
        if missing:
            return jsonify({"error": f"Missing fields: {missing}"}), 400

        try:
            result = zulip.post_message(
                stream=data["stream"],
                topic=data["topic"],
                content=data["content"],
                realm=data.get("tenant_id"),
            )
            return jsonify({"status": "sent", "message_id": result.get("id")}), 200
        except Exception:
            logger.exception("Failed to post webhook message")
            return jsonify({"error": "Message delivery failed"}), 500

    return app


if __name__ == "__main__":
    create_app().run(host="0.0.0.0", port=5000, debug=True)
