import crypto from 'node:crypto';
import type {
  Experiment,
  ExperimentTarget,
  FailureType,
  ExperimentParams,
} from '@chaos/shared';
import { logActivity } from './activity-logger.js';

export class ExperimentRegistry {
  private readonly experiments = new Map<string, Experiment>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly checkoutUrl: string;
  private readonly paymentProviderUrl: string;

  constructor(
    checkoutUrl: string = process.env['CHECKOUT_URL'] || process.env['CHECKOUT_SERVICE_URL'] || 'http://127.0.0.1:3001',
    paymentProviderUrl: string = process.env['PAYMENT_PROVIDER_URL'] || 'http://127.0.0.1:3002'
  ) {
    this.checkoutUrl = checkoutUrl;
    this.paymentProviderUrl = paymentProviderUrl;
  }

  private getTargetUrl(target: ExperimentTarget): string {
    return target === 'acme-checkout' ? this.checkoutUrl : this.paymentProviderUrl;
  }

  private async notifyTarget(
    target: ExperimentTarget,
    command: { action: 'ENABLE' | 'DISABLE' | 'CLEAR'; failureType?: FailureType; params?: ExperimentParams }
  ): Promise<void> {
    const baseUrl = this.getTargetUrl(target);
    try {
      const res = await fetch(`${baseUrl}/_chaos/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        const text = await res.text();
        console.warn(`[experiment-registry] Target ${target} returned HTTP ${res.status}: ${text}`);
      }
    } catch (err) {
      console.warn(
        `[experiment-registry] Could not reach target ${target} at ${baseUrl}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  public async createExperiment(input: {
    name?: string;
    target: ExperimentTarget;
    failureType: FailureType;
    params?: ExperimentParams;
    durationSeconds?: number;
  }): Promise<Experiment> {
    // 1. Validation & bounds enforcement
    if (input.target !== 'acme-checkout' && input.target !== 'fake-payment-provider') {
      throw new Error(`Unsupported experiment target: "${input.target}". Allowed: acme-checkout, fake-payment-provider`);
    }

    const durationSeconds = Math.min(Math.max(input.durationSeconds ?? 30, 1), 300); // 1s to 300s (5min)
    const params: ExperimentParams = {
      delayMs: Math.min(Math.max(input.params?.delayMs ?? input.params?.latencyMs ?? 0, 0), 5000), // Max 5000ms
      percentage: Math.min(Math.max(input.params?.percentage ?? 100, 1), 100),
      statusCode: input.params?.statusCode ?? 500,
      concurrency: Math.min(Math.max(input.params?.concurrency ?? 10, 1), 50),
      totalRequests: Math.min(Math.max(input.params?.totalRequests ?? 100, 1), 1200),
      malformedPayload: input.params?.malformedPayload ?? false,
    };

    const id = `exp_${crypto.randomBytes(4).toString('hex')}`;
    const name = input.name ?? `Injected ${input.failureType} on ${input.target}`;

    const experiment: Experiment = {
      id,
      name,
      target: input.target,
      failureType: input.failureType,
      params,
      status: 'running',
      startedAt: new Date().toISOString(),
      durationSeconds,
    };

    this.experiments.set(id, experiment);

    // 2. Notify target adapter
    await this.notifyTarget(input.target, {
      action: 'ENABLE',
      failureType: input.failureType,
      params,
    });

    logActivity(
      'info',
      `Experiment started: "${experiment.name}" (${experiment.failureType}, ${durationSeconds}s duration)`,
      id
    );

    // 3. Schedule auto-stop timer
    const timer = setTimeout(async () => {
      await this.stopExperiment(id);
    }, durationSeconds * 1000);
    timer.unref();

    this.timers.set(id, timer);
    return experiment;
  }

  public async stopExperiment(id: string): Promise<Experiment | null> {
    const experiment = this.experiments.get(id);
    if (!experiment) return null;

    // Clear timer
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }

    if (experiment.status === 'running') {
      experiment.status = 'completed';
      experiment.endedAt = new Date().toISOString();

      // Notify target to disable failure
      await this.notifyTarget(experiment.target, {
        action: 'DISABLE',
        failureType: experiment.failureType,
      });

      logActivity('success', `Experiment stopped: "${experiment.name}"`, id);
    }

    return experiment;
  }

  public getExperiment(id: string): Experiment | null {
    return this.experiments.get(id) ?? null;
  }

  public listExperiments(): Experiment[] {
    return Array.from(this.experiments.values()).reverse();
  }

  public getActiveCount(): number {
    let count = 0;
    for (const exp of this.experiments.values()) {
      if (exp.status === 'running') count++;
    }
    return count;
  }

  public async clearAll(): Promise<void> {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    for (const exp of this.experiments.values()) {
      if (exp.status === 'running') {
        exp.status = 'completed';
        exp.endedAt = new Date().toISOString();
      }
    }

    await Promise.all([
      this.notifyTarget('acme-checkout', { action: 'CLEAR' }),
      this.notifyTarget('fake-payment-provider', { action: 'CLEAR' }),
    ]);

    this.experiments.clear();
    logActivity('info', 'All experiments cleared');
  }
}

export const experimentRegistry = new ExperimentRegistry();
