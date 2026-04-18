-- =============================================================================
-- Zulip Module Registration (marketplace_modules)
-- =============================================================================
-- Run against the main platform database (TimescaleDB, same as entity-manager).
-- This is a copy of nkz/config/timescaledb/migrations/064_register_zulip_module.sql
-- kept here for reference.
-- =============================================================================

INSERT INTO marketplace_modules (
    id, name, display_name, description,
    is_local, remote_entry_url, scope, exposed_module,
    route_path, label, version, author, category,
    module_type, required_plan_type, pricing_tier,
    is_active, required_roles, metadata
) VALUES (
    'zulip',
    'nkz-module-zulip',
    'Comunicaciones',
    'Sovereign messaging platform with IoT alert integration for team collaboration. Stream/topic model, webhooks, and full-text search.',
    false,
    '/modules/zulip/nkz-module.js',
    'zulip', './App',
    '/communications',
    'Comunicaciones',
    '0.1.0',
    'nkz-os',
    'communications',
    'ADDON_FREE',
    'basic',
    'FREE',
    true,
    ARRAY['Farmer', 'TenantAdmin', 'TechnicalConsultant', 'PlatformAdmin', 'DeviceManager'],
    '{
        "icon": "message-circle",
        "color": "#6366F1",
        "shortDescription": "Team messaging and IoT alerts",
        "features": ["Stream/topic messaging", "Webhook integrations", "Full-text search", "IoT alert channels"],
        "backend_service": "zulip",
        "externalUrl": "https://messaging.robotika.cloud"
    }'::jsonb
) ON CONFLICT (id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    is_local = EXCLUDED.is_local,
    remote_entry_url = EXCLUDED.remote_entry_url,
    route_path = EXCLUDED.route_path,
    label = EXCLUDED.label,
    module_type = EXCLUDED.module_type,
    pricing_tier = EXCLUDED.pricing_tier,
    metadata = EXCLUDED.metadata,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();
