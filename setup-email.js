#!/usr/bin/env node

/**
 * setup-email.js — Guide for setting up mfer.one email infrastructure.
 *
 * Architecture (v2 — KV-backed, no tunnel):
 *   Inbound:  Cloudflare Email Routing -> email-worker.js -> Cloudflare KV
 *   Outbound: Resend API (agents send FROM @mfer.one)
 *   Reading:  Agents call email-worker.js HTTP API with X-Api-Key auth
 *
 * No tunnel, no home PC, no single point of failure.
 *
 * Usage: node setup-email.js [verify]
 */

import dotenv from 'dotenv';
dotenv.config();

const DOMAIN = 'mfer.one';

async function main() {
  const command = process.argv[2];

  if (command === 'verify') {
    await verifyDomain();
    return;
  }

  console.log(`
=== mfer.one Email Setup Guide (v2 — KV-backed) ===

--- 1. INBOUND: Cloudflare Email Worker + KV ---

Already deployed: mfer-one-email worker with KV storage.
Worker URL: https://mfer-one-email.iampotdealer.workers.dev

Remaining steps (potdealer must do in Cloudflare dashboard):

a) Go to: Cloudflare dashboard > mfer.one > Email > Email Routing
b) Enable Email Routing (Cloudflare adds MX records automatically)
c) Add catch-all rule: *@${DOMAIN} -> Send to Worker -> mfer-one-email
d) Optionally set fallback email:
   CLOUDFLARE_API_TOKEN=<token> npx wrangler secret put FALLBACK_EMAIL -c wrangler-email.toml

--- 2. OUTBOUND: Resend (sending email from @mfer.one) ---

potdealer must do these manually:

a) Go to https://resend.com/domains
   - Click "Add Domain" -> enter "${DOMAIN}"
   - Resend gives you DNS records to add

b) Add these DNS records in Cloudflare (mfer.one zone):

   TYPE    NAME                           VALUE
   ----    ----                           -----
   TXT     ${DOMAIN}                      v=spf1 include:send.resend.com ~all
   TXT     resend._domainkey.${DOMAIN}    (DKIM value from Resend dashboard)
   TXT     _dmarc.${DOMAIN}              v=DMARC1; p=none;
   MX      send.${DOMAIN}                feedback-smtp.us-east-1.amazonses.com (priority 10)

c) Verify domain in Resend dashboard (click "Verify" after DNS propagates)

d) Set RESEND_API_KEY in your .env file

--- 3. API USAGE ---

Reading inbox (for agents):

   # List ollie's inbox
   curl -H "X-Api-Key: <EMAIL_API_KEY>" \\
     https://mfer-one-email.iampotdealer.workers.dev/inbox/ollie

   # Read specific email
   curl -H "X-Api-Key: <EMAIL_API_KEY>" \\
     https://mfer-one-email.iampotdealer.workers.dev/inbox/ollie/<messageId>

   # Unread count
   curl -H "X-Api-Key: <EMAIL_API_KEY>" \\
     https://mfer-one-email.iampotdealer.workers.dev/inbox/ollie/unread

   # Mark as read
   curl -X POST -H "X-Api-Key: <EMAIL_API_KEY>" \\
     https://mfer-one-email.iampotdealer.workers.dev/inbox/ollie/<messageId>/read

   # Delete
   curl -X DELETE -H "X-Api-Key: <EMAIL_API_KEY>" \\
     https://mfer-one-email.iampotdealer.workers.dev/inbox/ollie/<messageId>

--- 4. DNS RECORDS SUMMARY ---

After everything is configured, mfer.one DNS should have:

   TYPE    NAME                           VALUE
   ----    ----                           -----
   MX      ${DOMAIN}                      (auto-added by Cloudflare Email Routing)
   TXT     ${DOMAIN}                      v=spf1 include:send.resend.com ~all
   TXT     resend._domainkey.${DOMAIN}    (from Resend dashboard)
   TXT     _dmarc.${DOMAIN}              v=DMARC1; p=none;
   MX      send.${DOMAIN}                feedback-smtp.us-east-1.amazonses.com (priority 10)
   CNAME   *                              (existing — mfer-one-gateway worker)

--- 5. TESTING ---

Inbound:  Send email to ollie@${DOMAIN}, check API /inbox/ollie
Outbound: reach email test@example.com "Test" "Hello from ${DOMAIN}"
`);
}

async function verifyDomain() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('Set RESEND_API_KEY in .env first');
    process.exit(1);
  }

  console.log(`Checking Resend domain status for ${DOMAIN}...`);

  try {
    const response = await fetch('https://api.resend.com/domains', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    const data = await response.json();
    const domain = data.data?.find(d => d.name === DOMAIN);

    if (!domain) {
      console.log(`${DOMAIN} not found in Resend. Add it first at https://resend.com/domains`);
      return;
    }

    console.log(`Domain: ${domain.name}`);
    console.log(`Status: ${domain.status}`);
    console.log(`Created: ${domain.created_at}`);

    if (domain.records) {
      console.log('\nRequired DNS records:');
      for (const record of domain.records) {
        console.log(`  ${record.type.padEnd(6)} ${record.name.padEnd(40)} ${record.status} ${record.value?.slice(0, 60) || ''}...`);
      }
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
  }
}

main().catch(console.error);
