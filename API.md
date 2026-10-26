# ColdReach Public API

The public API lets external tools (Zapier, Make, your own scripts)
read and write leads, manage suppressions, and pull campaign stats
for one workspace. It is versioned under `/api/v1` and authenticated
with workspace API keys. Everything is tenant scoped: a key only ever
sees its own workspace's data.

## Authentication

Create keys in the app under **Integrations, Public API keys** (ADMIN
role or above). A key looks like this:

```
cr_x7f9... (43 characters, shown exactly once at creation)
```

Only a SHA-256 hash of the key is stored; if you lose the full key,
revoke it and create a new one. Send it on every request:

```
Authorization: Bearer cr_<your key>
```

A missing or unknown key returns `401`. A revoked key returns `401`.
A valid key without the scope an endpoint needs returns `403`.

## Scopes

| Scope | Grants |
| --- | --- |
| `leads:read` | List and read leads |
| `leads:write` | Create leads |
| `suppressions:write` | Create suppressions |
| `stats:read` | Read campaign statistics |

## Rate limit

Each key may make **120 requests per minute**. The limiter is a
simple in-memory fixed window per key, held per running instance:
on a multi-instance deployment each instance enforces its own window,
so the effective ceiling can be a multiple of 120 per minute. Treat
429 responses as authoritative: the response carries a `Retry-After`
header (seconds) and a JSON body with `retryAfterSeconds`.

## Endpoints

### GET /api/v1/leads

List leads in the key's workspace, newest first.

Query parameters: `listId` (optional), `page` (default 1), `pageSize`
(default 50, maximum 200).

```bash
curl "https://your-deployment.example/api/v1/leads?listId=LIST_ID&page=1" \
  -H "Authorization: Bearer cr_..."
```

Response `200`:

```json
{
  "leads": [
    {
      "id": "lead_id",
      "listId": "list_id",
      "email": "ada@example.com",
      "fields": { "firstName": "Ada", "company": "Analytical Engines" },
      "tags": ["imported"],
      "status": "NEW",
      "createdAt": "2026-10-26T12:00:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 50
}
```

### POST /api/v1/leads

Create a lead. Creation reuses the same service as the in-app add:
the address is validated and normalised, and duplicates within the
workspace are refused. One deliberate difference: the in-app form
creates a suppressed address as a lead flagged SUPPRESSED, while the
public API refuses it with `422`, because an API caller should get an
explicit refusal rather than a silently flagged row.

```bash
curl -X POST "https://your-deployment.example/api/v1/leads" \
  -H "Authorization: Bearer cr_..." \
  -H "Content-Type: application/json" \
  -d '{"email":"ada@example.com","listId":"LIST_ID","fields":{"firstName":"Ada"}}'
```

Response `201`: `{ "lead": { ... } }`.

Errors: `400` invalid JSON or invalid email, `404` the list does not
exist in this workspace, `409` a lead with this email already exists
in the workspace, `422` the address is on the suppression list.

### POST /api/v1/suppressions

Add an address (or a whole domain, as `example.com`) to the
workspace suppression list. Idempotent: suppressing an already
suppressed address returns success with `"created": false`.

```bash
curl -X POST "https://your-deployment.example/api/v1/suppressions" \
  -H "Authorization: Bearer cr_..." \
  -H "Content-Type: application/json" \
  -d '{"email":"ada@example.com","reason":"Asked not to be contacted"}'
```

Response `201`: `{ "suppression": { "id": "...", "pattern": "ada@example.com", "scope": "WORKSPACE", "reason": "..." }, "created": true }`.

### GET /api/v1/campaigns/:id/stats

Campaign statistics from the same metrics engine as the in-app
analytics, including the A/B variant breakdown and the declared
winner when the statistics support one (see ARCHITECTURE.md).

```bash
curl "https://your-deployment.example/api/v1/campaigns/CAMPAIGN_ID/stats" \
  -H "Authorization: Bearer cr_..."
```

Response `200`:

```json
{
  "campaignId": "campaign_id",
  "metrics": {
    "sent": 120, "delivered": 120, "replied": 39, "bounced": 0,
    "unsubscribed": 0, "complained": 0, "failed": 0,
    "opened": 0, "opensTracked": false,
    "deliveryRate": 1, "replyRate": 0.325, "bounceRate": 0,
    "unsubscribeRate": 0, "complaintRate": 0
  },
  "variants": [
    { "label": "A", "sent": 52, "delivered": 52, "replied": 5, "bounced": 0, "replyRate": 0.096 },
    { "label": "B", "sent": 68, "delivered": 68, "replied": 34, "bounced": 0, "replyRate": 0.5 }
  ],
  "winner": { "label": "B", "pValue": 0.0004 },
  "minWinnerSample": 30
}
```

A campaign that belongs to another workspace returns `404`, never
its data.

## Error shape

Every error is JSON: `{ "error": "human readable message" }`, plus
endpoint-specific fields (`missingEnv` on not-configured responses
from the session API, `retryAfterSeconds` on `429`). Status codes:
`400` invalid input, `401` missing, invalid, or revoked key, `403`
missing scope, `404` not found in this workspace, `409` conflict,
`422` refused by a business rule, `429` rate limited, `501` the
feature is not configured on this deployment.

## Outbound webhooks

ColdReach can also push events to you. Configure endpoints under
**Integrations, Outbound webhooks**: when a provider event is applied
(DELIVERED, REPLIED, BOUNCED, UNSUBSCRIBED, COMPLAINED), each
subscribed endpoint receives a POST with the event payload, signed
with HMAC-SHA256 in the `X-ColdReach-Signature` header (hex digest of
the raw body, keyed by the endpoint secret shown once at creation).
Verify the signature before trusting a delivery. Failed deliveries
retry after 1 minute, 5 minutes, 30 minutes, and 2 hours, then stop
at 5 attempts; the delivery log is on the same settings page.
INTEGRATIONS.md has Zapier and Make recipes built on this.
