/*
Simple integration test for Support API flow:
Requires environment variables:
  - SUPPORT_API_URL (e.g. http://localhost:4000)
  - USER_BEARER_TOKEN (a valid user token)

This script will:
  1) Create a ticket
  2) Post a message with a client_id
  3) Fetch messages and verify the server message exists

Run with: node api/test/support_integration_test.js
*/

// Use global fetch if available (Node 18+), otherwise fall back to node-fetch
let fetchFn = global.fetch;
if (!fetchFn) {
  try {
    fetchFn = require('node-fetch');
  } catch (err) {
    console.error('Global fetch is not available and node-fetch is not installed.');
    console.error('Either run `npm install node-fetch@2` in the api folder, or use Node 18+ which has global fetch.');
    process.exit(1);
  }
}
const fetch = fetchFn;
const API_URL = process.env.SUPPORT_API_URL || 'http://localhost:4000';
const TOKEN = process.env.USER_BEARER_TOKEN;

if (!TOKEN) {
  console.error('Set USER_BEARER_TOKEN env var to run this test');
  process.exit(2);
}

async function run() {
  try {
    console.log('Creating ticket...');
    const createResp = await fetch(`${API_URL}/api/support/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ title: 'Integration test ticket', body: 'Please ignore - integration test', priority: 'low', client_ticket_id: 'it-ticket-1' })
    });
    const createBody = await createResp.json();
    if (!createResp.ok) {
      console.error('Failed to create ticket', createBody);
      process.exit(3);
    }
    const ticket = createBody.ticket;
    console.log('Ticket created:', ticket.id);

    console.log('Posting a message with client_id...');
    const clientId = `it-msg-${Date.now()}`;
    const msgResp = await fetch(`${API_URL}/api/support/tickets/${ticket.id}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ message: 'Integration test message', client_id: clientId })
    });
    const msgBody = await msgResp.json();
    if (!msgResp.ok) {
      console.error('Failed to post message', msgBody);
      process.exit(4);
    }
    console.log('Message posted; server returned id:', msgBody.message && msgBody.message.id);

    console.log('Listing messages...');
    const listResp = await fetch(`${API_URL}/api/support/tickets/${ticket.id}/messages`, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    const listBody = await listResp.json();
    if (!listResp.ok) {
      console.error('Failed to list messages', listBody);
      process.exit(5);
    }
    const found = (listBody.messages || []).find(m => m.client_id === clientId || (m.message && m.message.includes('Integration test message')));
    if (found) {
      console.log('Success: message found in server list', found.id || found);
      process.exit(0);
    } else {
      console.error('Message not found in server list', listBody.messages && listBody.messages.slice(0,5));
      process.exit(6);
    }
  } catch (err) {
    console.error('Integration test error', err);
    process.exit(99);
  }
}

run();
