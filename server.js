const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const { initializeApp, cert } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const NodeCache = require('node-cache');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

// In-memory cache instance mimicking Google Apps Script CacheService (TTL in seconds)
const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

// ==========================================
// 1. CONFIGURATION & SYSTEM CONSTANTS
// ==========================================
const MAX_PASSIVE_REFERRAL_POINTS = 100.0; 
const GIFTING_UNLOCK_THRESHOLD = 20.0;     
const VIP_POINT_THRESHOLD = 20.0;          
const MONTHLY_VOUCHER_LIMIT = 15;          
const MAX_MONTHLY_FREEBIE_CLAIMS = 2;      // 🎁 Capped at 2 claims per month per user

const MAX_DAILY_MESSAGES = 15;             
const MAX_DAILY_GLOBAL_SIGNUPS = 50;       
const MAX_DAILY_OTP_PER_USER = 1;          

const MINING_UNLOCK_INVITES = 2;          
const MINING_COOLDOWN_HOURS = 24;         
const MAX_REFERRALS_PER_USER = 10;        
const TIER_2_INVITE_THRESHOLD = 10;       
const MAX_ACTIVE_VAULT_VOUCHERS = 10;     

const MASTER_REFERRAL_CODE = "TCM999"; 
const ADMIN_UNLOCK_CODE = "SIRGINPERALTA";
const ADMIN_STARTING_POINTS = 10000.0;

const MAX_BURST_MESSAGES = 6;             
const BURST_WINDOW_SECONDS = 10;          

const DEV_ADVERTISEMENT = "\n\n💡 If you want to automate your messenger like this, please contact salviejomark2019@gmail.com";

// 🔗 Links & Google Drive Direct Image Links for Messenger Image Bubbles
const REFERRAL_PAGE_ID = "61592870668902";
const REFERRAL_BASE_URL = `https://m.me/${REFERRAL_PAGE_ID}`;
const GOOGLE_PHOTOS_LINK = "https://photos.app.goo.gl/6h7UPfkHU5TuvzXU7"; 
const REAL_PERSON_CHAT_LINK = "https://m.me/timeless.creations.06"; 

const CART_IMAGE_LINKS = [
  "https://drive.google.com/uc?export=view&id=YOUR_IMAGE_ID_1",
  "https://drive.google.com/uc?export=view&id=YOUR_IMAGE_ID_2",
  "https://drive.google.com/uc?export=view&id=YOUR_IMAGE_ID_3"
];

const CATALOG_PRODUCTS = {
  "1": { name: "3D Keychain", price: 89.00 },
  "2": { name: "3D Temple", price: 189.00 },
  "3": { name: "Missionary Keychain (BOGO)", price: 129.00 },
  "4": { name: "Temple Keychain", price: 49.00 },
  "5": { name: "Mission Keepsake", price: 349.00 },
  "6": { name: "Restoration Case", price: 459.00 },
  "7": { name: "Scripture Case", price: 499.00 },
  "8": { name: "Mission Memento", price: 599.00 }
};

const SHOP_PRODUCTS = {
  "1": { name: "2% Premium Voucher", cost: 3.0, discount: 2, type: "WHOLESALE" },
  "2": { name: "5% Premium Voucher", cost: 5.0, discount: 5, type: "WHOLESALE" },
  "3": { name: "10% Premium Voucher", cost: 10.0, discount: 10, type: "WHOLESALE" }
};

// 🎁 Balanced Freebie Rewards (2.5x to 3x value ratio against required items)
const FREEBIE_REWARDS = [
  { pointCost: 10.0, freebieKey: "4", requiredKey: "1" }, 
  { pointCost: 15.0, freebieKey: "1", requiredKey: "2" }, 
  { pointCost: 20.0, freebieKey: "3", requiredKey: "5" }, 
  { pointCost: 28.0, freebieKey: "2", requiredKey: "7" }  
];

// ==========================================
// 2. INITIALIZE FIREBASE & BREVO API EMAIL
// ==========================================
initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined
  }),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = getDatabase();

// HTTP-based email delivery via Brevo API (bypasses Render outbound SMTP port blocks)
async function sendEmailViaBrevo(toEmail, subject, htmlContent) {
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: "Timeless Creations", email: "noreply.timelesscreations.ph@gmail.com" },
        to: [{ email: toEmail }],
        subject: subject,
        htmlContent: htmlContent
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || "Failed to send email via Brevo API");
    }
  } catch (e) {
    console.error("Brevo Email Exception: ", e.message);
    throw e;
  }
}

// Firebase REST-equivalent helper wrappers using Node.js SDK
async function firebaseGet(path) {
  try {
    const snapshot = await db.ref(path).get();
    return snapshot.exists() ? snapshot.val() : null;
  } catch (e) {
    console.error("Firebase GET Exception: ", e.message);
    return null;
  }
}

async function firebasePut(path, data) {
  try {
    await db.ref(path).set(data);
  } catch (e) {
    console.error("Firebase PUT Exception: ", e.message);
  }
}

async function firebasePatch(path, data) {
  try {
    await db.ref(path).update(data);
  } catch (e) {
    console.error("Firebase PATCH Exception: ", e.message);
  }
}

function tryUserLock(psid) {
  if (cache.get(`LOCK_${psid}`)) return false;
  cache.set(`LOCK_${psid}`, "LOCKED", 15); 
  return true;
}

function releaseUserLock(psid) { 
  cache.del(`LOCK_${psid}`); 
}

// ==========================================
// 3. WEBHOOK HANDLERS (GET & POST)
// ==========================================
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  return res.status(403).send('Verification failed');
});

// Dedicated Webhook endpoint for handling newsletter Unsubscriptions
app.get('/unsubscribe', async (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).send("<h3>❌ Invalid unsubscribe link.</h3>");
  
  const cleanEmailKey = email.toLowerCase().trim().replace(/\./g, '_');
  const psid = await firebaseGet(`emails/${cleanEmailKey}`);
  
  if (psid) {
    await firebasePatch(`users/${psid}`, { unsubscribed: true });
    cache.del("USER_" + psid);
    return res.status(200).send("<html><body style='font-family:Arial;text-align:center;padding:50px;'><h2>✅ Successfully Unsubscribed</h2><p>You will no longer receive monthly updates from MissionPerks.</p></body></html>");
  }
  return res.status(404).send("<html><body style='font-family:Arial;text-align:center;padding:50px;'><h2>❌ Email not found in our system records.</h2></body></html>");
});

