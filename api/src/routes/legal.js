const express = require('express');

const router = express.Router();

const LAST_UPDATED = 'March 23, 2026';
const CONTACT_EMAIL = 'support@pmarts.org';
const COMPANY_NAME = 'PMARTS';
const SERVICE_NAME = 'PMARTS (Pi Escrow Trust System)';

function pageTemplate(title, content) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} | ${COMPANY_NAME}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f8fafc;
      --card: #ffffff;
      --text: #0f172a;
      --muted: #475569;
      --border: #e2e8f0;
      --primary: #2563eb;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.65;
    }
    .wrap {
      max-width: 920px;
      margin: 0 auto;
      padding: 28px 16px 48px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
    }
    h1 {
      font-size: 1.9rem;
      margin: 0 0 6px;
    }
    h2 {
      font-size: 1.1rem;
      margin: 26px 0 8px;
      color: #111827;
    }
    p { margin: 8px 0; color: var(--muted); }
    ul { margin: 8px 0 0 20px; color: var(--muted); }
    li { margin: 6px 0; }
    .meta {
      margin: 0 0 16px;
      color: var(--muted);
      font-size: .95rem;
    }
    a { color: var(--primary); text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="card">
      ${content}
    </section>
  </main>
</body>
</html>`;
}

router.get('/privacy-policy', (req, res) => {
  const content = `
    <h1>Privacy Policy</h1>
    <p class="meta">Last Updated: ${LAST_UPDATED}</p>

    <p>This Privacy Policy explains how ${COMPANY_NAME} collects, uses, shares, and protects information when you use ${SERVICE_NAME}, including our mobile applications, APIs, and related services (collectively, the “Service”).</p>

    <h2>1. Information We Collect</h2>
    <ul>
      <li><strong>Account and identity data:</strong> Pi Network identifiers (such as Pi UID), username, and wallet address.</li>
      <li><strong>Session and security data:</strong> authentication/session tokens (stored securely in hashed form where applicable), login timestamps, device information, and fraud/security signals.</li>
      <li><strong>Transaction and escrow data:</strong> escrow records, counterparties, transaction references, amounts, statuses, dispute records, and settlement outcomes.</li>
      <li><strong>Communications data:</strong> support tickets, escrow-related chat messages between users, and dispute evidence you submit.</li>
      <li><strong>Operational data:</strong> API request metadata, diagnostics, and audit logs used for reliability and abuse prevention.</li>
    </ul>

    <h2>2. How We Use Information</h2>
    <ul>
      <li>Provide and maintain escrow, dispute resolution, messaging, notifications, and account functionality.</li>
      <li>Verify identity/session integrity, detect fraud, enforce platform rules, and secure the Service.</li>
      <li>Investigate incidents, troubleshoot issues, and improve Service performance and user experience.</li>
      <li>Comply with legal obligations and respond to valid law enforcement or regulatory requests.</li>
    </ul>

    <h2>3. Legal Bases and Consent</h2>
    <p>By using the Service, you consent to the processing described in this Policy. Where required by law, we process data under applicable legal bases such as contractual necessity, legitimate interests (e.g., fraud prevention and service security), legal compliance, and consent.</p>

    <h2>4. Sharing of Information</h2>
    <ul>
      <li><strong>With counterparties:</strong> information necessary to complete escrow transactions and resolve disputes.</li>
      <li><strong>With service providers:</strong> infrastructure, storage, notifications, analytics, and security providers operating under contractual safeguards.</li>
      <li><strong>For legal/safety reasons:</strong> when required by law, legal process, or to protect users, platform integrity, and rights.</li>
      <li><strong>Business transfers:</strong> in connection with a merger, acquisition, financing, or asset transfer, subject to applicable safeguards.</li>
    </ul>

    <h2>5. Data Retention</h2>
    <p>We retain data for as long as needed to provide the Service, complete and audit transactions, resolve disputes, comply with legal obligations, and prevent abuse. Retention periods vary by data category and legal requirements.</p>

    <h2>6. Security</h2>
    <p>We apply administrative, technical, and organizational safeguards designed to protect your information. No system is completely secure; therefore, we cannot guarantee absolute security.</p>

    <h2>7. Your Rights and Choices</h2>
    <p>Depending on your location, you may have rights to access, correct, delete, or restrict certain personal data, and to request portability or object to certain processing. You may also request account deletion, subject to legal and legitimate business retention requirements.</p>

    <h2>8. International Data Processing</h2>
    <p>Your information may be processed in jurisdictions other than your own. We implement appropriate safeguards where required by law for cross-border data transfers.</p>

    <h2>9. Children’s Privacy</h2>
    <p>The Service is not intended for children under the minimum age required by applicable law in your jurisdiction. We do not knowingly collect personal information from children in violation of applicable law.</p>

    <h2>10. Changes to This Policy</h2>
    <p>We may update this Privacy Policy from time to time. If we make material changes, we will post the updated version with a revised “Last Updated” date and, where required, provide additional notice.</p>

    <h2>11. Contact</h2>
    <p>For privacy requests or questions, contact us at <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
  `;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(pageTemplate('Privacy Policy', content));
});

router.get('/terms-of-service', (req, res) => {
  const content = `
    <h1>Terms of Service</h1>
    <p class="meta">Last Updated: ${LAST_UPDATED}</p>

    <p>These Terms of Service (“Terms”) govern your access to and use of ${SERVICE_NAME}. By creating an account, accessing, or using the Service, you agree to be bound by these Terms.</p>

    <h2>1. Eligibility and Account</h2>
    <ul>
      <li>You must be legally permitted to use the Service in your jurisdiction.</li>
      <li>You are responsible for account credentials, wallet controls, and activity under your account.</li>
      <li>You must provide accurate and current information.</li>
    </ul>

    <h2>2. Service Scope</h2>
    <p>The Service facilitates escrow workflows for peer-to-peer Pi-related transactions, including transaction tracking, messaging, notifications, and dispute handling. ${COMPANY_NAME} is not a seller or buyer in user transactions and does not guarantee the quality, legality, delivery, or fitness of items/services exchanged between users.</p>

    <h2>3. Escrow and Messaging Rules</h2>
    <ul>
      <li>Users may communicate before and during escrow, subject to platform rules and applicable law.</li>
      <li>Escrow state controls may limit or lock certain actions (including message sending) for closed/terminal escrow states.</li>
      <li>You may not use communications features for harassment, threats, fraud, or unlawful conduct.</li>
    </ul>

    <h2>4. Fees</h2>
    <p>Applicable fees, if any, are disclosed in-app or in related documentation. Unless otherwise stated, paid fees are non-refundable except where required by law.</p>

    <h2>5. Disputes Between Users</h2>
    <p>If a transaction dispute is opened, users may be required to provide timely and truthful evidence. ${COMPANY_NAME} may review available records and evidence to determine a platform outcome for escrow handling. Platform outcomes are based on available information and platform rules.</p>

    <h2>6. Prohibited Conduct</h2>
    <ul>
      <li>Fraud, money laundering, sanctions violations, or other illegal activity.</li>
      <li>Impersonation, fake accounts, or misleading identity/transaction details.</li>
      <li>Abuse of the platform, including API abuse, spam, or attempts to circumvent controls.</li>
      <li>Uploading unlawful, infringing, or malicious content.</li>
    </ul>

    <h2>7. Suspension and Termination</h2>
    <p>We may suspend, restrict, or terminate accounts that violate these Terms, create legal/compliance risk, or threaten service security and integrity.</p>

    <h2>8. Intellectual Property</h2>
    <p>The Service, including software, branding, and content (excluding user-generated content), is owned by ${COMPANY_NAME} or its licensors and protected by applicable law. You receive a limited, revocable, non-transferable right to use the Service in accordance with these Terms.</p>

    <h2>9. Disclaimers</h2>
    <p>The Service is provided on an “as is” and “as available” basis, without warranties of any kind to the extent permitted by law. We do not guarantee uninterrupted or error-free operation.</p>

    <h2>10. Limitation of Liability</h2>
    <p>To the maximum extent permitted by law, ${COMPANY_NAME} is not liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, revenues, data, or goodwill arising from or related to your use of the Service.</p>

    <h2>11. Indemnification</h2>
    <p>You agree to defend, indemnify, and hold harmless ${COMPANY_NAME} from claims, liabilities, and expenses arising out of your misuse of the Service, violation of these Terms, or violation of law or third-party rights.</p>

    <h2>12. Changes to Terms</h2>
    <p>We may modify these Terms from time to time. Continued use of the Service after updates become effective constitutes acceptance of the revised Terms.</p>

    <h2>13. Governing Law</h2>
    <p>These Terms are governed by applicable laws in the jurisdiction designated by ${COMPANY_NAME}. If a specific jurisdiction is required for compliance, ${COMPANY_NAME} may specify it in a published legal notice.</p>

    <h2>14. Contact</h2>
    <p>Questions about these Terms can be sent to <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
  `;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(pageTemplate('Terms of Service', content));
});

module.exports = router;
