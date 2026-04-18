"""Zulip Admin API client for realm and stream provisioning."""

import logging

import requests

from config import Config

logger = logging.getLogger(__name__)


class ZulipClient:
    """Manages Zulip realms and streams for tenant provisioning."""

    def __init__(self):
        self.base_url = Config.ZULIP_URL
        self.admin_email = Config.ZULIP_ADMIN_EMAIL
        self.admin_api_key = Config.ZULIP_ADMIN_API_KEY

    @property
    def _auth(self):
        return (self.admin_email, self.admin_api_key)

    def create_realm(self, tenant_id: str, tenant_name: str) -> dict:
        """Create a new Zulip realm (organization) for a tenant.

        Note: Zulip's realm creation via API requires server-level admin.
        In docker-zulip, this is done via manage.py or the API with
        appropriate permissions.
        """
        resp = requests.post(
            f"{self.base_url}/api/v1/realm",
            auth=self._auth,
            json={
                "name": tenant_name,
                "string_id": tenant_id,
            },
            timeout=30,
        )
        resp.raise_for_status()
        result = resp.json()
        logger.info("Created Zulip realm: %s (%s)", tenant_name, tenant_id)
        return result

    def create_default_streams(self, tenant_id: str) -> list:
        """Create the default set of streams for a tenant realm."""
        created = []
        for stream_def in Config.DEFAULT_STREAMS:
            try:
                resp = requests.post(
                    f"{self.base_url}/api/v1/users/me/subscriptions",
                    auth=self._auth,
                    json={
                        "subscriptions": [
                            {
                                "name": stream_def["name"],
                                "description": stream_def["description"],
                            }
                        ],
                    },
                    timeout=15,
                )
                resp.raise_for_status()
                created.append(stream_def["name"])
                logger.info(
                    "Created stream #%s in realm %s",
                    stream_def["name"],
                    tenant_id,
                )
            except requests.RequestException:
                logger.exception(
                    "Failed to create stream #%s in realm %s",
                    stream_def["name"],
                    tenant_id,
                )
        return created

    def post_message(
        self, stream: str, topic: str, content: str, realm: str = None
    ) -> dict:
        """Post a message to a Zulip stream/topic.

        Used by connectors to deliver alerts and notifications.
        """
        payload = {
            "type": "stream",
            "to": stream,
            "topic": topic,
            "content": content,
        }
        resp = requests.post(
            f"{self.base_url}/api/v1/messages",
            auth=self._auth,
            json=payload,
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()

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
