import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type http from 'node:http';
import { createChaosServer } from '../src/index.js';
import { experimentRegistry } from '../src/controller/experiment-registry.js';
import { clearActivityLogs } from '../src/controller/activity-logger.js';

describe('Chaos Control Plane API', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createChaosServer();
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await experimentRegistry.clearAll();
    clearActivityLogs();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe('Health & Status Endpoints', () => {
    it('returns service health report on GET /api/health', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { service: string; status: string };
      expect(json.service).toBe('chaos-web');
      expect(json.status).toBe('ok');
    });

    it('returns aggregated environment status on GET /api/environment', async () => {
      const res = await fetch(`${baseUrl}/api/environment`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        checkout: string;
        paymentProvider: string;
        mongodb: string;
        activeExperiments: number;
        ordersCount: number;
      };
      expect(json).toHaveProperty('checkout');
      expect(json).toHaveProperty('paymentProvider');
      expect(json).toHaveProperty('mongodb');
      expect(typeof json.activeExperiments).toBe('number');
      expect(typeof json.ordersCount).toBe('number');
    });
  });

  describe('Experiment Lifecycle & Validation', () => {
    it('rejects invalid experiment target with HTTP 400', async () => {
      const res = await fetch(`${baseUrl}/api/experiments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: 'unsupported-target-service',
          failureType: 'api_latency',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_TARGET');
    });

    it('rejects unsupported failure type with HTTP 400', async () => {
      const res = await fetch(`${baseUrl}/api/experiments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: 'acme-checkout',
          failureType: 'destroy_hard_drive',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_FAILURE_TYPE');
    });

    it('creates an experiment, enforces safe parameter bounds, and auto-generates ID', async () => {
      const res = await fetch(`${baseUrl}/api/experiments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Latency Injection',
          target: 'acme-checkout',
          failureType: 'api_latency',
          params: {
            delayMs: 99999, // Should be clamped to 5000ms
            percentage: 150, // Should be clamped to 100%
          },
          durationSeconds: 9999, // Should be clamped to 300s
        }),
      });

      expect(res.status).toBe(201);
      const json = (await res.json()) as { success: boolean; data: { id: string; params: { delayMs: number; percentage: number }; durationSeconds: number; status: string } };
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('running');
      expect(json.data.params.delayMs).toBe(5000);
      expect(json.data.params.percentage).toBe(100);
      expect(json.data.durationSeconds).toBe(300);

      // Stop it
      const stopRes = await fetch(`${baseUrl}/api/experiments/${json.data.id}/stop`, {
        method: 'POST',
      });
      expect(stopRes.status).toBe(200);
      const stopJson = await stopRes.json();
      expect(stopJson.data.status).toBe('completed');
    });

    it('lists active and historical experiments on GET /api/experiments', async () => {
      const res = await fetch(`${baseUrl}/api/experiments`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { data: Array<{ id: string }> };
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Predefined Scenarios', () => {
    it('lists all 5 predefined scenarios on GET /api/scenarios', async () => {
      const res = await fetch(`${baseUrl}/api/scenarios`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { data: Array<{ id: string; name: string; isPrimary?: boolean }> };

      expect(json.data).toHaveLength(5);
      const primary = json.data.find((s) => s.id === 'checkout-silent-order-loss');
      expect(primary).toBeDefined();
      expect(primary?.isPrimary).toBe(true);

      const outage = json.data.find((s) => s.id === 'payment-provider-outage');
      expect(outage).toBeDefined();

      const regression = json.data.find((s) => s.id === 'checkout-api-regression');
      expect(regression).toBeDefined();

      const dbDegradation = json.data.find((s) => s.id === 'database-degradation');
      expect(dbDegradation).toBeDefined();

      const trafficSurge = json.data.find((s) => s.id === 'traffic-surge');
      expect(trafficSurge).toBeDefined();
    });

    it('starts and stops a predefined scenario', async () => {
      const startRes = await fetch(`${baseUrl}/api/scenarios/payment-provider-outage/start`, {
        method: 'POST',
      });
      expect(startRes.status).toBe(200);
      const startJson = await startRes.json();
      expect(startJson.data.status).toBe('running');

      const stopRes = await fetch(`${baseUrl}/api/scenarios/payment-provider-outage/stop`, {
        method: 'POST',
      });
      expect(stopRes.status).toBe(200);
      const stopJson = await stopRes.json();
      expect(stopJson.data.status).toBe('idle');
    });
  });

  describe('Security & Input Validation', () => {
    it('rejects malformed JSON payload with HTTP 400', async () => {
      const res = await fetch(`${baseUrl}/api/experiments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"unclosed_json: true',
      });
      expect(res.status).toBe(400);
    });

    it('returns HTTP 404 for nonexistent routes', async () => {
      const res = await fetch(`${baseUrl}/api/unknown-endpoint`);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('records activity events into GET /api/activity', async () => {
      const res = await fetch(`${baseUrl}/api/activity`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { data: Array<{ id: string; message: string; timestamp: string }> };
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data.length).toBeGreaterThanOrEqual(1);
    });
  });
});
