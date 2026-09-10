// Real cart, OMS and ledger processes over isolated Postgres + NATS. Only auth,
// pricing and Stripe are stand-ins. Builds must exist; see README.md.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, open, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as httpServer } from 'node:http';
import { createServer as tcpServer, connect as tcpConnect } from 'node:net';
import { createRequire } from 'node:module';

const exec = promisify(execFile);
const examples = fileURLToPath(new URL('../', import.meta.url));
const logs = await mkdtemp(join(tmpdir(), 'portolan-checkout-'));
const containers = [], children = [], handles = [];
const run = async (bin, args, options = {}) => (await exec(bin, args, { timeout: 120_000, maxBuffer: 2 ** 20, ...options })).stdout.trim();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(label, fn) {
  let last;
  for (let i = 0; i < 120; i++) {
    try { const result = await fn(); if (result) return result; } catch (e) { last = e; }
    const stopped = children.find(({ process }) => process.exitCode !== null || process.signalCode !== null);
    if (stopped) throw new Error(`${stopped.name} stopped; see ${logs}`);
    await pause(250);
  }
  throw new Error(`${label} timed out: ${last ?? 'not ready'}; logs: ${logs}`);
}
async function freePort() {
  const server = tcpServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function listening(port) {
  return new Promise(resolve => { const socket = tcpConnect(port, '127.0.0.1'); socket.on('connect', () => { socket.destroy(); resolve(true); }); socket.on('error', () => resolve(false)); });
}
async function container(image, port, args = [], options = []) {
  const id = await run('docker', ['run', '--rm', '-d', '-p', `127.0.0.1::${port}`, ...options, image, ...args]);
  containers.push(id);
  const address = await run('docker', ['port', id, `${port}/tcp`]);
  return { id, port: Number(address.split(':').at(-1)) };
}
async function start(name, bin, args, cwd, env) {
  const log = await open(join(logs, `${name}.log`), 'w'); handles.push(log);
  const process = spawn(bin, args, { cwd, env: { ...globalThis.process.env, TRACER_URI: '', ...env }, stdio: ['ignore', log.fd, log.fd] });
  process.on('error', error => console.error(`${name}: ${error.message}`));
  children.push({ name, process });
}
let gateway, nats;
let holds = 0;
try {
  const pg = await container('postgres:18-alpine', 5432, [], ['-e', 'POSTGRES_PASSWORD=checkout']);
  const bus = await container('nats:2.14-alpine', 4222, ['-js']);
  await until('Postgres', async () => { await run('docker', ['exec', pg.id, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); return true; });
  const sql = (db, statement) => run('docker', ['exec', pg.id, 'psql', '-U', 'postgres', '-d', db, '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement]);
  for (const db of ['cart', 'oms', 'ledger']) await sql('postgres', `CREATE DATABASE ${db}`);
  const [cartPort, omsPort, ledgerPort] = await Promise.all([freePort(), freePort(), freePort()]);
  gateway = httpServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    if (req.method !== 'POST' || req.url !== '/v1/payment_intents') { res.writeHead(404).end(); return; }
    holds++;
    const form = new URLSearchParams(body);
    assert.equal(form.get('amount'), '900'); assert.equal(form.get('currency'), 'eur');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: 'pi_checkout', status: 'requires_capture' }));
  });
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  const natsUrl = `nats://127.0.0.1:${bus.port}`;
  await start('oms', join(examples, 'shop/oms/target/debug/oms'), [], join(examples, 'shop/oms'), {
    STORE_POSTGRES_URI: `postgres://postgres:checkout@127.0.0.1:${pg.port}/oms`, NATS_URL: natsUrl,
    GRPC_ADDR: `127.0.0.1:${omsPort}`, PAYMENTS_ADDR: `http://127.0.0.1:${ledgerPort}`,
  });
  await start('ledger', 'java', ['-jar', 'target/ledger-0.1.0.jar'], join(examples, 'payments/ledger'), {
    DATABASE_URL: `jdbc:postgresql://127.0.0.1:${pg.port}/ledger`, DATABASE_USER: 'postgres', DATABASE_PASSWORD: 'checkout',
    NATS_URL: natsUrl, OMS_ADDRESS: `127.0.0.1:${omsPort}`, GRPC_PORT: `${ledgerPort}`,
    STRIPE_URL: `http://127.0.0.1:${gateway.address().port}`, STRIPE_SECRET_KEY: 'local-test-only',
  });
  await start('cart', process.execPath, ['dist/main.js'], join(examples, 'shop/cart'), {
    STORE_POSTGRES_URI: `postgres://postgres:checkout@127.0.0.1:${pg.port}/cart`, NATS_URL: natsUrl,
    PORT: `${cartPort}`, HOST: '127.0.0.1', AUTH_URL: '', PRICING_ADDR: '',
  });
  await until('services', async () => (await Promise.all([cartPort, omsPort, ledgerPort].map(listening))).every(Boolean));
  const request = async (path, body, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${cartPort}${path}`, { method: 'POST', headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    assert.ok(response.ok, `${path}: ${response.status} ${await response.clone().text()}`); return response.json();
  };
  const basket = await request('/v1/baskets');
  await request(`/v1/baskets/${basket.basketId}/items`, { sku: 'tea', quantity: 2, unitPrice: { amountMinor: 450, currency: 'EUR' } }, { 'x-basket-token': basket.token });
  const checkout = await request(`/v1/baskets/${basket.basketId}/checkout`, undefined, { authorization: 'Bearer checkout-demo' });
  assert.deepEqual(checkout.total, { amountMinor: 900, currency: 'EUR' });
  // basketId is service-generated UUID; enforce its shape before using it in SQL.
  assert.match(basket.basketId, /^[a-f0-9-]{36}$/);
  const id = basket.basketId;
  await until('confirmed order', async () => await sql('oms', `SELECT status FROM orders WHERE id='${id}'`) === 'confirmed');
  assert.equal(await sql('ledger', `SELECT id || '|' || order_id || '|' || amount_minor || '|' || status FROM payments WHERE id='${id}'`), `${id}|${id}|900|AUTHORIZED`);
  const call = join(examples, 'shop/oms/target/debug/oms-call');
  assert.deepEqual(JSON.parse(await run(call, ['get', id], { env: { ...process.env, GRPC_ADDR: `http://127.0.0.1:${omsPort}` } })), [id, 2]);

  // Redeliver real producer payloads with fresh delivery IDs to bypass broker
  // deduplication and exercise the application's idempotency.
  const require = createRequire(join(examples, 'shop/cart/package.json'));
  const { connect } = await import(require.resolve('@nats-io/transport-node'));
  const { jetstream } = await import(require.resolve('@nats-io/jetstream'));
  const { headers } = await import(require.resolve('@nats-io/nats-core'));
  nats = await connect({ servers: natsUrl });
  const js = jetstream(nats);
  const payload = JSON.parse(await sql('cart', `SELECT payload FROM outbox WHERE payload->>'basketId'='${id}' AND metadata->>'event_name'='cart.BasketCheckedOut' LIMIT 1`));
  for (const [topic, name, value] of [
    ['shop.cart.basket', 'cart.BasketCheckedOut', payload],
    ['shop.oms.order', 'oms.OrderPlaced', { orderId: id }],
    ['payments.ledger.payment', 'ledger.PaymentAuthorized', { paymentId: id, orderId: id, amount: checkout.total, occurredAt: new Date().toISOString() }],
  ]) { const h = headers(); h.set('event_name', name); await js.publish(topic, JSON.stringify(value), { headers: h }); }
  await pause(1000);
  assert.equal(await sql('oms', `SELECT count(*) FROM orders WHERE basket_id='${id}'`), '1');
  assert.equal(await sql('oms', `SELECT count(*) FROM outbox WHERE metadata->>'event_name'='oms.OrderConfirmed' AND payload->>'orderId'='${id}'`), '1');
  assert.equal(await sql('ledger', `SELECT count(*) FROM payments WHERE order_id='${id}'`), '1');
  assert.equal(holds, 1, 'authorization must not call the gateway again');
  console.log(`PASS cart → OMS → ledger: order ${id}, EUR 9.00 authorized, one confirmation after redelivery. Logs: ${logs}`);
} catch (error) {
  console.error(error);
  for (const child of children) console.error(`${child.name}:\n${(await readFile(join(logs, `${child.name}.log`), 'utf8')).slice(-5000)}`);
  process.exitCode = 1;
} finally {
  await nats?.close();
  for (const { process: child } of children) child.kill('SIGTERM');
  await pause(1000);
  for (const { process: child } of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  if (gateway) await new Promise(resolve => gateway.close(resolve));
  for (const id of containers.reverse()) await run('docker', ['rm', '-f', id]).catch(() => {});
  for (const log of handles) await log.close();
}
