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

## Any MongoDB query on a non-_id field must have a matching compound index; verify IXSCAN with explain() before merge. Catch blocks in webhook/event handlers must log errors and return HTTP 500, never silently return HTTP 200.

**Why:** This incident was caused by two defects: (1) no compound index on {userId, status} causing COLLSCAN over 500k docs exceeding WEBHOOK_TIMEOUT_MS under load; (2) catch block swallowed errors and returned HTTP 200, preventing payment provider retries. Together ~850 of 1200 orders silently lost.

**Derived from:** INC-001
**Applies to:** apps/checkout/src/, scripts/seed.ts, scripts/reset.ts
**Watch for:** pull_request, merge

- No compound index on orders{userId, status}. Duplicate-check COLLSCAN on 500k docs: ~185-200ms single query, 900-1500ms under 50 concurrent workers, exceeding WEBHOOK_TIMEOUT_MS. _(github)_
- Webhook catch block silently swallows errors, returns HTTP 200 {received: true} without logging. Payment provider won't retry. Causes silent divergence: payments = webhook events >> orders. _(github)_
- Fix: (1) Add compound index {userId:1, status:1} on orders at startup + seed/reset scripts. (2) Catch block must log error and return HTTP 500 so payment provider retries. _(github)_