app.post('/webhook', async (req, res) => {
  try {
    const data = req.body;
    if (data.object === 'page') {
      if (data.entry) {
        for (const entry of data.entry) {
          if (entry.messaging && entry.messaging.length) {
            for (const webhookEvent of entry.messaging) {
              if (webhookEvent) await processWebhookEvent(webhookEvent);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("Webhook Error: ", err);
  }
  return res.status(200).send("EVENT_RECEIVED");
});

async function processWebhookEvent(webhookEvent) {
  const senderPsid = webhookEvent.sender.id;

  if (webhookEvent.message && webhookEvent.message.mid) {
    if (cache.get(webhookEvent.message.mid)) return;
    cache.set(webhookEvent.message.mid, "PROCESSED", 60);
  } else if (webhookEvent.postback) {
    const dedupeKey = `PB_${senderPsid}_${webhookEvent.postback.payload}_${webhookEvent.timestamp || ""}`;
    if (cache.get(dedupeKey)) return;
    cache.set(dedupeKey, "PROCESSED", 60);
  }

  if (webhookEvent.referral && webhookEvent.referral.ref) {
    setDirectRef(senderPsid, webhookEvent.referral.ref.trim().toUpperCase());
  }
  if (webhookEvent.postback && webhookEvent.postback.referral && webhookEvent.postback.referral.ref) {
    setDirectRef(senderPsid, webhookEvent.postback.referral.ref.trim().toUpperCase());
  }

  // Handle postback or text message entry starting with ref payload formatting
  if (webhookEvent.message) {
    let messageText = webhookEvent.message.quick_reply ? webhookEvent.message.quick_reply.payload : webhookEvent.message.text ? webhookEvent.message.text.trim() : null;
    if (!messageText) return sendTextMessage(senderPsid, "⚠️ Invalid input format. Please reply using the text options.");
    
    // Auto-detect referral code if user pastes the share link block
    if (messageText.includes("?ref=")) {
      const parts = messageText.split("?ref=");
      if (parts[1]) {
        const extractedCode = parts[1].trim().toUpperCase().substring(0, 6);
        setDirectRef(senderPsid, extractedCode);
      }
    }

    await handleIncomingMessage(senderPsid, messageText);
  } else if (webhookEvent.postback && webhookEvent.postback.payload) {
    await handleIncomingMessage(senderPsid, webhookEvent.postback.payload);
  }
}

// ==========================================
// 4. HELPERS & LIMITS
// ==========================================
function isSpamming(psid) {
  let count = parseInt(cache.get(`BURST_${psid}`) || "0", 10);
  if (count >= MAX_BURST_MESSAGES) return true;
  cache.set(`BURST_${psid}`, (count + 1).toString(), BURST_WINDOW_SECONDS);
  return false;
}

async function checkDailyRateLimit(psid) {
  const user = await getUserRecord(psid);
  if (!user) return true; 

  const today = new Date().toISOString().slice(0, 10);
  if (user.registeredAt && user.registeredAt.startsWith(today)) return true; 
  if (getSession(psid)) return true;

  let count = parseInt(cache.get(`RATE_LIMIT_${psid}_${today}`) || "0", 10);
  if (count >= MAX_DAILY_MESSAGES) return false;
  cache.set(`RATE_LIMIT_${psid}_${today}`, (count + 1).toString(), 86400); 
  return true;
}

async function checkGlobalSignupLimit() {
  const today = new Date().toISOString().slice(0, 10);
  const count = await firebaseGet(`system/signups_${today}`) || 0;
  return count < MAX_DAILY_GLOBAL_SIGNUPS;
}

async function incrementGlobalSignupCount() {
  const today = new Date().toISOString().slice(0, 10);
  const count = await firebaseGet(`system/signups_${today}`) || 0;
  await firebasePut(`system/signups_${today}`, count + 1);
}

async function checkEmailOTPLimit(email) {
  const cleanEmail = email.toLowerCase().trim().replace(/\./g, '_');
  const today = new Date().toISOString().slice(0, 10);
  const count = await firebaseGet(`system/otp_${cleanEmail}_${today}`) || 0;
  return count < MAX_DAILY_OTP_PER_USER;
}

async function incrementEmailOTPCount(email) {
  const cleanEmail = email.toLowerCase().trim().replace(/\./g, '_');
  const today = new Date().toISOString().slice(0, 10);
  await firebasePut(`system/otp_${cleanEmail}_${today}`, 1);
}

async function checkMonthlyVoucherLimit(psid) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const count = await firebaseGet(`users/${psid}/monthlyVouchers/${currentMonth}`) || 0;
  return { allowed: count < MONTHLY_VOUCHER_LIMIT, used: count, limit: MONTHLY_VOUCHER_LIMIT };
}

async function incrementMonthlyVoucherCount(psid) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const count = await firebaseGet(`users/${psid}/monthlyVouchers/${currentMonth}`) || 0;
  await firebasePut(`users/${psid}/monthlyVouchers/${currentMonth}`, count + 1);
}

async function checkMonthlyFreebieLimit(psid, idx) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const count = await firebaseGet(`users/${psid}/monthlyFreebies/${currentMonth}/${idx}`) || 0;
  return count < MAX_MONTHLY_FREEBIE_CLAIMS;
}

async function incrementMonthlyFreebieCount(psid, idx) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const count = await firebaseGet(`users/${psid}/monthlyFreebies/${currentMonth}/${idx}`) || 0;
  await firebasePut(`users/${psid}/monthlyFreebies/${currentMonth}/${idx}`, count + 1);
}

function getSession(psid) { 
  const val = cache.get(`SESSION_${psid}`);
  return val ? JSON.parse(val) : null;
}
function setSession(psid, sessionObj) { cache.set(`SESSION_${psid}`, JSON.stringify(sessionObj), 1800); }
function clearSession(psid) { cache.del(`SESSION_${psid}`); }
function setDirectRef(psid, refCode) { cache.set("DIRECT_REF_" + psid, refCode, 1800); }
function getDirectRef(psid) { return cache.get("DIRECT_REF_" + psid); }

// ==========================================
// 5. DYNAMIC QUICK REPLY BUILDER
// ==========================================
function getDashboardQuickReplies(currentContext) {
  let allButtons = [
    { title: "📊 Dashboard", payload: "NAV_STATUS" },
    { title: "📁 Vault", payload: "NAV_VAULT" },
    { title: "🛍️ Shop & Freebies", payload: "NAV_SHOP" },
    { title: "💌 Invite & Redeem", payload: "NAV_INVITE_REDEEM" },
    { title: "🎁 Gift Points", payload: "NAV_GIFT" }
  ];
  return allButtons.filter(btn => btn.payload !== currentContext);
}

// ==========================================
// 6. MAIN ROUTER & CONVERSATION GATEKEEPER
// ==========================================
async function handleIncomingMessage(psid, text) {
  if (isSpamming(psid)) return sendTextMessage(psid, "🛑 Security Notice: High message frequency detected. Please wait a few seconds.");
  
  if (!(await checkDailyRateLimit(psid))) {
    return sendTextMessage(psid, "😴 Resting Mode Active: You have completed all your daily tasks and reached the menu click limit. Please come back tomorrow!" + DEV_ADVERTISEMENT);
  }

  const cleanText = text.trim();
  const trimmedUpper = cleanText.toUpperCase();

  if (trimmedUpper === "GET_STARTED") {
    sendTextMessage(psid, "👋 Welcome to MissionPerks by Timeless Creations!");
  }

  if (trimmedUpper.startsWith("/ADMIN")) {
    const suppliedCode = trimmedUpper.replace("/ADMIN", "").trim();
    if (suppliedCode === ADMIN_UNLOCK_CODE) return grantTesterAccess(psid);
    return sendTextMessage(psid, "❌ Access Denied.");
  }

  if (trimmedUpper === "/ADMIN UNTEST" || trimmedUpper === "UNTEST" || trimmedUpper === "/UNTEST") {
    return revokeTesterAccess(psid);
  }

  const user = await getUserRecord(psid);

  if (user) {
    if (trimmedUpper === "NAV_STATUS" || trimmedUpper === "/START" || trimmedUpper === "GET_STARTED") {
      clearSession(psid);
      return displayDashboard(psid, user);
    }

    let session = getSession(psid);

    if (session) {
      if (trimmedUpper === "NAV_STATUS" || trimmedUpper === "BACK_TO_DASHBOARD") {
        clearSession(psid);
        return displayDashboard(psid, user);
      }
      if (session.state === "AWAITING_CART_INPUT") return processCartCheckout(psid, text, user, session);
      if (session.state === "AWAITING_GIFT_DETAILS") return processGiftSubmission(psid, text, session);
    }

    if (trimmedUpper === "NAV_VAULT") return displayVoucherStorage(psid);
    if (trimmedUpper === "NAV_SHOP") return displayShopAndFreebies(psid, user);
    if (trimmedUpper === "NAV_INVITE_REDEEM") return displayInviteAndRedeemHub(psid, user);
    if (trimmedUpper === "NAV_DAILY_REDEEM" || trimmedUpper === "NAV_MINE" || trimmedUpper === "/MINE") return processDailyRedeem(psid, user);
    if (trimmedUpper === "NAV_GIFT" || trimmedUpper.startsWith("/GIFT")) return handleGiftingCommand(psid, text, session);
    if (trimmedUpper === "BUY_VOUCHER_2") return processVoucherPurchase(psid, "1", user);
    if (trimmedUpper === "BUY_VOUCHER_5") return processVoucherPurchase(psid, "2", user);
    if (trimmedUpper === "BUY_VOUCHER_10") return processVoucherPurchase(psid, "3", user);

    if (trimmedUpper.startsWith("FREEBIE_REDEEM_")) return processFreebieRedeem(psid, parseInt(trimmedUpper.replace("FREEBIE_REDEEM_", "").trim(), 10), user);
    if (trimmedUpper.startsWith("CONFIRM_APPLY_")) return initiateVoucherApplyFlow(psid, trimmedUpper.replace("CONFIRM_APPLY_", "").trim(), user);
    if (trimmedUpper.startsWith("APPLY_PROMPT_")) return promptVoucherWarning(psid, trimmedUpper.replace("APPLY_PROMPT_", "").trim());
    if (trimmedUpper.startsWith("/REDEEM") || trimmedUpper.startsWith("REDEEM ")) return processRedeemCode(psid, text.replace(/\/redeem/i, "").replace(/redeem/i, "").trim().toUpperCase(), user);
    if (trimmedUpper.startsWith("/APPLY")) return promptVoucherWarning(psid, text.replace(/\/apply/i, "").trim().toUpperCase());

    return displayDashboard(psid, user);
  }

  let session = getSession(psid);
  let currentRef = getDirectRef(psid);

  if (!session) {
    if (trimmedUpper === "NO_REF_CODE") {
      setSession(psid, { state: "AWAITING_CONSENT" });
      return sendQuickReplies(psid, `⚖️ DATA PRIVACY & TERMS CONSENT\n------------------\nIn compliance with the Data Privacy Act, by entering your email you agree to receive a monthly mail update until your service or membership ends.\n\nDo you accept these terms to continue?`, [
        { title: "✅ I Agree", payload: "CONSENT_ACCEPTED" },
        { title: "❌ Decline", payload: "CANCEL" }
      ]);
    }

    const inputCode = (trimmedUpper !== "GET_STARTED" && trimmedUpper !== "") ? trimmedUpper : currentRef;
    if (inputCode) {
      const matchingUser = await getUserRecordByRefCode(inputCode);
      if (inputCode !== MASTER_REFERRAL_CODE && matchingUser) {
        const stats = getInviteStats(matchingUser);
        if (stats.total >= MAX_REFERRALS_PER_USER) return sendTextMessage(psid, `⚠️ Invitation Limit Reached: The key "${inputCode}" has reached its limit of ${MAX_REFERRALS_PER_USER} invited members.`);
      }

      if (matchingUser || inputCode === MASTER_REFERRAL_CODE) {
        setDirectRef(psid, inputCode);
        setSession(psid, { state: "AWAITING_CONSENT" });
        return sendQuickReplies(psid, `⚖️ DATA PRIVACY & TERMS CONSENT\n------------------\nIn compliance with the Data Privacy Act, by entering your email you agree to receive a monthly mail update until your service or membership ends.\n\nDo you accept these terms to continue?`, [
          { title: "✅ I Agree", payload: "CONSENT_ACCEPTED" },
          { title: "❌ Decline", payload: "CANCEL" }
        ]);
      }
    }

    sendQuickReplies(psid, `🌟 WELCOME TO TIMELESS CREATIONS!\n------------------\nTo register for MissionPerks, please reply with your friend's 6-character Invitation Key.\n\nFormat: AAA### (e.g. KJL482)`, [{ title: "❓ I Don't Have a Code", payload: "NO_REF_CODE" }]);
    return;
  }

  if (trimmedUpper === "CANCEL" || trimmedUpper === "RESTART") {
    clearSession(psid);
    return sendTextMessage(psid, "🔄 Registration cancelled. Send 'Get Started' or your friend's Invite Key to try again.");
  }

  if (session.state === "AWAITING_CONSENT") {
    if (trimmedUpper === "CONSENT_ACCEPTED" || trimmedUpper === "I AGREE" || trimmedUpper === "AGREE") {
      const ref = getDirectRef(psid);
      if (ref === MASTER_REFERRAL_CODE) {
        setSession(psid, { state: "AWAITING_EMAIL_FOR_MASTER" });
        return sendTextMessage(psid, `📧 NO FRIEND'S INVITATION KEY?\n------------------\nPlease enter your Email address. We will email you the Master Key along with your Verification PIN.`);
      } else {
        setSession(psid, { state: "AWAITING_EMAIL" });
        return sendTextMessage(psid, `🎉 TERMS ACCEPTED!\n------------------\n👉 STEP 1 of 4: Enter your Email address to verify your account:`);
      }
    } else {
      clearSession(psid);
      return sendTextMessage(psid, "❌ Registration declined. You must accept the Data Privacy terms to register.");
    }
  }

  if (session.state === "AWAITING_EMAIL_FOR_MASTER") {
    setDirectRef(psid, MASTER_REFERRAL_CODE);
    return handleEmailAndSendOTP(psid, text.trim().toLowerCase(), session, true);
  }
  if (session.state === "AWAITING_EMAIL") return handleEmailAndSendOTP(psid, text.trim().toLowerCase(), session, false);
  if (session.state === "AWAITING_OTP") return processOTPVerification(psid, text.trim(), session);
  if (session.state === "AWAITING_TITLE") {
    if (trimmedUpper !== "ELDER" && trimmedUpper !== "SISTER" && trimmedUpper !== "BROTHER") return sendQuickReplies(psid, "❌ Tap Elder, Sister, or Brother below:", [{ title: "Elder", payload: "ELDER" }, { title: "Sister", payload: "SISTER" }, { title: "Brother", payload: "BROTHER" }]);
    session.title = trimmedUpper;
    session.state = "AWAITING_LAST_NAME";
    setSession(psid, session);
    return sendTextMessage(psid, "👉 STEP 3 of 4: Enter your Last Name:");
  }
  if (session.state === "AWAITING_LAST_NAME") {
    session.lastName = text.trim();
    session.state = "AWAITING_BATCH";
    setSession(psid, session);
    return sendTextMessage(psid, "👉 STEP 4 of 4: Enter Batch Month & Year (e.g. August 2026):");
  }
  if (session.state === "AWAITING_BATCH") {
    if (text.trim().length < 4) return sendTextMessage(psid, "❌ Enter a valid batch (e.g. August 2026):");
    session.batch = text.trim();
    return finalizeRegistration(psid, session, getDirectRef(psid) || MASTER_REFERRAL_CODE);
  }
}

// ==========================================
// 7. FIREBASE GETTERS & LOCAL CACHING
// ==========================================
async function getUserRecord(psid) {
  const cached = cache.get("USER_" + psid);
  if (cached) return JSON.parse(cached);

  const data = await firebaseGet(`users/${psid}`);
  if (!data) return null;
  data.psid = psid;
  data.points = parseFloat(data.points || 0);
  data.giftedPointsReceived = parseFloat(data.giftedPointsReceived || 0);
  data.passiveRefPoints = parseFloat(data.passiveRefPoints || 0);
  data.isTester = data.isTester === true || data.isTester === "TRUE";

  cache.set("USER_" + psid, JSON.stringify(data), 600); 
  return data;
}

async function updateCachedUser(psid, patchData) {
  await firebasePatch(`users/${psid}`, patchData);
  let cachedStr = cache.get("USER_" + psid);
  if (cachedStr) {
    let cachedUser = JSON.parse(cachedStr);
    Object.assign(cachedUser, patchData);
    cache.set("USER_" + psid, JSON.stringify(cachedUser), 600);
  }
}

async function getUserRecordByRefCode(refCode) {
  const psid = await firebaseGet(`refToPsid/${refCode.toUpperCase()}`);
  return psid ? await getUserRecord(psid) : null;
}

function getInviteStats(user) {
  const invitesObj = user.invites || {};
  return {
    total: Object.keys(invitesObj).length,
    hasMissionary: Object.values(invitesObj).some(email => email.toLowerCase().endsWith("@missionary.org"))
  };
}

async function generateCompactReferralCode() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const numbers = "0123456789";
  let code, exists;
  do {
    code = "";
    for (let i = 0; i < 3; i++) code += letters.charAt(Math.floor(Math.random() * letters.length));
    for (let j = 0; j < 3; j++) code += numbers.charAt(Math.floor(Math.random() * numbers.length));
    exists = await firebaseGet(`refToPsid/${code}`);
  } while (exists);
  return code;
}

