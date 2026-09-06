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

## Any find/findOne on orders filtering non-_id fields must have a matching compound index. Verify with explain() before merge. Never silently swallow errors in webhook handlers.

**Why:** The payment-confirmed webhook performed a duplicate-order lookup {userId, status:"pending"} on a 500k document collection with no supporting index, causing COLLSCAN timeouts. Errors from this failure were silently swallowed (HTTP 200, no logging), creating invisible divergence between payment events and orders.

**Derived from:** INC-001
**Applies to:** apps/checkout/src/services/webhook-service.ts, apps/checkout/src/handlers/webhook-handler.ts, scripts/seed.ts
**Watch for:** findOne({userId, find({ status, console.log.*received: true

- Unindexed duplicate check {userId, status:"pending"} on 500k orders causes COLLSCAN. Timeout errors silently swallowed — HTTP 200, no order creation, no logging. Missing compound index {userId:1, status:1}. _(github)_
- Alex Morgan confirmed query shape {userId, status:"pending"} for duplicate-order lookup. Priya Nair recommended checking executionStats. No schema migration in deployment. _(slack)_
- Add compound index {userId:1, status:1} on orders collection at checkout service startup, and propagate webhook-service errors as HTTP 500 instead of swallowing them silently. _(github)_
