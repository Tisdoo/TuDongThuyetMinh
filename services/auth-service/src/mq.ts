import amqp from 'amqplib';
import { config } from './config';

export interface DomainEvent {
  eventId: string;
  type: string;
  occurredAt: string;
  payload: any;
}

async function connectWithRetry() {
  for (let i = 1; ; i++) {
    try {
      return await amqp.connect(config.rabbitUrl);
    } catch (e) {
      console.warn(`[mq] connect failed (attempt ${i}), retry in 3s`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

export async function startConsumer(handler: (evt: DomainEvent) => Promise<void>) {
  const conn = await connectWithRetry();
  const ch = await conn.createChannel();
  await ch.assertExchange('domain.events', 'topic', { durable: true });
  await ch.assertQueue('auth.payment-events', { durable: true });
  await ch.bindQueue('auth.payment-events', 'domain.events', 'payment.*');
  await ch.prefetch(10);
  await ch.consume('auth.payment-events', async (msg) => {
    if (!msg) return;
    try {
      await handler(JSON.parse(msg.content.toString()));
      ch.ack(msg);
    } catch (e) {
      console.error('[mq] handler failed, requeue in 5s', e);
      setTimeout(() => ch.nack(msg, false, true), 5000);
    }
  });
  console.log('[mq] consuming auth.payment-events');
}
