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

## Any MongoDB query filtering by {userId, status} on orders must have a matching compound index in init-mongo.js. Any webhook handler returning data must return non-2xx on database operation failure.

**Why:** The payment-confirmed webhook queried {userId, status: "pending"} on orders without an index, causing COLLSCANS under concurrent traffic. Combined with the handler returning 200 even on failure, payment providers considered events delivered and never retried, silently dropping orders for customers with successful payments.

**Derived from:** INC-004
**Applies to:** apps/checkout/src/services/webhook-service.ts, apps/checkout/src/handlers/webhook-handler.ts, docker/mongo/init-mongo.js
**Watch for:** mongo, query, index, webhook, orders, find, insertOne

- The order lookup in the payment-confirmed webhook queries {userId, status: "pending"} on the orders collection, which has no compound index — only _id_ exists. This causes a COLLSCAN under concurrent webhook traffic. _(github)_
- The payment-confirmed webhook returns HTTP 200 even when order creation fails (e.g., due to query timeout under load). Payment provider dashboard shows these as successful deliveries, so no retries are triggered, resulting in lost orders for customers with successful payments. _(slack)_
- PR #938a3e2 (merged 2026-09-05T09:56:22Z) introduced the payment-confirmed webhook handling. The README explicitly notes 'unindexed duplicate checks execute against orders' as a known issue in this baseline implementation. _(github)_
