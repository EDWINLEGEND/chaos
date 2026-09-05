import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ChaosScenario } from '@chaos/shared';
import { experimentRegistry } from './experiment-registry.js';
import { logActivity } from './activity-logger.js';
import { getRepoRoot } from '../utils/paths.js';

const execAsync = promisify(exec);

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
        logActivity('warn', '[Primary Incident] Concurrent webhook load generator starting (50 workers, 1200 requests)...');
        await execAsync('pnpm break', { cwd: getRepoRoot() });
        logActivity('success', '[Primary Incident] Concurrent webhook run completed. Silent order loss reproduced.');
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
    activeScenarios.set(id, {
      scenarioId: id,
      experimentIds: [],
      isRunning: true,
      startedAt: new Date().toISOString(),
    });

    // Run controlled traffic burst asynchronously
    (async () => {
      try {
        logActivity('info', '[Traffic Surge] Dispatching controlled traffic burst (25 workers, 300 requests)...');
        await execAsync('BREAK_TOTAL_REQUESTS=300 BREAK_CONCURRENCY=25 pnpm break');
        logActivity('success', '[Traffic Surge] Traffic burst completed.');
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