function generateBOMVoucherCode(psid) {
  const heroes = ["NEPHI", "MORONI", "ALMA", "HELAMAN", "AMMON", "ETHER", "LEHI", "MORMON"];
  const selectedHero = heroes[Math.floor(Math.random() * heroes.length)];
  const rawPayload = `${psid || 'GUEST'}_${Date.now()}_${Math.random()}`;
  const hash = crypto.createHash('sha256').update(rawPayload).digest();
  let hexString = "";
  for (let i = 0; i < 4; i++) {
    let byteVal = hash[i];
    let byteHex = byteVal.toString(16);
    if (byteHex.length === 1) byteHex = "0" + byteHex;
    hexString += byteHex;
  }
  return `${selectedHero}-${hexString.toUpperCase()}`;
}

// ==========================================
// 8. REGISTRATION & OTP FLOWS
// ==========================================
async function handleEmailAndSendOTP(psid, cleanEmail, session, isMasterFlow) {
  if (!(await checkGlobalSignupLimit())) return sendTextMessage(psid, "⚠️ Daily Sign-Up Cap Reached: Today's global registration limit (50 members) has been reached.");
  if (!(await checkEmailOTPLimit(cleanEmail))) return sendTextMessage(psid, "⚠️ Daily OTP Limit Reached: A verification code was already sent to this email address today.");
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(cleanEmail)) return sendTextMessage(psid, "❌ Incorrect Email Format: Please enter a valid email address:");
  
  const emailDomain = cleanEmail.split("@")[1];
  const typoDomains = ["gamil.com", "gmal.com", "yaho.com", "hotmial.com", "outlok.com"];
  if (typoDomains.includes(emailDomain)) return sendTextMessage(psid, `❌ Email Typo Detected: Did you mean @${emailDomain.replace("gamil", "gmail").replace("gmal", "gmail").replace("yaho", "yahoo").replace("hotmial", "hotmail").replace("outlok", "outlook")}?`);

  if (await firebaseGet(`emails/${cleanEmail.replace(/\./g, ',')}`)) return sendTextMessage(psid, "⚠️ Email Already Registered. Type CANCEL to restart.");

  const generatedOTP = Math.floor(100000 + Math.random() * 900000).toString();
  
  const todayStr = new Date().toISOString().slice(0, 10);
  const cleanEmailKey = cleanEmail.toLowerCase().trim().replace(/\./g, '_');
  await firebasePut(`otps/${cleanEmailKey}_${todayStr}`, {
    email: cleanEmail,
    otp: generatedOTP,
    timestamp: new Date().toISOString(),
    psid: psid
  });

  const appUrl = process.env.RENDER_EXTERNAL_URL || `https://${process.env.RENDER_SERVICE_NAME || 'mission-perks'}.onrender.com`;
  const unsubscribeLink = `${appUrl}/unsubscribe?email=${encodeURIComponent(cleanEmail)}`;

  const htmlTemplate = `<!DOCTYPE html><html lang="en"><body style="font-family:Georgia,serif;background-color:#f9f7f2;margin:0;"><div style="padding:20px 0;"><div style="max-width:450px;background:#fff;border:1px solid #e0d6bc;margin:0 auto;padding:25px;text-align:center;"><h1 style="font-size:20px;letter-spacing:4px;text-transform:uppercase;">Timeless Creations</h1><h3>Account Security</h3><p>Use the 6-digit PIN below in Messenger:</p><div style="margin:20px 0;padding:15px;background-color:#fdfbf8;border:1px solid #d4c197;"><span style="font-family:Arial,sans-serif;font-size:28px;font-weight:bold;letter-spacing:6px;">${generatedOTP}</span></div><p style="font-size:11px;color:#777;margin-top:30px;border-top:1px solid #eee;padding-top:15px;">Data Privacy Notice: Per our Terms and Data Privacy Act agreement, you are subscribed to receive monthly updates until your service or membership ends. <br><a href="${unsubscribeLink}" style="color:#b58900;">Unsubscribe here</a></p></div></div></div></body></html>`;

  try {
    await sendEmailViaBrevo(cleanEmail, `[${generatedOTP}] Your Verification Code`, htmlTemplate);
    await incrementGlobalSignupCount();
    await incrementEmailOTPCount(cleanEmail);
  } catch (err) {
    return sendTextMessage(psid, "❌ Email Delivery Error. Please re-check your email address.");
  }

  session.email = cleanEmail;
  session.otp = generatedOTP;
  session.state = "AWAITING_OTP";
  setSession(psid, session);
  sendTextMessage(psid, `📧 VERIFICATION CODE SENT!\n------------------\nWe emailed a 6-digit PIN to ${cleanEmail}.\n\n⚠️ NOTE: If not visible in your inbox, please check your SPAM / JUNK folder!\n\nPlease reply with the PIN code (Type CANCEL to restart):`);
}

