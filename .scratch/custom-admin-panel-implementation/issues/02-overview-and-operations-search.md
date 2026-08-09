# 02 — Overview and operations search

**What to build:** Support, Ops, and Admin can use the Overview and Operations areas to understand current queues and find operations through the custom panel.

**Blocked by:** 01 — Authenticated admin shell and `/admin/v1` foundation.

**Status:** in-progress

**Implementation note:** Overview and paginated operations search are wired to the explicit v1 API; deployed parity evidence remains.

- [x] Role-aware overview metrics and queues are rendered through explicit `/admin/v1` workflow read models.
- [x] Operations search supports approved query, status, pagination, filtering, and safe empty/loading/error states.
- [x] Results use the standard list envelope and preserve exact money values as strings.
- [x] Role visibility and server authorization are tested for Support, Ops, and Admin.
- [ ] API contract tests and deployed browser tests cover the primary search journey and denied access.
