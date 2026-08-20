const crypto = require("node:crypto");

// Sends via the Twilio REST API when TWILIO_ACCOUNT_SID/AUTH_TOKEN/
// TWILIO_FROM_NUMBER are all set; otherwise simulates the send (logged, no
// external call, no cost) — same "simulated until configured" convention
// used for SMS in the sibling PNG apps in this workspace. Never throws:
// callers send to many parents in a loop and one failure must not abort
// the rest.
async function sendSms(to, body) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.log(`[sms:simulated] to=${to} body=${JSON.stringify(body)}`);
    return { ok: true, simulated: true, providerMessageId: `SIMULATED-${crypto.randomBytes(6).toString("hex")}` };
  }

  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: fromNumber, Body: body }),
    });
    const data = await response.json();
    if (!response.ok) {
      return { ok: false, simulated: false, error: data?.message ?? `Twilio request failed (${response.status})` };
    }
    return { ok: true, simulated: false, providerMessageId: data?.sid };
  } catch (error) {
    return { ok: false, simulated: false, error: error instanceof Error ? error.message : "Unknown SMS send error" };
  }
}

module.exports = { sendSms };