function processOTPVerification(psid, userOtpInput, session) {
  if (userOtpInput.trim() !== session.otp) return sendTextMessage(psid, "❌ Incorrect PIN code. Please check your email and try again (or type CANCEL):");
  session.state = "AWAITING_TITLE";
  delete session.otp;
  setSession(psid, session);
  sendQuickReplies(psid, `✅ EMAIL VERIFIED!\n------------------\n👉 STEP 2 of 4: Select Title:`, [{ title: "Elder", payload: "ELDER" }, { title: "Sister", payload: "SISTER" }, { title: "Brother", payload: "BROTHER" }]);
}

async function finalizeRegistration(psid, session, appliedRefCode) {
  const isMaster = (appliedRefCode === MASTER_REFERRAL_CODE);
  let finalRef = appliedRefCode;

  if (!isMaster) {
    const tempUserCheck = await getUserRecordByRefCode(appliedRefCode);
    if (tempUserCheck && tempUserCheck.psid === psid) finalRef = MASTER_REFERRAL_CODE;
  }

  const userRefCode = await generateCompactReferralCode();
  const initialBonus = (finalRef === MASTER_REFERRAL_CODE) ? 1.0 : 2.0;

  await firebasePut(`users/${psid}`, {
    email: session.email, title: session.title, lastName: session.lastName, batch: session.batch,
    refCode: userRefCode, appliedRefCode: finalRef || MASTER_REFERRAL_CODE,
    points: initialBonus, giftedPointsReceived: 0.0, passiveRefPoints: 0.0,
    lastMinedTimestamp: "", isTester: false, unsubscribed: false, registeredAt: new Date().toISOString()
  });
  await firebasePut(`refToPsid/${userRefCode}`, psid);
  await firebasePut(`emails/${session.email.replace(/\./g, ',')}`, psid);

  if (finalRef && finalRef !== MASTER_REFERRAL_CODE) await distributeUplineCommissions(finalRef, psid, session.email, initialBonus, session.title + " " + session.lastName);

  const expiryDate = new Date();
  expiryDate.setMonth(expiryDate.getMonth() + 1);
  const expiryStr = expiryDate.toISOString().slice(0, 10);
  const newbieVoucherCode = generateBOMVoucherCode(psid);
  const passDiscount = isMaster ? 2 : 5;
  const passTitle = isMaster ? "2% Premium Voucher" : "5% Premium Voucher";

  await addVoucherToStorage(psid, newbieVoucherCode, passTitle, passDiscount, 0.0, expiryStr);

  clearSession(psid);
  sendTextMessage(psid, `🎉 SUCCESSFUL REGISTRATION\n------------------\n🎁 Issued Welcome Rewards:\n• Voucher: ${passTitle}\n• Code: ${newbieVoucherCode}\n\nOpening Dashboard:`);
  
  cache.del("USER_" + psid);
  displayDashboard(psid, await getUserRecord(psid));
}

