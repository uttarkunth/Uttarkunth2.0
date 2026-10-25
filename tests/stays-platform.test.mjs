import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

test("Stays is served as a static multi-route frontend", () => {
  const html = read("stays/index.html");
  const app = read("stays/app.js");
  assert.match(html, /\/stays\/app\.css/);
  assert.match(html, /\/stays\/app\.js/);
  for (const route of ["/stays/search", "/stays/property/", "/stays/checkout", "/stays/trips", "/stays/host", "/stays/admin"]) {
    assert.ok(app.includes(route), "missing route " + route);
  }
  assert.match(app, /functions\/v1\//);
});

test("Frontend does not contain privileged Supabase secrets or Netlify booking endpoints", () => {
  const app = read("stays/app.js");
  assert.doesNotMatch(app, /SUPABASE_SERVICE_ROLE_KEY|service_role\s*:/i);
  assert.doesNotMatch(app, /\.netlify\/functions/);
});

test("Deployed Edge Function sources are checked into the repository", () => {
  for (const fn of ["stays-catalog", "stays-bookings", "stays-host", "stays-admin"]) {
    const p = "supabase/functions/" + fn + "/index.ts";
    assert.ok(existsSync(new URL("../" + p, import.meta.url)), "missing " + p);
    assert.match(read(p), /Deno\.serve/);
  }
});

test("Guest booking backend keeps trusted atomic database and rate-limit operations", () => {
  const src = read("supabase/functions/stays-bookings/index.ts");
  assert.match(src, /create_guest_booking_request/);
  assert.match(src, /try_consume_booking_rate_limit/);
  assert.match(src, /guest_access_token_hash/);
  assert.match(src, /availability/);
});

test("Host and admin endpoints validate a Supabase Auth user", () => {
  for (const fn of ["stays-host", "stays-admin"]) {
    const src = read("supabase/functions/" + fn + "/index.ts");
    assert.match(src, /auth\/v1\/user/);
    assert.match(src, /email_confirmed_at/);
  }
});
