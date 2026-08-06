const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

// ==========================================
// 1. CONFIGURATION & CONSTANTS
// ==========================================
const GIFTING_UNLOCK_THRESHOLD = 20.0;     
const MONTHLY_VOUCHER_LIMIT = 15;          
const MAX_MONTHLY_FREEBIE_CLAIMS = 2;      
const MAX_DAILY_MESSAGES = 15;             
const MAX_REFERRALS_PER_USER = 10;        
const TIER_2_INVITE_THRESHOLD = 10;       
const MASTER_REFERRAL_CODE = "TCM999"; 
const ADMIN_UNLOCK_CODE = "SIRGINPERALTA";
const ADMIN_STARTING_POINTS = 10000.0;

const REFERRAL_PAGE_ID = "61592870668902";
const REFERRAL_BASE_URL = `https://m.me/${REFERRAL_PAGE_ID}`;
const GOOGLE_PHOTOS_LINK = "https://photos.app.goo.gl/6h7UPfkHU5TuvzXU7"; 
const REAL_PERSON_CHAT_LINK = "https://m.me/timeless.creations.06"; 

// ==========================================
// 2. INITIALIZE FIREBASE & NODEMAILER
// ==========================================
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined
  }),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  databaseAuthVariableOverride: process.env.FIREBASE_SECRET ? { uid: "admin" } : undefined
});

const db = admin.database();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USERNAME,
    pass: process.env.MAIL_PASSWORD
  }
});

async function sendOTPEmail(recipientEmail, otpCode) {
  const htmlTemplate = `<!DOCTYPE html><html lang="en"><body style="font-family:Georgia,serif;background-color:#f9f7f2;margin:0;"><div style="padding:20px 0;"><div style="max-width:450px;background:#fff;border:1px solid #e0d6bc;margin:0 auto;padding:25px;text-align:center;"><h1 style="font-size:20px;letter-spacing:4px;text-transform:uppercase;">Timeless Creations</h1><h3>Account Security</h3><p>Use the 6-digit PIN below in Messenger:</p><div style="margin:20px 0;padding:15px;background-color:#fdfbf8;border:1px solid #d4c197;"><span style="font-family:Arial,sans-serif;font-size:28px;font-weight:bold;letter-spacing:6px;">${otpCode}</span></div></div></div></body></html>`;

  try {
    await transporter.sendMail({
      from: '"Timeless Creations" <no-reply@timelesscreations.com>',
      to: recipientEmail,
      subject: `[${otpCode}] Your Verification Code`,
      html: htmlTemplate
    });
    return true;
  } catch (err) {
    console.error("Email Delivery Error: ", err);
    return false;
  }
}

// ==========================================
// 3. META MESSENGER GRAPH API SENDER
// ==========================================
async function callSendAPI(payload) {
  const token = process.env.PAGE_ACCESS_TOKEN;
  try {
    await fetch(`https://graph.facebook.com/v20.0/me/messages?access_token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.error("Meta Send API Error: ", e);
  }
}

async function sendTextMessage(psid, text) {
  await callSendAPI({ recipient: { id: psid }, message: { text: text } });
}

// ==========================================
// 4. EXPRESS WEBHOOK ROUTES (GET & POST)
// ==========================================
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  return res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  try {
    const data = req.body;
    if (data.object === 'page') {
      for (const entry of data.entry) {
        if (entry.messaging) {
          for (const webhookEvent of entry.messaging) {
            await processWebhookEvent(webhookEvent);
          }
        }
      }
    }
  } catch (err) {
    console.error("Webhook processing error: ", err);
  }
  res.status(200).send("EVENT_RECEIVED");
});

async function processWebhookEvent(webhookEvent) {
  const senderPsid = webhookEvent.sender.id;
  let messageText = null;

  if (webhookEvent.message) {
    messageText = webhookEvent.message.quick_reply ? webhookEvent.message.quick_reply.payload : webhookEvent.message.text ? webhookEvent.message.text.trim() : null;
  } else if (webhookEvent.postback) {
    messageText = webhookEvent.postback.payload;
  }

  if (!messageText) return;

  if (messageText.toUpperCase() === "NAV_STATUS" || messageText.toUpperCase() === "GET_STARTED") {
    await sendTextMessage(senderPsid, "📊 Opening Dashboard...");
    return;
  }

  await sendTextMessage(senderPsid, `Echo from Node.js server: ${messageText}`);
}

// ==========================================
// 5. START SERVER
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 MissionPerks Node.js server running on port ${PORT}`);
});