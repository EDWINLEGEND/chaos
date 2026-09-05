import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  isSafeTarget,
  isRehearsalBranch,
  isRehearsalPR,
  restoreAgentsBaseline,
  cleanupGithubRehearsals,
  resetPaymentProvider,
} from '../../../scripts/reset.js';

describe('Reset & Rehearsal Safety System', () => {
  describe('Safety Checks', () => {
    it('approves safe local demo database connection targets', () => {
      expect(isSafeTarget('mongodb://127.0.0.1:27017/acme')).toBe(true);
      expect(isSafeTarget('mongodb://localhost:27017/acme')).toBe(true);
      expect(isSafeTarget('mongodb://chaos-mongodb:27017/acme')).toBe(true);
    });

    it('rejects external or production MongoDB targets', () => {
      expect(isSafeTarget('mongodb+srv://prod-user:pass@cluster0.abcde.mongodb.net/acme')).toBe(false);
      expect(isSafeTarget('mongodb://10.0.0.15:27017/acme')).toBe(false);
      expect(isSafeTarget('mongodb://production-db.internal:27017/acme')).toBe(false);
    });
  });

  describe('Rehearsal Branch Marker Detection', () => {
    it('identifies rehearsal branches correctly', () => {
      expect(isRehearsalBranch('opsroom/rehearsal/fix-missing-index')).toBe(true);
      expect(isRehearsalBranch('rehearsal/run-123')).toBe(true);
      expect(isRehearsalBranch('feature/rehearsal/add-index')).toBe(true);
      expect(isRehearsalBranch('rehearsal-fix-compound-index')).toBe(true);
    });

    it('preserves canonical production branches', () => {
      expect(isRehearsalBranch('main')).toBe(false);
      expect(isRehearsalBranch('master')).toBe(false);
      expect(isRehearsalBranch('origin/main')).toBe(false);
      expect(isRehearsalBranch('feat/optimize-duplicate-order-lookup')).toBe(false);
      expect(isRehearsalBranch('patch-security-fix')).toBe(false);
    });
  });

  describe('Rehearsal PR Marker Detection', () => {
    it('identifies rehearsal PRs by title marker or head branch', () => {
      expect(
        isRehearsalPR({
          number: 42,
          title: '[OpsRoom Rehearsal] Add compound index to orders',
          headRef: 'fix-index',
        })
      ).toBe(true);

      expect(
        isRehearsalPR({
          number: 43,
          title: '[Rehearsal] Optimize lookup query',
          headRef: 'opt-query',
        })
      ).toBe(true);

      expect(
        isRehearsalPR({
          number: 44,
          title: 'Automated remediation patch',
          headRef: 'opsroom/rehearsal/patch-1',
        })
      ).toBe(true);
    });

    it('strictly preserves the canonical root-cause PR', () => {
      // PR #1 is always preserved
      expect(
        isRehearsalPR({
          number: 1,
          title: 'Optimize checkout duplicate-order lookup',
          headRef: 'feat/optimize-duplicate-order-lookup',
        })
      ).toBe(false);

      // Even if PR number is different, canonical title is protected
      expect(
        isRehearsalPR({
          number: 99,
          title: 'Optimize checkout duplicate-order lookup',
          headRef: 'feat/optimize-duplicate-order-lookup',
        })
      ).toBe(false);
    });

    it('ignores unrelated human PRs', () => {
      expect(
        isRehearsalPR({
          number: 5,
          title: 'feat(checkout): add promo code validation',
          headRef: 'feat/promo-codes',
        })
      ).toBe(false);
    });
  });

  describe('AGENTS.md Baseline Restoration', () => {
    const tempDir = path.join(process.cwd(), 'scratch', 'test-agents');
    const tempAgents = path.join(tempDir, 'AGENTS.md');
    const tempFixture = path.join(tempDir, 'AGENTS.md.canonical');

    beforeEach(() => {
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(tempFixture, '# Pristine Canonical Rules\nRule 1: Strict Mode\n', 'utf-8');
      fs.writeFileSync(tempAgents, '# Pristine Canonical Rules\nRule 1: Strict Mode\n', 'utf-8');
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('leaves unchanged baseline untouched when already pristine', () => {
      const result = restoreAgentsBaseline(tempAgents, tempFixture);
      expect(result.wasModified).toBe(false);
      expect(result.restored).toBe(false);
      expect(fs.readFileSync(tempAgents, 'utf-8')).toBe('# Pristine Canonical Rules\nRule 1: Strict Mode\n');
    });

    it('restores canonical baseline when rehearsal added rules', () => {
      // Rehearsal adds new rules to AGENTS.md
      const modifiedContent =
        '# Pristine Canonical Rules\nRule 1: Strict Mode\nRule 11: Orders require index check before merge\n';
      fs.writeFileSync(tempAgents, modifiedContent, 'utf-8');

      const result = restoreAgentsBaseline(tempAgents, tempFixture);
      expect(result.wasModified).toBe(true);
      expect(result.restored).toBe(true);

      const restoredContent = fs.readFileSync(tempAgents, 'utf-8');
      expect(restoredContent).toBe('# Pristine Canonical Rules\nRule 1: Strict Mode\n');
      expect(restoredContent).not.toContain('Rule 11');
    });
  });

  describe('GitHub Rehearsal Cleanup (Isolated Mock Testing)', () => {
    it('returns SKIPPED status when no token is provided', async () => {
      const result = await cleanupGithubRehearsals({ token: '', repository: 'test/repo' });
      expect(result.status).toBe('SKIPPED');
      expect(result.prsClosed).toBe(0);
      expect(result.branchesDeleted).toBe(0);
      expect(result.canonicalPreserved).toBe(true);
    });

    it('closes rehearsal PRs and deletes rehearsal branches using mock fetch', async () => {
      const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
        const urlStr = String(url);
        const method = init?.method ?? 'GET';

        // 1. Open PRs list
        if (urlStr.includes('/pulls?state=open')) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                number: 1, // Canonical PR
                title: 'Optimize checkout duplicate-order lookup',
                head: { ref: 'feat/optimize-duplicate-order-lookup' },
              },
              {
                number: 55, // Rehearsal PR
                title: '[OpsRoom Rehearsal] Fix missing index on orders',
                head: { ref: 'opsroom/rehearsal/fix-index' },
              },
              {
                number: 60, // Unrelated human PR
                title: 'feat: add analytics dashboard',
                head: { ref: 'feat/analytics' },
              },
            ],
          } as Response;
        }

        // 2. Closing PR
        if (method === 'PATCH' && urlStr.includes('/pulls/55')) {
          return { ok: true, status: 200, json: async () => ({ state: 'closed' }) } as Response;
        }

        // 3. Branches list
        if (urlStr.includes('/branches')) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { name: 'main' },
              { name: 'opsroom/rehearsal/fix-index' },
              { name: 'feat/analytics' },
            ],
          } as Response;
        }

        // 4. Branch deletion
        if (method === 'DELETE' && urlStr.includes('opsroom/rehearsal/fix-index')) {
          return { ok: true, status: 204 } as Response;
        }

        return { ok: false, status: 404 } as Response;
      });

      vi.stubGlobal('fetch', mockFetch);

      const result = await cleanupGithubRehearsals({
        token: 'mock-test-token',
        repository: 'EDWINLEGEND/chaos',
      });

      expect(result.status).toBe('SUCCESS');
      expect(result.prsClosed).toBe(1); // PR 55 closed
      expect(result.branchesDeleted).toBe(1); // opsroom branch deleted
      expect(result.canonicalPreserved).toBe(true);

      vi.unstubAllGlobals();
    });

    it('handles idempotent deletion when branch is already 404', async () => {
      const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
        const urlStr = String(url);
        const method = init?.method ?? 'GET';

        if (urlStr.includes('/pulls?state=open')) {
          return { ok: true, status: 200, json: async () => [] } as Response;
        }
        if (urlStr.includes('/branches')) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ name: 'opsroom/rehearsal/already-gone' }],
          } as Response;
        }
        if (method === 'DELETE') {
          // Already deleted by previous run (404)
          return { ok: false, status: 404 } as Response;
        }
        return { ok: false, status: 404 } as Response;
      });

      vi.stubGlobal('fetch', mockFetch);

      const result = await cleanupGithubRehearsals({
        token: 'mock-test-token',
        repository: 'EDWINLEGEND/chaos',
      });

      expect(result.status).toBe('SUCCESS');
      expect(result.branchesDeleted).toBe(1); // Handled safely and counted
      expect(result.prsClosed).toBe(0);

      vi.unstubAllGlobals();
    });
  });

  describe('Payment Provider Local Store Reset', () => {
    const tempStoreDir = path.join(process.cwd(), 'scratch', 'test-store');
    const tempStoreFile = path.join(tempStoreDir, 'payments.json');

    beforeEach(() => {
      fs.mkdirSync(tempStoreDir, { recursive: true });
      fs.writeFileSync(tempStoreFile, JSON.stringify([{ paymentId: 'pay_test_1' }]), 'utf-8');
    });

    afterEach(() => {
      if (fs.existsSync(tempStoreDir)) {
        fs.rmSync(tempStoreDir, { recursive: true, force: true });
      }
    });

    it('clears disk file store during local reset', async () => {
      expect(fs.existsSync(tempStoreFile)).toBe(true);

      const result = await resetPaymentProvider('http://127.0.0.1:9999', tempStoreFile);
      expect(result.success).toBe(true);
      expect(result.eventsCleared).toBe(true);
      expect(fs.existsSync(tempStoreFile)).toBe(false);
    });
  });
});
