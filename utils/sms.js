const twilio = require("twilio");

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

async function sendSMS({ to, message }) {
  try {
    if (!process.env.TWILIO_PHONE_NUMBER) {
      console.log("SMS sending disabled - no Twilio phone number configured");
      return;
    }

    const result = await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: to,
    });

    console.log("SMS sent successfully:", result.sid);
    return result;
  } catch (error) {
    console.error("Error sending SMS:", error);
    throw error;
  }
}

module.exports = { sendSMS };
