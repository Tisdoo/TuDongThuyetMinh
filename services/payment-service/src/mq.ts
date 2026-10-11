import amqp from 'amqplib';
import { config } from './config';

let channel: amqp.ConfirmChannel | null = null;

async function connectWithRetry() {
  for (let i = 1; ; i++) {
    try {
      return await amqp.connect(config.rabbitUrl);
    } catch {
      console.warn(`[mq] connect failed (attempt ${i}), retry in 3s`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function getChannel() {
  if (channel) return channel;
  const conn = await connectWithRetry();
  conn.on('close', () => { channel = null; });
  conn.on('error', () => { channel = null; });
  const ch = await conn.createConfirmChannel();
  await ch.assertExchange('domain.events', 'topic', { durable: true });
  channel = ch;
  return ch;
}

export async function publish(routingKey: string, message: unknown, messageId: string) {
  const ch = await getChannel();
  await new Promise<void>((resolve, reject) => {
    ch.publish('domain.events', routingKey, Buffer.from(JSON.stringify(message)),
      { persistent: true, messageId, contentType: 'application/json' },
      (err) => (err ? reject(err) : resolve()));
  });
}
