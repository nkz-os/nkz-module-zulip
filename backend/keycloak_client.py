"""Keycloak Admin REST API client for OIDC client provisioning."""

import logging

import requests

from config import Config

logger = logging.getLogger(__name__)


class KeycloakClient:
    """Manages OIDC clients in Keycloak for Zulip realm provisioning."""

    def __init__(self):
        self.base_url = Config.KEYCLOAK_URL
        self.realm = Config.KEYCLOAK_REALM
        self.external_host = Config.ZULIP_EXTERNAL_HOST

    def _get_admin_token(self) -> str:
        """Get admin token via password grant + admin-cli (NKZ convention)."""
        resp = requests.post(
            f"{self.base_url}/realms/master/protocol/openid-connect/token",
            data={
                "grant_type": "password",
                "client_id": "admin-cli",
                "username": Config.KEYCLOAK_ADMIN_USER,
                "password": Config.KEYCLOAK_ADMIN_PASSWORD,
            },
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()["access_token"]

    def create_oidc_client(self, tenant_id: str) -> dict:
        """Create an OIDC client in Keycloak for a tenant's Zulip realm.

        Returns dict with client_id and client_secret.
        """
        token = self._get_admin_token()
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

        client_id = f"zulip-{tenant_id}"
        redirect_base = f"https://{self.external_host}"

        payload = {
            "clientId": client_id,
            "protocol": "openid-connect",
            "publicClient": False,
            "redirectUris": [f"{redirect_base}/complete/oidc/*"],
            "webOrigins": [redirect_base],
            "standardFlowEnabled": True,
            "directAccessGrantsEnabled": False,
            "attributes": {
                "post.logout.redirect.uris": f"{redirect_base}/*",
            },
            "protocolMappers": [
                {
                    "name": "tenant_id",
                    "protocol": "openid-connect",
                    "protocolMapper": "oidc-usermodel-attribute-mapper",
                    "config": {
                        "user.attribute": "tenant_id",
                        "claim.name": "tenant_id",
                        "id.token.claim": "true",
                        "access.token.claim": "true",
                        "jsonType.label": "String",
                    },
                }
            ],
        }

        # Create client
        resp = requests.post(
            f"{self.base_url}/admin/realms/{self.realm}/clients",
            headers=headers,
            json=payload,
            timeout=15,
        )
        resp.raise_for_status()
        logger.info("Created Keycloak OIDC client: %s", client_id)

        # Retrieve client UUID and secret
        resp = requests.get(
            f"{self.base_url}/admin/realms/{self.realm}/clients",
            headers=headers,
            params={"clientId": client_id},
            timeout=10,
        )
        resp.raise_for_status()
        clients = resp.json()
        if not clients:
            raise RuntimeError(f"Client {client_id} not found after creation")

        client_uuid = clients[0]["id"]

        resp = requests.get(
            f"{self.base_url}/admin/realms/{self.realm}/clients/{client_uuid}/client-secret",
            headers=headers,
            timeout=10,
        )
        resp.raise_for_status()
        secret = resp.json()["value"]

        return {"client_id": client_id, "client_secret": secret}

    def delete_oidc_client(self, tenant_id: str) -> bool:
        """Delete the OIDC client for a tenant. Returns True if deleted."""
        token = self._get_admin_token()
        headers = {"Authorization": f"Bearer {token}"}

        client_id = f"zulip-{tenant_id}"
        resp = requests.get(
            f"{self.base_url}/admin/realms/{self.realm}/clients",
            headers=headers,
            params={"clientId": client_id},
            timeout=10,
        )
        resp.raise_for_status()
        clients = resp.json()
        if not clients:
            logger.warning("OIDC client %s not found for deletion", client_id)
            return False

        client_uuid = clients[0]["id"]
        resp = requests.delete(
            f"{self.base_url}/admin/realms/{self.realm}/clients/{client_uuid}",
            headers=headers,
            timeout=10,
        )
        resp.raise_for_status()
        logger.info("Deleted Keycloak OIDC client: %s", client_id)
        return True
