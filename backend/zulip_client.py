"""Zulip API client for tenant stream provisioning."""

import json
import logging
from typing import Optional

import requests

from config import Config

logger = logging.getLogger(__name__)


class ZulipClient:
    """Manages streams and users in a single Zulip organization."""

    def __init__(self):
        self.base_url = Config.ZULIP_URL
        self.bot_email = Config.ZULIP_BOT_EMAIL
        self.bot_api_key = Config.ZULIP_BOT_API_KEY
        self._session = requests.Session()
        self._session.auth = (self.bot_email, self.bot_api_key)
        self._session.headers["Host"] = Config.ZULIP_HOST

    @property
    def _auth(self):
        return (self.bot_email, self.bot_api_key)

    def health_check(self) -> bool:
        """Check if Zulip server is reachable."""
        try:
            resp = self._session.get(
                f"{self.base_url}/api/v1/server_settings",
                timeout=5,
            )
            return resp.status_code == 200
        except requests.RequestException:
            return False

    def create_stream(
        self, name: str, description: str, invite_only: bool = True
    ) -> bool:
        """Create a stream by subscribing the bot to it.

        Zulip creates streams implicitly when a user subscribes to a
        non-existent stream name.  Uses form-encoded data (not JSON).
        """
        subscriptions = json.dumps(
            [{"name": name, "description": description}]
        )
        resp = self._session.post(
            f"{self.base_url}/api/v1/users/me/subscriptions",
            data={
                "subscriptions": subscriptions,
                "invite_only": json.dumps(invite_only),
            },
            timeout=15,
        )
        if resp.status_code == 200:
            logger.info("Created stream #%s", name)
            return True
        logger.error(
            "Failed to create stream #%s: %s %s",
            name,
            resp.status_code,
            resp.text,
        )
        return False

    def get_stream_id(self, name: str) -> Optional[int]:
        """Get the numeric ID of a stream by name."""
        resp = self._session.get(
            f"{self.base_url}/api/v1/get_stream_id",
            params={"stream": name},
            timeout=10,
        )
        if resp.status_code == 200:
            return resp.json().get("stream_id")
        return None

    def subscribe_user(self, user_email: str, stream_name: str) -> bool:
        """Subscribe a user to a stream (form-encoded)."""
        subscriptions = json.dumps([{"name": stream_name}])
        resp = self._session.post(
            f"{self.base_url}/api/v1/users/me/subscriptions",
            data={
                "subscriptions": subscriptions,
                "principals": json.dumps([user_email]),
            },
            timeout=15,
        )
        if resp.status_code == 200:
            logger.info("Subscribed %s to #%s", user_email, stream_name)
            return True
        logger.error(
            "Failed to subscribe %s to #%s: %s %s",
            user_email,
            stream_name,
            resp.status_code,
            resp.text,
        )
        return False

    def unsubscribe_user(self, user_email: str, stream_name: str) -> bool:
        """Remove a user from a stream (form-encoded)."""
        resp = self._session.delete(
            f"{self.base_url}/api/v1/users/me/subscriptions",
            data={
                "subscriptions": json.dumps([stream_name]),
                "principals": json.dumps([user_email]),
            },
            timeout=15,
        )
        if resp.status_code == 200:
            logger.info("Unsubscribed %s from #%s", user_email, stream_name)
            return True
        logger.error(
            "Failed to unsubscribe %s from #%s: %s %s",
            user_email,
            stream_name,
            resp.status_code,
            resp.text,
        )
        return False

    def archive_stream(self, stream_id: int) -> bool:
        """Archive (deactivate) a stream by its numeric ID."""
        resp = self._session.delete(
            f"{self.base_url}/api/v1/streams/{stream_id}",
            timeout=10,
        )
        if resp.status_code == 200:
            logger.info("Archived stream id=%d", stream_id)
            return True
        logger.error(
            "Failed to archive stream id=%d: %s %s",
            stream_id,
            resp.status_code,
            resp.text,
        )
        return False

    def post_message(self, stream: str, topic: str, content: str) -> dict:
        """Post a message to a Zulip stream/topic."""
        resp = self._session.post(
            f"{self.base_url}/api/v1/messages",
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
        """Look up a Zulip user by email address."""
        resp = self._session.get(
            f"{self.base_url}/api/v1/users/{email}",
            timeout=10,
        )
        if resp.status_code == 200:
            return resp.json().get("user")
        return None
