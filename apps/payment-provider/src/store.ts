import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  PaymentProviderEvent,
  PaymentRecord,
  CreatePaymentInput,
} from '@chaos/shared';

export interface PaymentStore {
  create(input: CreatePaymentInput): Promise<PaymentRecord>;
  findById(paymentId: string): Promise<PaymentRecord | null>;
  findByEventId(eventId: string): Promise<PaymentRecord | null>;
  listEvents(options?: { createdGt?: number }): Promise<PaymentProviderEvent[]>;
  updateDelivery(paymentId: string, status: { delivered: boolean; statusCode?: number }): Promise<void>;
  clear(): Promise<void>;
  count(): Promise<number>;
}

export class InMemoryPaymentStore implements PaymentStore {
  private readonly records = new Map<string, PaymentRecord>();
  private readonly filePath?: string;

  constructor(filePath?: string) {
    this.filePath = filePath;
    if (this.filePath) {
      this.loadFromFile();
    }
  }

  private loadFromFile(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) {
      return;
    }
    try {
      const data = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(data) as PaymentRecord[];
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item.paymentId === 'string') {
            this.records.set(item.paymentId, {
              ...item,
              lastAttemptAt: item.lastAttemptAt ? new Date(item.lastAttemptAt) : undefined,
            });
          }
        }
      }
    } catch (err) {
      console.warn(`[payment-provider] Failed to load store from ${this.filePath}:`, err);
    }
  }

  private persistToFile(): void {
    if (!this.filePath) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = JSON.stringify(Array.from(this.records.values()), null, 2);
      fs.writeFileSync(this.filePath, data, 'utf-8');
    } catch (err) {
      console.error(`[payment-provider] Failed to persist store to ${this.filePath}:`, err);
    }
  }

  public async create(input: CreatePaymentInput): Promise<PaymentRecord> {
    const randomSuffix = crypto.randomBytes(8).toString('hex');
    const paymentId = `pay_${randomSuffix}`;
    const eventId = `evt_${randomSuffix}`;
    const nowSeconds = input.created ?? Math.floor(Date.now() / 1000);

    const record: PaymentRecord = {
      id: eventId,
      type: 'payment-confirmed',
      paymentId,
      userId: input.userId,
      amount: input.amount,
      created: nowSeconds,
      delivered: false,
    };

    this.records.set(paymentId, record);
    this.persistToFile();
    return record;
  }

  public async findById(paymentId: string): Promise<PaymentRecord | null> {
    const record = this.records.get(paymentId);
    return record ? { ...record } : null;
  }

  public async findByEventId(eventId: string): Promise<PaymentRecord | null> {
    for (const record of this.records.values()) {
      if (record.id === eventId) {
        return { ...record };
      }
    }
    return null;
  }

  public async listEvents(options?: { createdGt?: number }): Promise<PaymentProviderEvent[]> {
    let list = Array.from(this.records.values());

    if (options?.createdGt !== undefined) {
      const threshold = options.createdGt;
      list = list.filter((r) => r.created > threshold);
    }

    // Sort ascending by creation time
    list.sort((a, b) => a.created - b.created);

    // Return strictly the canonical event shape, omitting internal delivery tracking
    return list.map((record) => ({
      id: record.id,
      type: record.type,
      paymentId: record.paymentId,
      userId: record.userId,
      amount: record.amount,
      created: record.created,
    }));
  }

  public async updateDelivery(
    paymentId: string,
    status: { delivered: boolean; statusCode?: number }
  ): Promise<void> {
    const record = this.records.get(paymentId);
    if (!record) return;

    record.delivered = status.delivered;
    record.lastDeliveryStatus = status.statusCode;
    record.lastAttemptAt = new Date();
    this.persistToFile();
  }

  public async clear(): Promise<void> {
    this.records.clear();
    if (this.filePath && fs.existsSync(this.filePath)) {
      try {
        fs.unlinkSync(this.filePath);
      } catch {
        // Ignore file removal errors
      }
    }
  }

  public async count(): Promise<number> {
    return this.records.size;
  }
}
