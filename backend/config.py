import os


class Config:
    ZULIP_URL = os.environ.get("ZULIP_URL", "http://zulip-service")
    ZULIP_BOT_EMAIL = os.environ.get("ZULIP_BOT_EMAIL", "")
    ZULIP_BOT_API_KEY = os.environ.get("ZULIP_BOT_API_KEY", "")
    POSTGRES_URL = os.environ.get(
        "POSTGRES_URL",
        "postgresql://zulip_provisioner:@postgresql-service:5432/nekazari",
    )
    DEFAULT_STREAM_TEMPLATES = [
        {"suffix": "general", "description": "Open team communication"},
        {"suffix": "alerts", "description": "Automated IoT and risk alerts"},
    ]
