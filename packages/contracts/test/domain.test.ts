
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { domainConnectRequestSchema, domainVerifyRequestSchema, domainStatusResponseSchema } from '../src/domain';
import { failingPaths } from './helpers';

test('a domain connect request needs a hostname', () => {
  assert.equal(domainConnectRequestSchema.safeParse({ domain: 'shop.example.com' }).success, true);
  assert.deepEqual(failingPaths(domainConnectRequestSchema.safeParse({ domain: 'x' })), ['domain']);
});

test('a domain verify request may be empty', () => {
  assert.equal(domainVerifyRequestSchema.safeParse({}).success, true);
});

test('a status response reports only the model domain statuses', () => {
  const ok = { domain: 'shop.example.com', customDomainStatus: 'verified' };
  assert.equal(domainStatusResponseSchema.safeParse(ok).success, true);
  const bad = { domain: 'shop.example.com', customDomainStatus: 'maybe' };
  assert.deepEqual(failingPaths(domainStatusResponseSchema.safeParse(bad)), ['customDomainStatus']);
});
