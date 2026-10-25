# Uttarkunth website + Uttarkunth Stays

This repository serves the existing Uttarkunth website and the multi-page Uttarkunth Stays marketplace.

## Architecture

- **Netlify:** serves the static website. The existing lightweight `stays-nav` Edge Function only adds the Stays navigation link to the legacy, single-file homepage so that the homepage can remain intact.
- **Supabase:** PostgreSQL, Auth, Storage, and the `stays-catalog`, `stays-bookings`, `stays-host`, and `stays-admin` Edge Functions handle live listings and platform operations. There are no new Netlify Functions in the booking path.
- **GitHub:** source of truth for website and backend function code.

The site has no build command: `netlify.toml` publishes the repository root. Nested Stays routes are rewritten to `/stays/index.html`; static assets are served as usual.

## Stays pages

- `/stays/` — marketplace home
- `/stays/search` — search, filter and sort real published listings
- `/stays/property/:slug` — listing details and room selection
- `/stays/checkout` — date validation, availability check and booking request
- `/stays/booking?ref=...` — request confirmation and private credentials
- `/stays/trips` — private booking lookup and pending request cancellation
- `/stays/account` — Supabase Auth account
- `/stays/host` — host workspace, listings, rooms/rates, bookings and blocked dates
- `/stays/admin` — moderation, bookings, verified host assignments, agreements and audit history

## Supabase Edge Functions and secrets

The four functions are in `supabase/functions/`. Configure required server-side function environment variables in the Supabase project settings if they are not already present:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — **server-side only; never place this value in the frontend or repository**

The frontend uses only the project's public anon key. Never commit a service-role key.

## Booking policy

- Booking requests are not confirmed until the host or an authorized administrator confirms them.
- The database remains authoritative for dates, inventory, rates, booking status and the commission snapshot.
- A pending request is automatically released after 24 hours if no decision has been made.
- Online payments and Google Maps are not required for core functionality and remain disabled until deliberately configured.
- Host listings stay unpublished until reviewed by Uttarkunth.
- Existing listings are not automatically reassigned to newly created host accounts.
- Introductory commission (0% for 12 months, then 10%) applies only through an actual recorded agreement; existing agreements are not silently rewritten.

## Deployment and verification

Push/merge the changes and let the existing Netlify site publish the static files. Confirm the live Stays route and test guest request, host decision and admin flows before taking live bookings. A successful GitHub commit or Edge Function deployment does not alone prove the Netlify production deployment is complete.
