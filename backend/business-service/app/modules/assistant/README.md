# Operations assistant

The assistant is deterministic and read-only. It uses authenticated server roles,
parameterized SQLAlchemy queries and curated workflow explanations. Chat text and
conversation history cannot grant permissions. Unknown roles have no live access.

## Role coverage

| Role (including configured aliases) | Live areas |
| --- | --- |
| Admin | All areas, including administration summary KPIs |
| Warehouse / Manager | Operational areas; no administration KPIs |
| Gate security | Inbound, docks, dispatch |
| GRN / Receiving | Inbound, docks, purchase orders, inventory, putaway |
| Warehouse operator | Shared warehouse inventory, putaway, zones and bins |
| Assembly | Assembly, inventory, locations |
| Dispatch | Dispatch, inventory, inbound, docks |
| Supplier | Own purchase orders and inbound records |
| Procurement | Purchase orders, inventory, inbound |
| Quality | Inventory, inbound, assembly |
| Finance | Purchase orders and inventory |

Existing retriever restrictions still apply when users have multiple roles.
Supplier identity comes from authenticated identity mappings/claims. Operational users
share the configured warehouse; no per-user location ownership is required. The capabilities endpoint and chat use the same
policy. UI links are convenience shortcuts; backend authorization is authoritative.

## Questions and matching

`application/intents.py` centralizes spelling corrections, abbreviations, Unicode
normalization, record prefixes and category patterns. Precise identifiers take
precedence over generic words. Order types are explicit: "open assembly orders"
and "open dispatch orders" do not become purchase-order queries. "Open orders"
asks for clarification.

Examples include `PO-2026-001`, `DSP-001`, `SKU-001`, inventory availability,
production progress, material requisitions, vehicle queues, loading bays,
putaways, zones and bins, FIFO/FEFO, quality holds, ASN creation and damage claims.

Short follow-ups keep the last user topic. New date/status filters replace old
filters; a plain "details" or "status" request retains the previous record query.
System messages in client history are not treated as instructions or identity.

Purchase orders, assembly, dispatch, putaway and inbound support status filters
and date windows. Dates use PO date for purchase orders and creation date for
other records; they are not promised arrival/completion dates. Date windows include
today, yesterday, this/last week, this/last month and last N days. Counts run before
result limits. Inventory supports material codes/names, available and out-of-stock
balances. Stock counts count matching balance records, not summed stock units.

## Explicit limits

Detailed BOM lines, requisitions, RFQs/quotations, GRN reports, batch ageing,
expiry, serial histories, quality-held stock and ledger reports are recognized
but do not silently return unrelated order or stock lists. Chat explains the
limit and relevant workflow. Reorder thresholds are not persisted on the stock
model, so threshold-based low-stock reporting is unavailable. General workflow
explanations cover these areas. No prompt can create, approve, reserve, issue,
release or otherwise change records.

The server exposes authenticated `GET /api/v1/assistant/capabilities` for role
suggestions, and `POST /api/v1/assistant/chat`. History is capped at 50 messages;
the UI sends the most recent 40.

## Validation

From `backend/business-service`, run the isolated rule/SQLite tests without the
root PostgreSQL integration fixture:

```powershell
.venv/Scripts/python.exe -m pytest --confcutdir=tests/unit tests/unit/test_assistant_role_awareness.py tests/unit/test_assistant_coverage.py -q
```

These tests use mocks or disposable SQLite memory databases and never connect to
the application database. Existing Phase 2 integration tests require the dedicated
PostgreSQL test database enforced by `tests/conftest.py`.

From `frontend`:

```powershell
npx.cmd vitest run tests/assembly/assistant-role-policy.test.tsx
```
