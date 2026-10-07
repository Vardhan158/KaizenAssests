# gate — migration notes

**Status:** placeholder, not implemented (source was a Java `package-info.java`
stub with no domain/application/infrastructure code — there was nothing to
migrate).

**Intended scope:** Yard/gate check-in and check-out for inbound and outbound vehicles.

**When you build this out**, follow the exact four-layer shape used by
`receiving`, `returns`, and `notification` next to it:

```
gate/
  domain/            # aggregate(s), value objects, domain events — zero framework imports
  application/        # commands/queries, use cases, repository Protocol (port)
  infrastructure/
    api/               # FastAPI router + Pydantic schemas (inbound adapter)
    persistence/       # SQLAlchemy models + repository implementation (outbound adapter)
```

Register the new router in `app/main.py`, add an Alembic migration for its
tables, and if it raises domain events, write them as outbox rows in the
same transaction as the aggregate own write (see
`receiving/infrastructure/persistence/repository_impl.py` for the pattern)
so they flow through the existing Kafka outbox relay.
