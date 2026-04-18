#!/usr/bin/env bash
# =============================================================================
# Keycloak: Create OIDC client for Zulip (idempotent)
# =============================================================================
# Creates a confidential OIDC client "zulip" in the nekazari realm.
# If it already exists, updates the redirect URIs and outputs the secret.
#
# Usage (from inside the cluster, e.g. via kubectl exec on any pod with curl):
#   KEYCLOAK_ADMIN_PASSWORD=<pass> ./keycloak-create-zulip-client.sh
#
# Or from the server:
#   sudo kubectl exec -it deploy/keycloak -n nekazari -- bash -c '
#     KEYCLOAK_ADMIN_PASSWORD="$KEYCLOAK_ADMIN_PASSWORD" bash' <<'SCRIPT'
#     ... paste script contents ...
#   SCRIPT
#
# Environment:
#   KEYCLOAK_URL             (default: http://keycloak-service:8080/auth)
#   KEYCLOAK_REALM           (default: nekazari)
#   KEYCLOAK_ADMIN_USER      (default: admin)
#   KEYCLOAK_ADMIN_PASSWORD  (required)
#   ZULIP_EXTERNAL_HOST      (default: messaging.robotika.cloud)
# =============================================================================

set -euo pipefail

KC_URL="${KEYCLOAK_URL:-http://keycloak-service:8080/auth}"
KC_REALM="${KEYCLOAK_REALM:-nekazari}"
KC_ADMIN="${KEYCLOAK_ADMIN_USER:-admin}"
KC_PASS="${KEYCLOAK_ADMIN_PASSWORD:?KEYCLOAK_ADMIN_PASSWORD is required}"
ZULIP_HOST="${ZULIP_EXTERNAL_HOST:-messaging.robotika.cloud}"

CLIENT_ID="zulip"

echo "==> Obtaining admin token..."
TOKEN=$(curl -sf -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
  --data-urlencode "grant_type=password" \
  --data-urlencode "client_id=admin-cli" \
  --data-urlencode "username=${KC_ADMIN}" \
  --data-urlencode "password=${KC_PASS}" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

if [ -z "$TOKEN" ]; then
  echo "ERROR: Failed to get admin token" >&2
  exit 1
fi
echo "==> Token obtained."

# Check if client already exists
echo "==> Checking if client '${CLIENT_ID}' exists..."
CLIENTS_URL="${KC_URL}/admin/realms/${KC_REALM}/clients"

EXISTING=$(curl -sf -H "Authorization: Bearer ${TOKEN}" \
  "${CLIENTS_URL}?clientId=${CLIENT_ID}" | python3 -c "
import sys, json
clients = json.load(sys.stdin)
print(clients[0]['id'] if clients else '')
")

CLIENT_JSON=$(cat <<CEOF
{
  "clientId": "${CLIENT_ID}",
  "name": "Zulip Communications",
  "description": "OIDC client for Zulip messaging platform",
  "enabled": true,
  "protocol": "openid-connect",
  "publicClient": false,
  "clientAuthenticatorType": "client-secret",
  "standardFlowEnabled": true,
  "directAccessGrantsEnabled": false,
  "serviceAccountsEnabled": false,
  "redirectUris": [
    "https://${ZULIP_HOST}/complete/oidc/"
  ],
  "webOrigins": [
    "https://${ZULIP_HOST}"
  ],
  "attributes": {
    "post.logout.redirect.uris": "https://${ZULIP_HOST}/*"
  },
  "defaultClientScopes": ["openid", "profile", "email"],
  "optionalClientScopes": []
}
CEOF
)

if [ -n "$EXISTING" ]; then
  echo "==> Client '${CLIENT_ID}' exists (internal ID: ${EXISTING}). Updating..."
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X PUT "${CLIENTS_URL}/${EXISTING}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "${CLIENT_JSON}")

  if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
    echo "==> Client updated successfully."
  else
    echo "ERROR: Failed to update client (HTTP ${HTTP_CODE})" >&2
    exit 1
  fi
  INTERNAL_ID="$EXISTING"
else
  echo "==> Creating client '${CLIENT_ID}'..."
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "${CLIENTS_URL}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "${CLIENT_JSON}")

  if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
    echo "==> Client created successfully."
  else
    echo "ERROR: Failed to create client (HTTP ${HTTP_CODE})" >&2
    exit 1
  fi

  INTERNAL_ID=$(curl -sf -H "Authorization: Bearer ${TOKEN}" \
    "${CLIENTS_URL}?clientId=${CLIENT_ID}" | python3 -c "
import sys, json
print(json.load(sys.stdin)[0]['id'])
")
fi

# Add tenant_id mapper to include tenant info in tokens
echo "==> Adding tenant_id protocol mapper..."
MAPPER_JSON=$(cat <<MEOF
{
  "name": "tenant_id",
  "protocol": "openid-connect",
  "protocolMapper": "oidc-usermodel-attribute-mapper",
  "config": {
    "user.attribute": "tenant_id",
    "claim.name": "tenant_id",
    "id.token.claim": "true",
    "access.token.claim": "true",
    "userinfo.token.claim": "true",
    "jsonType.label": "String"
  }
}
MEOF
)

MAPPER_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${CLIENTS_URL}/${INTERNAL_ID}/protocol-mappers/models" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "${MAPPER_JSON}")

if [ "$MAPPER_CODE" = "201" ]; then
  echo "==> tenant_id mapper created."
elif [ "$MAPPER_CODE" = "409" ]; then
  echo "==> tenant_id mapper already exists (OK)."
else
  echo "WARN: tenant_id mapper returned HTTP ${MAPPER_CODE} (may already exist)."
fi

# Retrieve and display the client secret
echo ""
echo "==> Retrieving client secret..."
SECRET=$(curl -sf -H "Authorization: Bearer ${TOKEN}" \
  "${CLIENTS_URL}/${INTERNAL_ID}/client-secret" | python3 -c "
import sys, json
print(json.load(sys.stdin)['value'])
")

echo "================================================================"
echo " Client ID:     ${CLIENT_ID}"
echo " Client Secret: ${SECRET}"
echo "================================================================"
echo ""
echo "Next steps:"
echo "  1. Add the secret to the zulip-secret K8s Secret:"
echo "     sudo kubectl patch secret zulip-secret -n nekazari --type merge \\"
echo "       -p '{\"data\":{\"oidc-client-secret\":\"'"\$(echo -n '${SECRET}' | base64)"'\"}}'"
echo ""
echo "  2. Redeploy Zulip to pick up the OIDC config:"
echo "     sudo kubectl apply -f k8s/zulip-deployment.yaml"
echo "     sudo kubectl rollout restart deployment/zulip -n nekazari"
echo ""
echo "  3. Test: open https://${ZULIP_HOST} and click 'Log in with Nekazari SSO'"
