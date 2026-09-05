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

## Any aggregate() or multi-field find() on orders must have a matching compound index; verify with explain() before merge.

**Why:** MongoDB collection scans on unindexed fields caused production latency spikes. Queries on orders without compound indexes performed full COLLSCAN instead of index seeks. Requiring explain() verification before merge prevents regressions.

**Derived from:** INC-001
**Applies to:** src/services/orders/**
**Watch for:** aggregate, find, MongoDB, orders, index

- orders-service CPU 31%, memory 46%, 0 restarts, 6/6 replicas ready — all healthy _(azure)_
- mongodb CPU 31%, memory 46%, 0 restarts, 6/6 replicas ready — all healthy _(azure)_
