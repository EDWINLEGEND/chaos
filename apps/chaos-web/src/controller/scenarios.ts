import type { ChaosScenario } from '@chaos/shared';
import { experimentRegistry } from './experiment-registry.js';
import { logActivity } from './activity-logger.js';

interface ActiveScenarioState {
  scenarioId: string;
  experimentIds: string[];
  isRunning: boolean;
  startedAt?: string;
}

const activeScenarios = new Map<string, ActiveScenarioState>();

const PREDEFINED_SCENARIOS: ChaosScenario[] = [
  {
    id: 'checkout-silent-order-loss',
    name: 'Checkout Silent Order Loss',
    description:
      'PRD Primary Incident: Unindexed duplicate order query under concurrent traffic triggers webhook timeout, swallowing errors and resulting in silent order loss.',
    target: 'acme-checkout',
    isPrimary: true,
    defaultParams: {
      concurrency: 50,
      totalRequests: 1200,
    },
    status: 'idle',
  },
  {
    id: 'payment-provider-outage',
    name: 'Payment Provider Outage',
    description:
      'Payment provider webhook delivery fails with HTTP 500 errors and elevated latency, halting downstream processing.',
    target: 'fake-payment-provider',
    isPrimary: false,
    defaultParams: {
      percentage: 100,
      delayMs: 1000,
      durationSeconds: 45,
    },
    status: 'idle',
  },
  {
    id: 'checkout-api-regression',
    name: 'Checkout API Regression',
    description:
      'Checkout service experiences an API regression returning 50% HTTP 500 errors with 800ms latency on order creation endpoints.',
    target: 'acme-checkout',
    isPrimary: false,
    defaultParams: {
      percentage: 50,
      delayMs: 800,
      durationSeconds: 45,
    },
    status: 'idle',
  },
  {
    id: 'database-degradation',
    name: 'Database Degradation',
    description:
      'Simulates MongoDB latency spike injecting 1500ms delay into order database queries, slowing application response times.',
    target: 'acme-checkout',
    isPrimary: false,
    defaultParams: {
      delayMs: 1500,
      durationSeconds: 60,
    },
    status: 'idle',
  },
  {
    id: 'traffic-surge',
    name: 'Traffic Surge',
    description:
      'Simulates a sudden traffic surge driving 300 concurrent requests across 25 workers against the checkout service.',
    target: 'acme-checkout',
    isPrimary: false,
    defaultParams: {
      concurrency: 25,
      totalRequests: 300,
    },
    status: 'idle',
  },
];

async function executeWebhookLoad(options: {
  totalRequests: number;
  concurrency: number;
  label: string;
}): Promise<void> {
  const checkoutUrl =
    process.env['CHECKOUT_URL'] || process.env['CHECKOUT_SERVICE_URL'] || 'http://127.0.0.1:3001';
  const paymentProviderUrl = process.env['PAYMENT_PROVIDER_URL'] || 'http://127.0.0.1:3002';
  const { totalRequests, concurrency, label } = options;

  logActivity('warn', `[${label}] Concurrent webhook load generator starting (${concurrency} workers, ${totalRequests} requests)...`);

  // 1. Generate payments on Payment Provider
  const paymentEvents: Array<{ id: string; paymentId: string; userId: string; amount: number }> = [];
  const creationBatchSize = 50;
  for (let i = 0; i < totalRequests; i += creationBatchSize) {
    const batchCount = Math.min(creationBatchSize, totalRequests - i);
    const batchPromises = Array.from({ length: batchCount }, async (_, idx) => {
      const globalIdx = i + idx;
      const userId = `user_traffic_${String(globalIdx + 1).padStart(5, '0')}`;
      const amount = 1000 + (globalIdx % 50) * 100;

      const res = await fetch(`${paymentProviderUrl}/v1/test/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, amount }),
      });
      if (!res.ok) {
        throw new Error(`Failed to create payment: ${res.status}`);
      }
      return (await res.json()) as { id: string; paymentId: string; userId: string; amount: number };
    });

    const createdBatch = await Promise.all(batchPromises);
    paymentEvents.push(...createdBatch);
  }

  logActivity('info', `[${label}] Registered ${paymentEvents.length} payment events. Concurrently driving webhooks...`);

  // 2. Concurrently dispatch webhooks to Checkout
  let currentIndex = 0;
  let silentTimeouts = 0;
  let orderCreations = 0;

  async function worker(): Promise<void> {
    while (currentIndex < paymentEvents.length) {
      const index = currentIndex++;
      const event = paymentEvents[index];
      if (!event) break;

      try {
        const res = await fetch(`${checkoutUrl}/webhooks/payment-confirmed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: event.id,
            type: 'payment-confirmed',
            paymentId: event.paymentId,
            userId: event.userId,
            amount: event.amount,
          }),
        });

        if (res.status === 200) {
          const json = (await res.json()) as Record<string, unknown>;
          if (json['received'] === true) {
            silentTimeouts++;
          } else if (json['data'] && typeof json['data'] === 'object') {
            const data = json['data'] as Record<string, unknown>;
            if (data['created'] === true) {
              orderCreations++;
            }
          }
        }
      } catch {}
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  logActivity('success', `[${label}] Load run complete. Created: ${orderCreations}, Silently Dropped: ${silentTimeouts}.`);
}

export function listScenarios(): ChaosScenario[] {
  return PREDEFINED_SCENARIOS.map((sc) => {
    const active = activeScenarios.get(sc.id);
    return {
      ...sc,
      status: active?.isRunning ? 'running' : 'idle',
    };
  });
}

export function getScenario(id: string): ChaosScenario | null {
  const sc = PREDEFINED_SCENARIOS.find((s) => s.id === id);
  if (!sc) return null;
  const active = activeScenarios.get(sc.id);
  return {
    ...sc,
    status: active?.isRunning ? 'running' : 'idle',
  };
}

