#!/usr/bin/env node

/**
 * setup-email.js — Guide for setting up mfer.one email infrastructure.
 *
 * Two systems:
 *   1. Resend — outbound email (agents send FROM @mfer.one)
 *   2. Cloudflare Email Routing — inbound email (receives TO @mfer.one, triggers worker)
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
=== mfer.one Email Setup Guide ===

Two systems need configuring:

--- 1. OUTBOUND: Resend (sending email from @mfer.one) ---

a) Add domain to Resend:
   - Go to https://resend.com/domains
   - Click "Add Domain" -> enter "${DOMAIN}"
   - Resend will give you DNS records to add

b) Add these DNS records in Cloudflare (mfer.one zone):

   TYPE    NAME                    VALUE
   ----    ----                    -----
   TXT     ${DOMAIN}              v=spf1 include:send.resend.com ~all
   TXT     resend._domainkey      (DKIM value from Resend dashboard)
   TXT     _dmarc                 v=DMARC1; p=none; rua=mailto:dmarc@${DOMAIN}
   MX      send                   feedback-smtp.us-east-1.amazonses.com (priority 10)

c) Verify domain in Resend dashboard

d) Set RESEND_API_KEY in your .env file

e) Test: node -e "
   import { sendEmail } from './src/primitives/email.js';
   sendEmail('test@example.com', 'Test from mfer.one', 'It works!', { from: 'ollie@${DOMAIN}' });
"

--- 2. INBOUND: Cloudflare Email Routing (receiving email at @mfer.one) ---

a) In Cloudflare dashboard, go to: mfer.one > Email > Email Routing

b) Enable Email Routing (Cloudflare adds MX records automatically)

c) Deploy the email worker:
   npx wrangler deploy -c wrangler-email.toml

d) Set the fallback email secret:
   npx wrangler secret put FALLBACK_EMAIL -c wrangler-email.toml
   (Enter your backup email when prompted)

e) Add catch-all route:
   - In Email Routing > Routing Rules
   - Add rule: Catch-all (*@${DOMAIN}) -> Send to Worker -> mfer-one-email

f) Update WEBHOOK_BASE_URL in wrangler-email.toml to point to your
   Reach webhook server's public URL (or use a tunnel for local dev)

--- 3. DNS RECORDS SUMMARY ---

After both are configured, your mfer.one DNS should have:

   TYPE    NAME                    VALUE
   ----    ----                    -----
   MX      ${DOMAIN}              (auto-added by Cloudflare Email Routing)
   TXT     ${DOMAIN}              v=spf1 include:send.resend.com ~all
   TXT     resend._domainkey      (from Resend dashboard)
   TXT     _dmarc                 v=DMARC1; p=none
   CNAME   *                      (existing — points to mfer-one-gateway worker)

--- 4. TESTING ---

Outbound: reach email test@example.com "Test" "Hello from mfer.one"
Inbound:  Send email to ollie@mfer.one, check webhook logs + fallback inbox
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
