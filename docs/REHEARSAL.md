# OpsRoom Rehearsal & Operator Runbook

This document defines the operator workflow and reset architecture for live OpsRoom incident rehearsals against the **Chaos** demo environment.

---

## 1. Operator Workflow Lifecycle

The typical live rehearsal cycle is completely automated and idempotent:

```text
       ┌────────────────────────────────────────────────────────┐
       │ 1. pnpm reset                                          │
       │    • Restores pristine AGENTS.md baseline              │
       │    • Clears payment-provider demo store                │
       │    • Reseeds 500,000 orders into acme.orders           │
       │    • Empties acme.webhook_events                       │
       │    • Ensures { userId: 1, status: 1 } index is ABSENT  │
       │    • Cleans rehearsal branches/PRs on GitHub           │
       └───────────────────────────┬────────────────────────────┘
                                   │
                                   ▼
       ┌────────────────────────────────────────────────────────┐
       │ 2. Start Services                                      │
       │    pnpm --filter @chaos/checkout start                 │
       │    pnpm --filter @chaos/payment-provider start         │
       └───────────────────────────┬────────────────────────────┘
                                   │
                                   ▼
       ┌────────────────────────────────────────────────────────┐
       │ 3. Run Incident / Rehearsal                            │
       │    pnpm break                                          │
       │    OpsRoom investigates, identifies root-cause PR,     │
       │    and proposes remediation (code/index/AGENTS.md)     │
       └───────────────────────────┬────────────────────────────┘
                                   │
                                   ▼
       ┌────────────────────────────────────────────────────────┐
       │ 4. pnpm reset                                          │
       │    Restores environment back to clean baseline         │
       └────────────────────────────────────────────────────────┘
```

---

## 2. Canonical Root-Cause GitHub PR

To enable OpsRoom's GitHub agent to investigate code changes leading to the unindexed duplicate-order query, a canonical root-cause PR is established:

* **Repository**: `EDWINLEGEND/chaos`
* **Base Branch**: `main` (baseline at commit `53cfdd7` where checkout order API exists)
* **Feature Branch**: `feat/optimize-duplicate-order-lookup` (commit `938a3e2`)
* **PR Title**: `Optimize checkout duplicate-order lookup`
* **Introduced Code**:
  ```ts
  export async function findPendingOrderByUser(userId: string) {
    const collection = getOrdersCollection();
    return collection.findOne({ userId, status: 'pending' });
  }
  ```
* **Vulnerability Introduced**: Unindexed query `{ userId, status: "pending" }` against 500,000 documents without supporting compound index `{ userId: 1, status: 1 }`, causing a full `COLLSCAN`.
* **Preservation Guarantee**: `pnpm reset` will **never** close, delete, or alter this PR or branch.

---

## 3. Rehearsal Markers for OpsRoom Artifacts

OpsRoom's code and GitHub agents create branches, pull requests, and file modifications during remediation rehearsals. To ensure safe automated cleanup without touching human developer work:

### Branch Marker
* All branches created by OpsRoom should follow the pattern:
  * `opsroom/rehearsal/<identifier>`
  * `opsroom/*`
  * `rehearsal/*`

### PR Title Marker
* All Pull Requests opened by OpsRoom should include the prefix:
  * `[OpsRoom Rehearsal] <description>`
  * `[Rehearsal] <description>`

---

## 4. `pnpm reset` Behavior

Running `pnpm reset` executes a 4-step restoration:

### A. AGENTS.md Baseline
* Compares `AGENTS.md` against the protected canonical fixture `scripts/fixtures/AGENTS.md.canonical`.
* Strips any remediation rules that OpsRoom added during rehearsals (such as index check rules or error handling mandates).
* Restores the exact 10 canonical guidelines.

### B. Payment Provider Store
* Sends HTTP `POST /v1/test/reset` to `http://127.0.0.1:3002`.
* Removes `data/payments.json` on disk if present.
* Guarantees payment event count is reset to `0`.

### C. MongoDB Database & Index Reset
* Validates `MONGODB_URI` points only to local demo targets (`127.0.0.1`, `localhost`, `chaos-mongodb`).
* Drops all secondary indexes on `acme.orders` (specifically stripping `{ userId: 1, status: 1 }` added during remediation).
* Clears existing documents and reseeds the canonical **500,000** order dataset across 25,000 users.
* Ensures `acme.webhook_events` is completely emptied (`0` documents).
* Confirms `explain('executionStats')` produces `COLLSCAN`.

### D. GitHub Remote Cleanup
* Requires `GITHUB_TOKEN` or `GH_TOKEN` in the environment.
* Closes all open PRs matching `[OpsRoom Rehearsal]`.
* Deletes all remote branches matching `opsroom/*` or `rehearsal/*`.
* Strictly preserves `main` and the canonical root-cause PR.
* If `GITHUB_TOKEN` is not set, skips remote cleanup with a clear notice while completing all local resets.

---

## 5. Environment Configuration

```bash
# Target MongoDB (default: local container)
MONGODB_URI=mongodb://127.0.0.1:27017/acme
MONGODB_DATABASE=acme

# Target Services
CHECKOUT_URL=http://127.0.0.1:3001
PAYMENT_PROVIDER_URL=http://127.0.0.1:3002

# GitHub Automation (Required for remote cleanup and PR management)
GITHUB_REPOSITORY=EDWINLEGEND/chaos
GITHUB_TOKEN=ghp_yourPersonalAccessTokenHere
```
