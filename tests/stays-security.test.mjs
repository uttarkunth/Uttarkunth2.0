import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const bookings = read('../netlify/functions/bookings.js');
const properties = read('../netlify/functions/properties.js');
const toml = read('../netlify.toml');

test('booking endpoint does not enable wildcard CORS', () => {
  assert.doesNotMatch(bookings, /Access-Control-Allow-Origin["']?\s*:\s*["']\*["']/i);
  assert.doesNotMatch(properties, /Access-Control-Allow-Origin["']?\s*:\s*["']\*["']/i);
});

test('booking references use cryptographic entropy rather than timestamp plus 3 bytes', () => {
  assert.match(bookings, /randomBytes\(32\)/);
  assert.doesNotMatch(bookings, /randomBytes\(3\)/);
});

test('booking endpoint uses atomic server-side booking RPC instead of read-then-insert', () => {
  assert.match(bookings, /rpc\/create_guest_booking_request/);
  assert.doesNotMatch(bookings, /rest\/v1\/stay_bookings["']\s*,\s*\{\s*method:\s*["']POST/);
});

test('guest tracking is capability-protected and token hash is stored', () => {
  assert.match(bookings, /guest_access_token_hash/);
  assert.match(bookings, /action === ["']track["']/);
  assert.match(bookings, /action === ["']cancel["']/);
  assert.match(bookings, /randomBytes\(32\)/);
});

test('public property endpoint uses approved and published filter and allow-list', () => {
  assert.match(properties, /moderation_status/);
  assert.match(properties, /published/);
  assert.match(properties, /select/);
  assert.doesNotMatch(properties, /Access-Control-Allow-Origin["']?\s*:\s*["']\*["']/i);
});

test('security headers include CSP and HSTS', () => {
  assert.match(toml, /Content-Security-Policy/);
  assert.match(toml, /Strict-Transport-Security/);
});