async function grantTesterAccess(psid) {
  const user = await getUserRecord(psid);
  if (!user) {
    const adminRefCode = await generateCompactReferralCode();
    await firebasePut(`users/${psid}`, {
      email: `tester_${psid}@internal.dev`, title: "ADMIN", lastName: "TESTER", batch: "N/A",
      refCode: adminRefCode, appliedRefCode: MASTER_REFERRAL_CODE,
      points: ADMIN_STARTING_POINTS, giftedPointsReceived: 0.0, passiveRefPoints: 0.0,
      lastMinedTimestamp: "", isTester: true, unsubscribed: false, registeredAt: new Date().toISOString()
    });
    await firebasePut(`refToPsid/${adminRefCode}`, psid);
  } else {
    await updateCachedUser(psid, { points: ADMIN_STARTING_POINTS, isTester: true, title: "ADMIN", lastName: "TESTER" });
  }
  clearSession(psid);
  cache.del("USER_" + psid);
  
  sendQuickReplies(psid, `🛠️ TESTER MODE ACTIVATED\n------------------\n• Balance: 10,000 Pts\n• Limits: UNLOCKED`, [{ title: "📊 Dashboard", payload: "NAV_STATUS" }]);
}

async function revokeTesterAccess(psid) {
  const user = await getUserRecord(psid);
  if (!user) return sendTextMessage(psid, "❌ No profile found.");
  
  await updateCachedUser(psid, { isTester: false, points: 1.0 });
  clearSession(psid);
  cache.del("USER_" + psid);

  sendQuickReplies(psid, `🔒 TESTER MODE REVOKED\n------------------\n• Status: Regular Member\n• Points Reset: 1.0 Pt`, [{ title: "📊 Dashboard", payload: "NAV_STATUS" }]);
}

// ==========================================
// 9. DASHBOARD & UI
// ==========================================
async function displayDashboard(psid, user) {
  const stats = getInviteStats(user);
  const isTier2 = (stats.total >= TIER_2_INVITE_THRESHOLD || user.isTester);
  const vipBadge = isTier2 ? "👑 TIER 2 VIP" : "⭐ TIER 1 MEMBER";
  const monthlyCheck = await checkMonthlyVoucherLimit(psid);

  let msg = `📊 MEMBER DASHBOARD\n------------------\n👤 Member: ${user.title} ${user.lastName}\n🎖️ Tier: ${vipBadge}\n🔑 Ref Code: ${user.refCode}\n👥 Invites: ${stats.total} / ${MAX_REFERRALS_PER_USER}\n⭐ Balance: ${user.points.toFixed(1)} Pts\n📅 Monthly Limit: ${monthlyCheck.used} / ${monthlyCheck.limit}\n------------------\n📸 Product Catalog:\n${GOOGLE_PHOTOS_LINK}\n\n💬 Customer Support:\n${REAL_PERSON_CHAT_LINK}\n------------------\n`;
  if (user.points >= GIFTING_UNLOCK_THRESHOLD || user.isTester) msg += `🔓 Point Transfers Unlocked!\n`;
  else msg += `🔒 Transfers Locked (${(GIFTING_UNLOCK_THRESHOLD - user.points).toFixed(1)} pts needed).\n`;
  
  sendQuickReplies(psid, msg, getDashboardQuickReplies("NAV_STATUS"));
}

function displayInviteAndRedeemHub(psid, user) {
  const stats = getInviteStats(user);
  let instructionsMsg = `💌 INVITE & DAILY REDEEM HUB\n------------------\n🔑 Your Key: ${user.refCode}\n👥 Progress: ${stats.total} / ${MAX_REFERRALS_PER_USER} Invites\n\n🎁 REWARDS:\n• Friend Sign-Up: +2.0 Pts + 5% Voucher!\n• Missionary Sign-Up: +10.0 Pts + Unlock Daily Redeem!\n• Tier 2 Unlock: Reach 10 Invites for 1.0 Pt/day yield & Level 1-3 Commissions!\n\n⚠️ Note: If the link doesn't open on some devices, copy this whole message and paste it in the chat!\n\n✨ Share link:\n👉 ${REFERRAL_BASE_URL}?ref=${user.refCode}`;
  
  sendQuickReplies(psid, instructionsMsg, [
    { title: "🎁 Claim Daily Redeem", payload: "NAV_DAILY_REDEEM" },
    { title: "📊 Dashboard", payload: "NAV_STATUS" },
    { title: "📁 Vault", payload: "NAV_VAULT" },
    { title: "🛍️ Shop & Freebies", payload: "NAV_SHOP" }
  ]);
}

// ==========================================
// 10. DAILY REDEEM ENGINE (Tier-Balanced)
// ==========================================
async function processDailyRedeem(psid, user) {
  const now = new Date();
  if (now.getDay() === 0) return sendQuickReplies(psid, `🙏 SABBATH DAY REST\n------------------\nToday is Sunday, the Sabbath day. Return tomorrow!`, getDashboardQuickReplies("NAV_DAILY_REDEEM"));

  const stats = getInviteStats(user);
  if (stats.total < MINING_UNLOCK_INVITES && !stats.hasMissionary && !user.isTester) {
    return sendQuickReplies(psid, `🔒 DAILY REDEEM LOCKED\n------------------\n• Progress: ${stats.total} / ${MINING_UNLOCK_INVITES} Invites\n\nInvite 2 friends or 1 @missionary.org email to unlock!`, getDashboardQuickReplies("NAV_DAILY_REDEEM"));
  }

  if (!tryUserLock(psid)) return sendTextMessage(psid, "⚠️ System Busy. Please retry shortly.");
  
  try {
    const latestUser = await getUserRecord(psid);
    let isTier2 = (stats.total >= TIER_2_INVITE_THRESHOLD || stats.hasMissionary || latestUser.isTester);
    let dailyRate = isTier2 ? 1.0 : 0.5;

    const lastMinedDate = latestUser.lastMinedTimestamp ? new Date(latestUser.lastMinedTimestamp) : null;
    if (lastMinedDate && !latestUser.isTester) {
      const diffHours = (now - lastMinedDate) / (1000 * 60 * 60);
      if (diffHours < MINING_COOLDOWN_HOURS) {
        return sendQuickReplies(psid, `⏳ COOLING DOWN\n------------------\n• Remaining: ${(MINING_COOLDOWN_HOURS - diffHours).toFixed(1)} hrs`, getDashboardQuickReplies("NAV_DAILY_REDEEM"));
      }
    }

    const newBalance = latestUser.points + dailyRate;
    await updateCachedUser(psid, { points: newBalance, lastMinedTimestamp: now.toISOString() });
    
    await distributeDailyYieldCommissions(psid, dailyRate);

    sendQuickReplies(psid, `🎉 DAILY YIELD REDEEMED!\n------------------\n• Claimed: +${dailyRate.toFixed(1)} Points\n• Total Balance: ${newBalance.toFixed(1)} Points`, getDashboardQuickReplies("NAV_DAILY_REDEEM"));
    sendTextMessage(psid, `💌 WANT MORE POINTS?\nInvite friends using your key to unlock passive commissions up to Level 3!\n\n🔑 Your Invite Key: ${latestUser.refCode}\n👉 Share this link: ${REFERRAL_BASE_URL}?ref=${latestUser.refCode}`);
    
  } finally {
    releaseUserLock(psid);
  }
}

// ==========================================
// 11. LEVEL 1 TO LEVEL 3 COMMISSION ENGINE
// ==========================================
async function distributeUplineCommissions(userRefCode, newPsid, newUserEmail, initialBonus, newUserName) {
  const referrer = await getUserRecordByRefCode(userRefCode);
  if (!referrer || referrer.psid === newPsid) return;

  const isMissionary = newUserEmail && newUserEmail.toLowerCase().endsWith("@missionary.org");
  const directReward = isMissionary ? 10.0 : 2.0;

  await firebasePut(`users/${referrer.psid}/invites/${newPsid}`, newUserEmail);
  await updateCachedUser(referrer.psid, { 
    points: (referrer.points || 0) + directReward, 
    passiveRefPoints: (referrer.passiveRefPoints || 0) + directReward 
  });

  // 🔔 Referral Notification Sent to Upline
  const notif = isMissionary 
    ? `⚡ NEW REFERRAL JOINED! 🎉\n• Member: ${newUserName}\n• Type: Missionary (@missionary.org)\n• Reward: +10.0 Pts\n• 🎁 Daily Redeem UNLOCKED!` 
    : `🎉 NEW REFERRAL JOINED! 🎉\n• Member: ${newUserName}\n• Reward: +2.0 Pts\n• Total Invites: ${getInviteStats(referrer).total + 1} / ${MAX_REFERRALS_PER_USER}`;
  sendTextMessage(referrer.psid, notif);

  await processLevelCommissions(referrer.psid, directReward);
}

