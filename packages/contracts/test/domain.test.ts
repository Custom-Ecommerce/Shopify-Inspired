import { test } from 'node:test';
import assert from 'node:assert/strict';
import { domainConnectRequestSchema, domainVerifyRequestSchema, domainStateResponseSchema } from '../src/domain';
import { failingPaths } from './helpers';

test('a domain connect request needs a hostname and nothing else', () => {
  assert.equal(domainConnectRequestSchema.safeParse({ domain: 'shop.example.com' }).success, true);
  assert.deepEqual(failingPaths(domainConnectRequestSchema.safeParse({ domain: 'x' })), ['domain']);
  assert.equal(domainConnectRequestSchema.safeParse({ domain: 'shop.example.com', storeId: '65a000000000000000000011' }).success, false);
  assert.equal(domainConnectRequestSchema.safeParse({ domain: 'shop.example.com', customDomainStatus: 'verified' }).success, false);
});

test('a domain verify request is empty: a client-supplied result is refused', () => {
  assert.equal(domainVerifyRequestSchema.safeParse({}).success, true);
  assert.equal(domainVerifyRequestSchema.safeParse({ domain: 'shop.example.com' }).success, false);
  assert.equal(domainVerifyRequestSchema.safeParse({ verified: true }).success, false);
});

const state = { domain: 'shop.example.com', customDomainStatus: 'verified', dnsRecords: [{ type: 'TXT', name: '_markazify-verify.shop.example.com', value: 'tok' }], failureReason: null, failureMessage: null, checkedAt: null, vercelConfigured: false, planAllowsCustomDomain: true };

test('a state response reports only the model domain statuses and the known failure reasons', () => {
  assert.equal(domainStateResponseSchema.safeParse(state).success, true);
  assert.deepEqual(failingPaths(domainStateResponseSchema.safeParse({ ...state, customDomainStatus: 'maybe' })), ['customDomainStatus']);
  assert.deepEqual(failingPaths(domainStateResponseSchema.safeParse({ ...state, failureReason: 'boom' })), ['failureReason']);
  assert.deepEqual(failingPaths(domainStateResponseSchema.safeParse({ ...state, dnsRecords: [{ type: 'MX', name: 'a', value: 'b' }] })), ['dnsRecords.0.type']);
});
