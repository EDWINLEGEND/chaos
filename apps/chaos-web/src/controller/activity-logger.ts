import crypto from 'node:crypto';
import type { ChaosActivityLog } from '@chaos/shared';

const MAX_LOGS = 100;
const logs: ChaosActivityLog[] = [];

export function logActivity(
  type: 'info' | 'warn' | 'error' | 'success',
  message: string,
  experimentId?: string
): ChaosActivityLog {
  const log: ChaosActivityLog = {
    id: `log_${crypto.randomBytes(6).toString('hex')}`,
    timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
    type,
    message,
    experimentId,
  };

  logs.unshift(log); // Prepend so newest is first
  if (logs.length > MAX_LOGS) {
    logs.pop();
  }

  console.log(`[chaos-activity] [${log.type.toUpperCase()}] ${log.message}`);
  return log;
}

export function getActivityLogs(limit: number = 50): ChaosActivityLog[] {
  return logs.slice(0, limit);
}

export function clearActivityLogs(): void {
  logs.length = 0;
}