async function distributeDailyYieldCommissions(psid, yieldAmount) {
  await processLevelCommissions(psid, yieldAmount);
}

async function processLevelCommissions(originPsid, baseAmount) {
  const user1 = await getUserRecord(originPsid);
  if (!user1 || !user1.appliedRefCode) return;
  const upline1 = await getUserRecordByRefCode(user1.appliedRefCode);
  if (!upline1 || upline1.psid === originPsid) return;

  const l1Bonus = baseAmount * 0.10;
  await updateCachedUser(upline1.psid, { points: upline1.points + l1Bonus });
  sendTextMessage(upline1.psid, `📈 COMMISSION KICKBACK (Level 1):\n• Earned +${l1Bonus.toFixed(2)} Pts from your downline activity!`);

  if (!upline1.appliedRefCode) return;
  const upline2 = await getUserRecordByRefCode(upline1.appliedRefCode);
  if (!upline2 || upline2.psid === upline1.psid) return;

  const l2Bonus = baseAmount * 0.05;
  await updateCachedUser(upline2.psid, { points: upline2.points + l2Bonus });
  sendTextMessage(upline2.psid, `📈 COMMISSION KICKBACK (Level 2):\n• Earned +${l2Bonus.toFixed(2)} Pts from your Level 2 network!`);

  if (!upline2.appliedRefCode) return;
  const upline3 = await getUserRecordByRefCode(upline2.appliedRefCode);
  if (!upline3 || upline3.psid === upline2.psid) return;

  const l3Bonus = baseAmount * 0.025;
  await updateCachedUser(upline3.psid, { points: upline3.points + l3Bonus });
  sendTextMessage(upline3.psid, `📈 COMMISSION KICKBACK (Level 3):\n• Earned +${l3Bonus.toFixed(2)} Pts from your Level 3 network!`);
}

// ==========================================
// 12. UNIFIED SHOP & FREEBIES HUB
// ==========================================
async function displayShopAndFreebies(psid, user) {
  const monthlyCheck = await checkMonthlyVoucherLimit(psid);
  const currentMonth = new Date().toISOString().slice(0, 7);
  
  let msg = `🛍️ SHOP & FREEBIES HUB\n------------------\n💰 Balance: ${user.points.toFixed(1)} Pts\n📅 Monthly Limit: ${monthlyCheck.used} / ${monthlyCheck.limit}\n\n🏷️ PREMIUM VOUCHERS (Grind ~1 Mo):\n1️⃣ 2% Voucher — 3.0 Pts\n2️⃣ 5% Voucher — 5.0 Pts\n3️⃣ 10% Voucher — 10.0 Pts\n\n🎁 FREEBIE REWARDS (Under 299 Php | Max 2 Claims/Mo):\n`;

  for (let idx = 0; idx < FREEBIE_REWARDS.length; idx++) {
    const reward = FREEBIE_REWARDS[idx];
    const claims = await firebaseGet(`users/${psid}/monthlyFreebies/${currentMonth}/${idx}`) || 0;
    const freebieItem = CATALOG_PRODUCTS[reward.freebieKey];
    msg += `${idx + 1}️⃣ FREE ${freebieItem.name} (${freebieItem.price.toFixed(2)} Php) — ${reward.pointCost} Pts (Claims: ${claims}/${MAX_MONTHLY_FREEBIE_CLAIMS})\n`;
  }

  msg += `\nTap below to purchase or redeem:`;

  const quickReplies = [
    { title: "🎟️ Buy 2%", payload: "BUY_VOUCHER_2" },
    { title: "🎟️ Buy 5%", payload: "BUY_VOUCHER_5" },
    { title: "🎟️ Buy 10%", payload: "BUY_VOUCHER_10" }
  ];

  FREEBIE_REWARDS.forEach((reward, idx) => {
    const freebieItem = CATALOG_PRODUCTS[reward.freebieKey];
    quickReplies.push({ title: `🎁 ${freebieItem.name} (${reward.pointCost}p)`, payload: `FREEBIE_REDEEM_${idx}` });
  });

  quickReplies.push({ title: "📁 Vault", payload: "NAV_VAULT" }, { title: "📊 Dashboard", payload: "NAV_STATUS" });

  sendQuickReplies(psid, msg, quickReplies);
}

async function processVoucherPurchase(psid, itemKey, user) {
  if (!tryUserLock(psid)) return sendTextMessage(psid, "⚠️ System Busy. Please retry shortly.");
  try {
    const activeVouchers = (await getUserVouchers(psid)).filter(v => v.status === "ACTIVE");
    if (activeVouchers.length >= MAX_ACTIVE_VAULT_VOUCHERS && !user.isTester) {
      return sendQuickReplies(psid, `⚠️ Vault Full: You have 10 active vouchers. Please use an existing voucher before buying a new one!`, [
        { title: "📁 View Vault", payload: "NAV_VAULT" },
        { title: "📊 Dashboard", payload: "NAV_STATUS" }
      ]);
    }

    const item = SHOP_PRODUCTS[itemKey];
    if (!item) return sendTextMessage(psid, "❌ Selection Error.");
    
    const latestUser = await getUserRecord(psid);
    const monthlyCheck = await checkMonthlyVoucherLimit(psid);
    
    if (!monthlyCheck.allowed && !latestUser.isTester) return sendQuickReplies(psid, `⚠️ Monthly Cap Reached.`, getDashboardQuickReplies("NAV_SHOP"));
    if (latestUser.points < item.cost) return sendQuickReplies(psid, `❌ Insufficient Points: Costs ${item.cost.toFixed(1)} pts.`, getDashboardQuickReplies("NAV_SHOP"));

    await updateCachedUser(psid, { points: latestUser.points - item.cost });
    await incrementMonthlyVoucherCount(psid);

    const expiryDate = new Date();
    expiryDate.setMonth(expiryDate.getMonth() + 6);
    const expiryStr = expiryDate.toISOString().slice(0, 10);
    const voucherCode = generateBOMVoucherCode(psid);

    await addVoucherToStorage(psid, voucherCode, item.name, item.discount, item.cost, expiryStr);

    sendQuickReplies(psid, `🎉 PURCHASED!\n------------------\n• Item: ${item.name}\n• Code: ${voucherCode}\n• Balance: ${(latestUser.points - item.cost).toFixed(1)} Pts\n\nWhat would you like to do next?`, [
      { title: "🎟️ Apply Now", payload: `CONFIRM_APPLY_${voucherCode}` },
      { title: "📁 View Vault", payload: "NAV_VAULT" },
      { title: "📊 Dashboard", payload: "NAV_STATUS" }
    ]);
  } finally { releaseUserLock(psid); }
}

