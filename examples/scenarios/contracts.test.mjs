import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const examples = fileURLToPath(new URL('../', import.meta.url));
const ledger = 'payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/';
function descriptors(path) {
  const set = JSON.parse(execFileSync('buf', ['build', `${examples}${path}`, '--as-file-descriptor-set', '-o', '-#format=json'], { encoding: 'utf8' }));
  const types = new Map(), services = new Map();
  for (const file of set.file) {
    for (const type of file.messageType ?? []) types.set(`.${file.package}.${type.name}`, type);
    for (const type of file.enumType ?? []) types.set(`.${file.package}.${type.name}`, type);
    for (const service of file.service ?? []) services.set(`${file.package}.${service.name}`, service);
  }
  return { types, services };
}
function compatible(consumer, provider, serviceName) {
  const visited = new Set();
  function type(name) {
    if (visited.has(name)) return;
    visited.add(name);
    const a = consumer.types.get(name), b = provider.types.get(name);
    assert.ok(a && b, `${name} must exist at both ends`);
    for (const field of a.field ?? []) {
      const peer = b.field?.find(f => f.number === field.number);
      assert.ok(peer, `${name}.${field.name}: field ${field.number} missing at provider`);
      for (const key of ['name', 'type', 'typeName', 'label', 'jsonName']) assert.equal(field[key], peer[key], `${name}.${field.name}: ${key}`);
      if (field.typeName) type(field.typeName);
    }
    for (const value of a.value ?? []) assert.ok(b.value?.some(v => v.number === value.number && v.name === value.name), `${name}.${value.name}: enum drift`);
    // Consumer must retain the provider's reserved positions/names on messages
    // whose full current field set it copies (notably AuthorizeResponse).
    if (a.field?.length === b.field?.length) {
      assert.deepEqual(a.reservedRange ?? [], b.reservedRange ?? [], `${name}: reserved numbers`);
      assert.deepEqual(a.reservedName ?? [], b.reservedName ?? [], `${name}: reserved names`);
    }
  }
  const service = consumer.services.get(serviceName), peer = provider.services.get(serviceName);
  assert.ok(service && peer, serviceName);
  for (const method of service.method) {
    const actual = peer.method.find(m => m.name === method.name);
    assert.ok(actual, `${serviceName}/${method.name}`);
    for (const key of ['inputType', 'outputType', 'clientStreaming', 'serverStreaming']) assert.equal(method[key], actual[key], `${method.name}: ${key}`);
    type(method.inputType); type(method.outputType);
  }
}
test('OMS Authorize is wire-compatible with the actual ledger provider', () => {
  compatible(descriptors('shop/oms/src/infrastructure/payments/proto'), descriptors(`${ledger}transport/grpc/payment/proto`), 'payments.v1.PaymentService');
});
test('ledger GetOrder is wire-compatible with the actual OMS provider', () => {
  compatible(descriptors(`${ledger}oms/proto`), descriptors('shop/oms/src/infrastructure/transport/grpc/order/proto'), 'shop.v1.OrderService');
});