export async function startScenario(id: string): Promise<{ scenario: ChaosScenario; message: string }> {
  const sc = PREDEFINED_SCENARIOS.find((s) => s.id === id);
  if (!sc) {
    throw new Error(`Scenario with ID "${id}" not found`);
  }

  const existing = activeScenarios.get(id);
  if (existing?.isRunning) {
    return { scenario: { ...sc, status: 'running' }, message: 'Scenario is already running' };
  }

  logActivity('info', `Scenario triggered: "${sc.name}"`);

  // Scenario 1: Primary Incident (Checkout Silent Order Loss)
  if (id === 'checkout-silent-order-loss') {
    activeScenarios.set(id, {
      scenarioId: id,
      experimentIds: [],
      isRunning: true,
      startedAt: new Date().toISOString(),
    });

    // Run real incident break machinery asynchronously in background
    (async () => {
      try {
        await executeWebhookLoad({
          totalRequests: 1200,
          concurrency: 50,
          label: 'Primary Incident',
        });
      } catch (err) {
        logActivity('error', `[Primary Incident] Error during run: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        activeScenarios.delete(id);
      }
    })();

    return {
      scenario: { ...sc, status: 'running' },
      message: 'Primary incident load generator launched in background',
    };
  }

  // Scenario 2: Payment Provider Outage
  if (id === 'payment-provider-outage') {
    const exp1 = await experimentRegistry.createExperiment({
      name: 'Scenario: Payment Delivery Failure',
      target: 'fake-payment-provider',
      failureType: 'payment_failure',
      params: { percentage: sc.defaultParams.percentage ?? 100 },
      durationSeconds: sc.defaultParams.durationSeconds ?? 45,
    });
    const exp2 = await experimentRegistry.createExperiment({
      name: 'Scenario: Payment Delivery Latency',
      target: 'fake-payment-provider',
      failureType: 'payment_latency',
      params: { delayMs: sc.defaultParams.delayMs ?? 1000 },
      durationSeconds: sc.defaultParams.durationSeconds ?? 45,
    });

    activeScenarios.set(id, {
      scenarioId: id,
      experimentIds: [exp1.id, exp2.id],
      isRunning: true,
      startedAt: new Date().toISOString(),
    });

    return {
      scenario: { ...sc, status: 'running' },
      message: 'Payment provider outage scenario activated',
    };
  }

  // Scenario 3: Checkout API Regression
  if (id === 'checkout-api-regression') {
    const exp1 = await experimentRegistry.createExperiment({
      name: 'Scenario: Checkout HTTP 500 Spike',
      target: 'acme-checkout',
      failureType: 'http_500',
      params: { percentage: sc.defaultParams.percentage ?? 50, statusCode: 500 },
      durationSeconds: sc.defaultParams.durationSeconds ?? 45,
    });
    const exp2 = await experimentRegistry.createExperiment({
      name: 'Scenario: Checkout API Latency',
      target: 'acme-checkout',
      failureType: 'api_latency',
      params: { delayMs: sc.defaultParams.delayMs ?? 800 },
      durationSeconds: sc.defaultParams.durationSeconds ?? 45,
    });

    activeScenarios.set(id, {
      scenarioId: id,
      experimentIds: [exp1.id, exp2.id],
      isRunning: true,
      startedAt: new Date().toISOString(),
    });

    return {
      scenario: { ...sc, status: 'running' },
      message: 'Checkout API regression scenario activated',
    };
  }

  // Scenario 4: Database Degradation
  if (id === 'database-degradation') {
    const exp = await experimentRegistry.createExperiment({
      name: 'Scenario: Database Latency Spike',
      target: 'acme-checkout',
      failureType: 'db_latency',
      params: { delayMs: sc.defaultParams.delayMs ?? 1500 },
      durationSeconds: sc.defaultParams.durationSeconds ?? 60,
    });

    activeScenarios.set(id, {
      scenarioId: id,
      experimentIds: [exp.id],
      isRunning: true,
      startedAt: new Date().toISOString(),
    });

    return {
      scenario: { ...sc, status: 'running' },
      message: 'Database degradation scenario activated',
    };
  }

  // Scenario 5: Traffic Surge
  if (id === 'traffic-surge') {
    const exp = await experimentRegistry.createExperiment({
      name: 'Scenario: Traffic Surge Burst',
      target: 'acme-checkout',
      failureType: 'traffic_surge',
      params: { concurrency: 25, totalRequests: 300 },
      durationSeconds: 30,
    });

    activeScenarios.set(id, {
      scenarioId: id,
      experimentIds: [exp.id],
      isRunning: true,
      startedAt: new Date().toISOString(),
    });

    // Run controlled traffic burst asynchronously
    (async () => {
      try {
        await executeWebhookLoad({
          totalRequests: 300,
          concurrency: 25,
          label: 'Traffic Surge',
        });
      } catch (err) {
        logActivity('error', `[Traffic Surge] Error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        activeScenarios.delete(id);
      }
    })();

    return {
      scenario: { ...sc, status: 'running' },
      message: 'Traffic surge scenario initiated',
    };
  }

  throw new Error(`Unknown scenario: ${id}`);
}

export async function stopScenario(id: string): Promise<ChaosScenario | null> {
  const sc = PREDEFINED_SCENARIOS.find((s) => s.id === id);
  if (!sc) return null;

  const active = activeScenarios.get(id);
  if (active) {
    for (const expId of active.experimentIds) {
      await experimentRegistry.stopExperiment(expId);
    }
    activeScenarios.delete(id);
    logActivity('info', `Scenario stopped: "${sc.name}"`);
  }

  return { ...sc, status: 'idle' };
}