async function processFreebieRedeem(psid, idx, user) {
  if (!tryUserLock(psid)) return sendTextMessage(psid, "⚠️ System Busy. Please retry.");
  try {
    if (!(await checkMonthlyFreebieLimit(psid, idx)) && !user.isTester) {
      return sendQuickReplies(psid, `⚠️ Monthly Freebie Limit Reached: You can only claim this specific freebie ${MAX_MONTHLY_FREEBIE_CLAIMS} times per month!`, getDashboardQuickReplies("NAV_SHOP"));
    }

    const activeVouchers = (await getUserVouchers(psid)).filter(v => v.status === "ACTIVE");
    if (activeVouchers.length >= MAX_ACTIVE_VAULT_VOUCHERS && !user.isTester) {
      return sendQuickReplies(psid, `⚠️ Vault Full: You have 10 active vouchers. Please use an existing voucher before claiming a new freebie!`, [
        { title: "📁 View Vault", payload: "NAV_VAULT" },
        { title: "📊 Dashboard", payload: "NAV_STATUS" }
      ]);
    }

    const reward = FREEBIE_REWARDS[idx];
    if (!reward || isNaN(idx)) return sendTextMessage(psid, "❌ Selection Error.");

    const latestUser = await getUserRecord(psid);
    if (latestUser.points < reward.pointCost && !latestUser.isTester) {
      return sendQuickReplies(psid, `❌ Insufficient Points.`, getDashboardQuickReplies("NAV_SHOP"));
    }

    await updateCachedUser(psid, { points: latestUser.points - reward.pointCost });
    await incrementMonthlyFreebieCount(psid, idx);

    const expiryDate = new Date();
    expiryDate.setMonth(expiryDate.getMonth() + 2);
    const expiryStr = expiryDate.toISOString().slice(0, 10);
    const voucherCode = generateBOMVoucherCode(psid);

    const freebieType = `FREEBIE_${reward.freebieKey}_${reward.requiredKey}`;
    await addVoucherToStorage(psid, voucherCode, freebieType, 0, reward.pointCost, expiryStr);

    setSession(psid, { state: "AWAITING_CART_INPUT", targetVoucher: { code: voucherCode, type: freebieType, discount: 0, cost: reward.pointCost, expiryDate: expiryStr, status: "ACTIVE" } });

    sendImageAttachment(psid, CART_IMAGE_LINKS[0]);
    sendImageAttachment(psid, CART_IMAGE_LINKS[1]);
    sendImageAttachment(psid, CART_IMAGE_LINKS[2]);

    let catalogMenu = `🎁 FREEBIE REDEEMED & APPLIED!\n------------------\n• Free Item: ${CATALOG_PRODUCTS[reward.freebieKey].name}\n• Required Companion: ${CATALOG_PRODUCTS[reward.requiredKey].name}\n\n💡 Note: No need to select the required product since it will be added automatically!\n\n🛒 CART BUILDER:\n`;
    for (const [key, p] of Object.entries(CATALOG_PRODUCTS)) {
      catalogMenu += ` ${key}️⃣ ${p.name} — ${p.price.toFixed(2)} Php\n`;
    }
    catalogMenu += `------------------\n👉 Type "0" to proceed with just the required item + freebie.\n👉 To buy multiple quantities, write comma or space separated numbers (e.g. 5,5,1 to buy two of #5 and one of #1)!\n\n⬅️ Or type "Back" to return to the dashboard.`;

    sendQuickReplies(psid, catalogMenu, [{ title: "⬅️ Back", payload: "BACK_TO_DASHBOARD" }]);
  } finally {
    releaseUserLock(psid);
  }
}

// ==========================================
// 13. CART CHECKOUT & POS ENGINE
// ==========================================
async function promptVoucherWarning(psid, code) {
  const vouchers = await getUserVouchers(psid);
  const target = vouchers.find(v => v.code === code);
  if (!target) return sendQuickReplies(psid, "❌ Code not found in Vault.", [{ title: "📁 Open Vault", payload: "NAV_VAULT" }, { title: "📊 Dashboard", payload: "NAV_STATUS" }]);

  const todayStr = new Date().toISOString().slice(0, 10);
  if (target.status === "USED") return sendTextMessage(psid, "⚠️ Voucher already redeemed.");
  if (target.expiryDate < todayStr) return sendTextMessage(psid, "⏰ Voucher has expired.");

  sendQuickReplies(psid, `⚠️ IRREVERSIBLE VOUCHER WARNING\n------------------\nYou are about to apply voucher: ${target.code} (${formatVoucherLabel(target)}).\n\n🚨 WARNING: Applying a voucher CANNOT BE UNDONE! Once confirmed, this voucher will be permanently marked as USED and cannot be returned to your vault!\n\nAre you sure?`, [{ title: "⚠️ Confirm & Apply (Permanent)", payload: `CONFIRM_APPLY_${target.code}` }, { title: "📁 Vault", payload: "NAV_VAULT" }]);
}

async function initiateVoucherApplyFlow(psid, code, user) {
  const vDetails = await firebaseGet(`vouchers/${psid}/${code}`);
  if (!vDetails || vDetails.status === "USED") return sendTextMessage(psid, "❌ Voucher is no longer active.");

  setSession(psid, { state: "AWAITING_CART_INPUT", targetVoucher: { code: code, ...vDetails } });

  sendImageAttachment(psid, CART_IMAGE_LINKS[0]);
  sendImageAttachment(psid, CART_IMAGE_LINKS[1]);
  sendImageAttachment(psid, CART_IMAGE_LINKS[2]);

  let catalogMenu = `🛒 CART BUILDER\n------------------\n🔑 Applied Code: ${code} (${formatVoucherLabel(vDetails)})\n\nPRODUCT INDEX:\n`;
  for (const [key, p] of Object.entries(CATALOG_PRODUCTS)) catalogMenu += ` ${key}️⃣ ${p.name} — ${p.price.toFixed(2)} Php\n`;
  
  if (vDetails.type && vDetails.type.toString().startsWith("FREEBIE_")) {
    const parts = vDetails.type.toString().split("_");
    catalogMenu += `------------------\n💡 Note: No need to select the required product since it will be added automatically!\n👉 Type "0" to claim your freebie + required item (${CATALOG_PRODUCTS[parts[2]].name}).\n👉 To buy multiple quantities, write them out (e.g. 5,5,1 to buy two #5 and one #1).`;
  } else {
    catalogMenu += `------------------\n👉 Enter product numbers (e.g. 1,1,3,8 to buy multiple quantities).`;
  }
  catalogMenu += `\n\n⬅️ Or type "Back" to return to the dashboard.`;

  sendQuickReplies(psid, catalogMenu, [{ title: "⬅️ Back", payload: "BACK_TO_DASHBOARD" }]);
}

async function processCartCheckout(psid, text, user, session) {
  if (!tryUserLock(psid)) return;
  try {
    const cleanInput = text.trim();
    if (cleanInput.toUpperCase() === "BACK" || cleanInput.toUpperCase() === "BACK_TO_DASHBOARD") {
      clearSession(psid);
      return displayDashboard(psid, user);
    }

    const cartCounts = {};
    let invalidEntries = false;

    if (cleanInput !== "0") {
      cleanInput.split(/[\s,]+/).map(s => s.trim()).filter(s => s).forEach(key => { 
        if (CATALOG_PRODUCTS[key]) cartCounts[key] = (cartCounts[key] || 0) + 1; 
        else invalidEntries = true; 
      });
      
      if (invalidEntries) return sendTextMessage(psid, "❌ Input Error: Enter valid catalog numbers (1-8), type '0', or type 'Back' to return to the dashboard.");
    }

    const targetVoucher = session.targetVoucher;
    const isFreebie = !!(targetVoucher.type && targetVoucher.type.toString().startsWith("FREEBIE_"));
    let freebieKey = null;

    if (isFreebie) {
      const parts = targetVoucher.type.toString().split("_");
      freebieKey = parts[1];
      const requiredKey = parts[2];

      if (!cartCounts[requiredKey]) cartCounts[requiredKey] = 1;
      cartCounts[freebieKey] = (cartCounts[freebieKey] || 0) + 1;
    }

    let subtotal = 0.0;
    let itemizedListMsg = "";
    for (const [key, qty] of Object.entries(cartCounts)) {
      const lineTotal = CATALOG_PRODUCTS[key].price * qty;
      subtotal += lineTotal;
      itemizedListMsg += `• ${qty}x ${CATALOG_PRODUCTS[key].name} = ${lineTotal.toFixed(2)} Php${(isFreebie && key === freebieKey) ? " (FREEBIE)" : ""}\n`;
    }

    let amountSaved = isFreebie ? CATALOG_PRODUCTS[freebieKey].price : subtotal * (parseFloat(targetVoucher.discount || "0") / 100.0);
    const finalPrice = subtotal - amountSaved;

    await firebasePatch(`vouchers/${psid}/${targetVoucher.code}`, { status: "USED" });
    const txId = "REF-2026-" + Math.floor(100000 + Math.random() * 900000);
    await firebasePut(`transactions/${txId}`, { timestamp: new Date().toISOString(), psid: psid, customerName: `${user.title} ${user.lastName}`, voucherCode: targetVoucher.code, finalPaid: finalPrice, status: "COMPLETED" });

    clearSession(psid);
    sendQuickReplies(psid, `✅ DIGITAL POS RECEIPT\n------------------\n🔖 REF NO: ${txId}\n👤 MEMBER: ${user.lastName}\n🔑 VOUCHER: ${targetVoucher.code}\n\n📦 BREAKDOWN:\n${itemizedListMsg}------------------\n💰 PAYABLE TOTAL: ${finalPrice.toFixed(2)} Php\n🎉 AMOUNT SAVED: ${amountSaved.toFixed(2)} Php\n------------------\n\n📋 1️⃣ Forward this receipt to Customer Support.\n2️⃣ Provide custom engraving details.\n\n💬 Forward Here:\n${REAL_PERSON_CHAT_LINK}`, getDashboardQuickReplies("NONE"));
  } finally { releaseUserLock(psid); }
}

