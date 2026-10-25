# Uttarkunth Stays — Full-stack booking platform

This implementation adds a dedicated Stays marketplace and host/admin workspace without replacing the rest of the Uttarkunth homepage.

## Routes
- /stays and /stays.html: guest discovery and request-to-book marketplace
- /host and /host-portal.html: authenticated host studio and verified-email admin moderation

## Netlify environment variables
Configure these in Netlify → Site configuration → Environment variables for the deployed site and local development context:

- SUPABASE_URL — your project URL
- SUPABASE_ANON_KEY — public browser key; the config endpoint exposes this value to the browser by design
- SUPABASE_SERVICE_ROLE_KEY — secret, server-side only. Never add this to HTML, JavaScript served to the browser, or Git.

No Razorpay or Google Maps key is needed; online payments and maps are deliberately disabled/deferred.

## Booking workflow
1. Public discovery reads only approved and published listings and active room inventory.
2. Guest selects a room and dates and submits a request. The server recalculates the estimate from the current room rate and stores the request in booking_requests.
3. The guest receives a booking reference and a random private tracking code. The database stores only a SHA-256 hash of that code. The guest must keep both values to track or cancel a pending request.
4. A signed-in host assigned to the property, or the verified platform admin, can confirm/decline a pending request. Confirmation calls the transactional respond_to_booking_request database RPC, which rechecks dates and inventory.
5. Host listing changes stay unpublished until an admin approves them. The admin can assign legacy unassigned properties after confirming host identity and consent.
6. The host agreement acceptance is recorded per property: 0% introductory commission for 12 months, then 10% standard commission. Room creation is blocked for a non-admin host until the agreement is accepted.

## Before production
- Confirm the current database migration history and function privileges in Supabase.
- Ensure the respond_to_booking_request(uuid,text,text,uuid) function is callable by service_role only and correctly validates the supplied actor against property ownership/admin status.
- Verify that the active RPC writes booking_requests.status, inserts a matching stay_bookings row, and stores the commission snapshot in one transaction.
- Configure Supabase Auth email confirmation and the correct site URL/redirect URLs.
- Add production rate limiting / bot protection for public booking requests, email notifications to guest/host, and a monitored backup plan.
- Test on a preview deployment before merging to main. No deployment or merge is performed by this branch.

## Manual smoke test
1. Open /stays and confirm Yash Home Stay and Wonderway Retreat appear.
2. Search by region, name and dates. Open a listing, choose a room and submit a future-date request.
3. Save the booking reference and private tracking code; track it and cancel while pending.
4. Sign in as a verified host account, submit a new listing, accept the agreement, add a room and block dates.
5. Sign in as uttarkunth@gmail.com with a verified account. Confirm admin review and host assignment work. Do not assign a legacy listing until the host account has been verified and consent is recorded.
6. Confirm one booking can be confirmed and overlapping requests are rejected by the transactional RPC.
