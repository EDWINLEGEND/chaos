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

## Any MongoDB query on orders used for duplicate checking or filtering must have a matching compound index. Before merging, run explain() on the query shape and verify the plan is IXSCAN, not COLLSCAN.

**Why:** The payment-confirmed webhook performed {userId, status} lookups on 500k orders without an index, causing COLLSCAN timeouts under concurrent load. The catch block silently swallowed these errors and returned HTTP 200, creating silent data divergence between webhook_events and orders. A compound index eliminates the root cause; this rule prevents regression.

**Derived from:** INC-001
**Applies to:** apps/checkout/src/services/webhook-service.ts, apps/checkout/src/handlers/webhook-handler.ts, scripts/seed.ts
**Watch for:** aggregate, find, findOne, updateOne

- No compound index on orders{userId,status} — COLLSCAN over 500k docs. Under 50 concurrent workers, latency exceeds WEBHOOK_TIMEOUT_MS causing ~850 silent failures out of 1200 webhooks. _(github)_
- Webhook handler catch block returns HTTP 200 {received:true} without logging errors or queueing order for retry, causing silent divergence: webhook_events=1200 but orders=~310-350. _(github)_