async function addVoucherToStorage(psid, voucherCode, type, discount, cost, expiryDateStr) { 
  await firebasePut(`vouchers/${psid}/${voucherCode}`, { type: type, discount: discount, cost: cost, expiryDate: expiryDateStr, status: "ACTIVE" }); 
}

async function getUserVouchers(psid) {
  const data = await firebaseGet(`vouchers/${psid}`);
  if (!data) return [];
  return Object.entries(data).map(([code, details]) => ({ code: code, ...details }));
}

function formatVoucherLabel(v) {
  if (v.type && v.type.toString().startsWith("FREEBIE_")) return `FREE ${CATALOG_PRODUCTS[v.type.split("_")[1]].name}`;
  return `${v.type} (${v.discount}% Off)`;
}

// ==========================================
// 14. PROMO CODES & GIFTING
// ==========================================
async function processRedeemCode(psid, promoCode, user) {
  if (!tryUserLock(psid)) return;
  try {
    const codeRecord = await firebaseGet(`redeem_codes/${promoCode}`);
    if (!codeRecord || codeRecord.status !== "ACTIVE") return sendTextMessage(psid, "❌ Invalid or inactive promo code.");
    if ((codeRecord.timesRedeemed || 0) >= codeRecord.limit) return sendTextMessage(psid, "⚠️ Maximum limit reached for code.");
    if (await firebaseGet(`users/${psid}/redeemed_promos/${promoCode}`)) return sendTextMessage(psid, "⚠️ Code already claimed.");

    await firebasePut(`users/${psid}/redeemed_promos/${promoCode}`, true);
    await firebasePatch(`redeem_codes/${promoCode}`, { timesRedeemed: (codeRecord.timesRedeemed || 0) + 1 });

    const newBalance = user.points + parseFloat(codeRecord.value || 0);
    await updateCachedUser(psid, { points: newBalance });

    sendQuickReplies(psid, `🎉 CODE CLAIMED!\n------------------\n• Code: ${promoCode}\n• Reward: +${parseFloat(codeRecord.value || 0).toFixed(1)} Pts\n• Balance: ${newBalance.toFixed(1)} Pts`, getDashboardQuickReplies("NONE"));
  } finally { releaseUserLock(psid); }
}

async function handleGiftingCommand(psid, text, session) {
  const user = await getUserRecord(psid);
  if (user.points < GIFTING_UNLOCK_THRESHOLD && !user.isTester) return sendQuickReplies(psid, `🔒 Locked: Point transfers require ${GIFTING_UNLOCK_THRESHOLD} pts.`, getDashboardQuickReplies("NONE"));
  setSession(psid, { state: "AWAITING_GIFT_DETAILS" });
  sendQuickReplies(psid, `🎁 POINT TRANSFERS\nEnter recipient Ref Code and amount:\nExample: KJL482 5`, [{ title: "📊 Dashboard", payload: "NAV_STATUS" }]);
}

async function processGiftSubmission(psid, text, session) {
  if (!tryUserLock(psid)) return;
  try {
    const parts = text.trim().split(/\s+/);
    if (parts.length < 2) return sendQuickReplies(psid, "❌ Format Error. Example: KJL482 5", [{ title: "📊 Dashboard", payload: "NAV_STATUS" }]);

    const targetRefCode = parts[0].toUpperCase();
    const giftAmount = parseFloat(parts[1]);
    const gifter = await getUserRecord(psid);

    if (gifter.points < giftAmount && !gifter.isTester) {
      clearSession(psid);
      return sendQuickReplies(psid, "❌ Balance Error: Requested points exceed balance.", getDashboardQuickReplies("NONE"));
    }

    const recipient = await getUserRecordByRefCode(targetRefCode);
    if (!recipient || recipient.psid === psid) return sendQuickReplies(psid, "❌ Invalid target referral code.", getDashboardQuickReplies("NONE"));

    if (!tryUserLock(recipient.psid)) return sendQuickReplies(psid, "⚠️ Recipient account is currently busy processing another action. Please retry.", getDashboardQuickReplies("NONE"));
    try {
      await updateCachedUser(gifter.psid, { points: gifter.points - giftAmount });
      await updateCachedUser(recipient.psid, { points: (recipient.points || 0) + giftAmount, giftedPointsReceived: (recipient.giftedPointsReceived || 0) + giftAmount });
      
      await processLevelCommissions(recipient.psid, giftAmount);
    } finally { releaseUserLock(recipient.psid); }

    clearSession(psid);
    sendQuickReplies(psid, `🎁 Sent ${giftAmount} pts to ${targetRefCode}.`, getDashboardQuickReplies("NONE"));
    sendTextMessage(recipient.psid, `🎁 Received ${giftAmount} points from a friend!`);
  } finally { releaseUserLock(psid); }
}

// ==========================================
// 15. VAULT DISPLAY
// ==========================================
async function displayVoucherStorage(psid) {
  const vouchers = await getUserVouchers(psid);
  if (vouchers.length === 0) return sendQuickReplies(psid, "📁 VOUCHER VAULT\n------------------\nYour vault is currently empty.", [{ title: "🛍️ Shop & Freebies", payload: "NAV_SHOP" }, { title: "📊 Dashboard", payload: "NAV_STATUS" }]);

  const todayStr = new Date().toISOString().slice(0, 10);
  let msg = `📁 VOUCHER VAULT\n------------------\n`;
  const quickReplies = [];

  vouchers.forEach((v, index) => {
    let statusIcon = (v.status === "USED") ? "❌ REDEEMED" : (v.expiryDate < todayStr) ? "⏰ EXPIRED" : "✅ ACTIVE";
    msg += `[${index + 1}] ${v.code} — ${formatVoucherLabel(v)} (${statusIcon})\n`;
    
    if (v.status === "ACTIVE" && v.expiryDate >= todayStr && quickReplies.length < 10) {
      quickReplies.push({ title: `🎟️ Apply ${v.code}`, payload: `APPLY_PROMPT_${v.code}` });
    }
  });

  quickReplies.push({ title: "🛍️ Shop & Freebies", payload: "NAV_SHOP" });
  quickReplies.push({ title: "📊 Dashboard", payload: "NAV_STATUS" });
  sendQuickReplies(psid, msg, quickReplies);
}

// ==========================================
// 16. META GRAPH API (Text, Quick Replies & Images)
// ==========================================
function sendTextMessage(psid, text) { callSendAPI({ recipient: { id: psid }, message: { text: text } }); }
function sendQuickReplies(psid, text, qr) { callSendAPI({ recipient: { id: psid }, message: { text: text, quick_replies: qr.map(q => ({ content_type: "text", title: q.title, payload: q.payload })) } }); }
function sendImageAttachment(psid, imageUrl) { callSendAPI({ recipient: { id: psid }, message: { attachment: { type: "image", payload: { url: imageUrl, reusable: true } } } }); }

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

// ==========================================
// 17. INITIALIZATION APP START
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 MissionPerks Node.js server running on port ${PORT}`);
});