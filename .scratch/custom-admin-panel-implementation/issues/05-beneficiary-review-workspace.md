# 05 — Beneficiary review workspace

**What to build:** Operators can search and review beneficiaries in a domain workspace without exposing payout-sensitive values by default.

**Blocked by:** 02 — Overview and operations search.

**Status:** in-progress

**Implementation note:** Role-filtered beneficiary review is exposed through `/admin/v1/beneficiaries`; deployed workflow evidence remains.

- [ ] Beneficiary search/list/detail use explicit workflow DTOs, approved filters, pagination, and safe errors.
- [ ] Phone and payout-account values, ciphertexts, and blind indexes remain masked or excluded by default.
- [ ] Role capability and not-found/forbidden behavior do not leak restricted beneficiary existence.
- [ ] Exact money values and references are rendered without unsafe numeric conversion.
- [ ] API contract and deployed browser tests cover masked review, pagination, and denied access.
