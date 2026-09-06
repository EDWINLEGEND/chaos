# Engineering Rules & Guidelines for Chaos

This document outlines the core engineering standards and conventions for the `Chaos` repository. All contributors and AI agents working on this codebase must adhere to these rules.

---

### 1. TypeScript Strict Mode
Always maintain strict TypeScript settings across the entire codebase. Do not use `any`, `@ts-ignore`, or silent type suppressions. Model domain data with precise, explicit types and interfaces.

### 2. Package Manager
Use `pnpm` exclusively for managing dependencies and running monorepo workspace commands (`pnpm --filter`, `pnpm -r`). Never invoke `npm` or `yarn` directly or commit extraneous lockfiles.

### 3. Keep Handlers Small and Focused
HTTP route handlers, webhook listeners, and event handlers must remain small, modular, and single-purpose. Separate parsing, business logic, persistence, and response formatting into distinct helper functions.

### 4. Centralized Environment Configuration
All service ports, URLs, database connection strings, and runtime flags must be read from environment variables and parsed via centralized, validated configuration modules (e.g., `src/config.ts`) at startup. Never hardcode endpoints or secrets.

### 5. Explicit Error Handling
Avoid silent failures or unhandled rejections. Handle known errors explicitly with appropriate HTTP status codes and structured error payloads. Ensure background tasks and promises attach rejection handlers.

### 6. Graceful Lifecycle Management
Every HTTP service and background worker must implement clean startup logging and graceful shutdown listeners (`SIGTERM`, `SIGINT`). Servers must stop accepting incoming traffic and drain existing connections before exiting.

### 7. Test Meaningful Business Logic
Focus automated tests on actual domain contracts, edge cases, payload validations, and failure handling. Avoid writing meaningless tests for boilerplate configurations or mock abstractions.

### 8. Conventional Commits
Write clear, structured commit messages adhering to the Conventional Commits specification (e.g., `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`).

### 9. Document Risky Behavior in Pull Requests
When introducing architectural shifts, complex asynchronous behaviors, or potential breaking changes, clearly document the risks, failure modes, and verification steps in the pull request description.

### 10. Verify Before Merging
Always ensure that the full verification suite passes locally before committing or opening a PR:
```bash
pnpm typecheck
pnpm test
```

## Any DB query on orders filtering on fields beyond _id must have a matching compound index; verify with explain() before merge. Webhook catch blocks must return non-2xx on failure so upstream providers retry delivery.

**Why:** The payment-confirmed webhook lost orders silently because the duplicate-order lookup {userId, status} had no index (COLLSCAN over 500k docs) and the catch block returned HTTP 200 on timeout, preventing payment provider retries.

**Derived from:** INC-001
**Applies to:** apps/checkout/src/services/webhook-service.ts, apps/checkout/src/handlers/webhook-handler.ts, scripts/seed.ts
**Watch for:** orders.find, orders.findOne, webhook.*catch, WEBHOOK_TIMEOUT

- The webhook-service catch block silently swallows timeout/query errors and returns HTTP 200 {received: true}, preventing the payment provider from retrying. The order is never created, causing silent divergence between payment events and orders. _(github)_
- The duplicate-order query {userId, status: "pending"} has no compound index on the orders collection (only _id_), causing a COLLSCAN over 500k documents that degrades under concurrent webhook traffic and exceeds WEBHOOK_TIMEOUT_MS. _(github)_
- Add compound index {userId:1, status:1} on the orders collection (in seed.ts and as a migration) to eliminate the COLLSCAN on the duplicate-order lookup query. _(github)_
- Change the catch block in webhook-service.ts to return HTTP 500 with an error response instead of HTTP 200, so the payment provider retries delivery on failure. _(github)_
