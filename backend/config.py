import os


class Config:
    # Keycloak (admin operations)
    KEYCLOAK_URL = os.environ.get(
        "KEYCLOAK_URL", "http://keycloak-service:8080/auth"
    )
    KEYCLOAK_REALM = os.environ.get("KEYCLOAK_REALM", "nekazari")
    KEYCLOAK_ADMIN_USER = os.environ.get("KEYCLOAK_ADMIN_USER", "admin")
    KEYCLOAK_ADMIN_PASSWORD = os.environ.get("KEYCLOAK_ADMIN_PASSWORD", "")

    # Zulip (admin operations)
    ZULIP_URL = os.environ.get("ZULIP_URL", "http://zulip-service")
    ZULIP_ADMIN_EMAIL = os.environ.get("ZULIP_ADMIN_EMAIL", "admin@robotika.cloud")
    ZULIP_ADMIN_API_KEY = os.environ.get("ZULIP_ADMIN_API_KEY", "")

    # External host (for OIDC redirect URIs)
    ZULIP_EXTERNAL_HOST = os.environ.get("ZULIP_EXTERNAL_HOST", "messaging.robotika.cloud")

    # Default streams to create per tenant
    DEFAULT_STREAMS = [
        {"name": "general", "description": "Open communication"},
        {"name": "alertas-riego", "description": "IoT/FIWARE humidity & valve alerts"},
        {"name": "maquinaria", "description": "ISOBUS & fleet telemetry"},
        {"name": "cep-agronomico", "description": "Agronomic risk engine rules"},
        {"name": "workflows-n8n", "description": "n8n workflow events"},
        {"name": "operativa", "description": "Shifts, incidents, human discussion"},
    ]
