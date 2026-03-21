// server.js - Updated with Google OAuth for tools (Gmail, Calendar, Docs, Sheets)
import { google } from "googleapis";
import { config } from "dotenv";
config();

// Early env check
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("Environment variables loaded:");
console.log("GOOGLE_CLIENT_ID:", process.env.GOOGLE_CLIENT_ID ? process.env.GOOGLE_CLIENT_ID.substring(0, 10) + "..." : "MISSING / EMPTY");
console.log("GOOGLE_CLIENT_SECRET:", process.env.GOOGLE_CLIENT_SECRET ? "Yes (present)" : "MISSING ← REQUIRED for OAuth");
console.log("RAZORPAY_KEY_ID:", process.env.RAZORPAY_KEY_ID ? process.env.RAZORPAY_KEY_ID.substring(0, 12) + "..." : "MISSING");
console.log("RAZORPAY_KEY_SECRET:", process.env.RAZORPAY_KEY_SECRET ? "Yes (length: " + process.env.RAZORPAY_KEY_SECRET.length + ")" : "MISSING");
console.log("TAVILY_API_KEY:", process.env.TAVILY_API_KEY ? "Yes" : "MISSING");
console.log("PORT:", process.env.PORT || "8080 (default)");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

// Imports
import express from "express";
import cors from "cors";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import { v4 as uuidv4 } from "uuid";
import { OAuth2Client } from "google-auth-library";
import { existsSync } from "fs";
import Razorpay from "razorpay";
import crypto from "crypto";
import multer from "multer";
import XLSX from "xlsx";

// Prisma
import prismaPkg from '@prisma/client';
const { PrismaClient } = prismaPkg;
const prisma = new PrismaClient();

// Razorpay Instance
const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Google OAuth Scopes for different tools
const TOOL_SCOPES = {
  gmail: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.settings.basic'
  ],
  calendar: [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events'
  ],
  docs: [
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/drive.file'
  ],
  sheets: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file'
  ]
};

const app = express();
const port = process.env.PORT || 8080;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});
const studyPlanSchedules = new Map();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── MIDDLEWARE ────────────────────────────────────────────────────────────
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:8080', 'https://web-explore-651093528570.asia-southeast1.run.app'],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id']
}));

app.options('*', cors());

app.use(express.json());
app.use(express.static(path.join(__dirname, "dist"), { index: false }));
app.use("/assets", express.static(path.join(__dirname, "public"), { index: false }));

const SUPPORTED_MODELS = [
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-4-turbo",
];

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function sanitizeModel(model) {
  return SUPPORTED_MODELS.includes(model) ? model : "gpt-4o-mini";
}

function createQuerySlug(query) {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 50);
}

const PERSONAL_EMAIL_PROVIDERS = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "protonmail.com",
  "aol.com",
  "zoho.com"
]);

function extractEmailAddress(fromHeader = "") {
  const match = fromHeader.match(/<([^>]+)>/);
  if (match?.[1]) return match[1].trim().toLowerCase();
  return (fromHeader || "").trim().toLowerCase();
}

function classifySenderType(email = "") {
  const domain = email.split("@")[1] || "";
  if (!domain) return "individual";
  return PERSONAL_EMAIL_PROVIDERS.has(domain) ? "individual" : "enterprise";
}

function getHeader(headers = [], key = "") {
  return headers.find((h) => h.name?.toLowerCase() === key.toLowerCase())?.value || "";
}

// Simple in-memory per-user throttle (5 sec cooldown)
const userLastRequest = new Map();

// ── Usage & Plan limit middleware ─────────────────────────────────────────
async function checkUsageAndPlan(req, res, next) {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: "Please login first" });

  const now = Date.now();
  const last = userLastRequest.get(userId) || 0;
  if (now - last < 5000) {
    return res.status(429).json({ 
      error: "Too many requests. Please wait a few seconds.",
      retryAfter: "5s"
    });
  }
  userLastRequest.set(userId, now);

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { currentPlan: true },
    });

    if (!user) return res.status(401).json({ error: "User not found" });
    if (!user.currentPlan) return res.status(403).json({ error: "No active plan found" });

    const plan = user.currentPlan;
    const nowDate = new Date();

    const isPaidPlan = plan.name !== "FREE";
    const isExpired = isPaidPlan && user.subscriptionEnd && nowDate >= user.subscriptionEnd;

    if (isExpired) {
      return res.status(402).json({
        error: "Your paid plan has expired. Please choose a new plan.",
        expired: true,
        upgradeNeeded: true,
        redirectTo: "/pricing"
      });
    }

    const freePlan = await prisma.plan.findFirst({ where: { name: "FREE" } });
    if (!freePlan) throw new Error("FREE plan not found");
    const FREE_LIMIT = freePlan.usageLimit;

    const lifetimeUsage = await prisma.usageLog.aggregate({
      where: { userId, createdAt: { gte: user.createdAt } },
      _sum: { tokensUsed: true },
    });
    const totalTokensUsedLifetime = lifetimeUsage._sum.tokensUsed || 0;
    const freeRemaining = Math.max(0, FREE_LIMIT - totalTokensUsedLifetime);

    let paidUsed = 0;
    let paidLimit = plan.usageLimit;

    if (isPaidPlan && user.subscriptionStart) {
      const periodUsage = await prisma.usageLog.aggregate({
        where: { userId, createdAt: { gte: user.subscriptionStart } },
        _sum: { tokensUsed: true },
      });
      paidUsed = periodUsage._sum.tokensUsed || 0;
    }

    const paidExhausted = isPaidPlan && paidUsed >= paidLimit;
    const freeExhausted = freeRemaining <= 0;

    if (freeExhausted && !isPaidPlan) {
      return res.status(429).json({
        error: "Your FREE plan limit has been reached. Upgrade to continue.",
        upgradeNeeded: true,
        redirectTo: "/pricing"
      });
    }

    if (paidExhausted) {
      return res.status(429).json({
        error: "Your paid plan limit has been reached.",
        upgradeNeeded: true,
        redirectTo: "/pricing"
      });
    }

    req.user = user;
    req.userPlan = plan;
    next();
  } catch (err) {
    console.error("Plan check error:", err);
    res.status(500).json({ error: "Server error during plan check" });
  }
}

// ── Razorpay Order Creation Endpoint ───────────────
app.post("/api/create-razorpay-order", async (req, res) => {
  const userId = req.headers["x-user-id"];
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized - user ID missing" });
  }

  const { planName } = req.body;
  if (!planName || !["PRO", "ULTRA"].includes(planName)) {
    return res.status(400).json({ error: "Invalid plan name. Must be PRO or ULTRA" });
  }

  const planAmounts = {
    PRO: 999 * 100,
    ULTRA: 3999 * 100,
  };

  const amount = planAmounts[planName];
  if (!amount) {
    return res.status(400).json({ error: "Amount not configured for this plan" });
  }

  const shortUser = userId.substring(0, 8);
  const shortTime = Date.now().toString().slice(-6);
  const receipt = `rcpt_${planName.toLowerCase()}_${shortUser}_${shortTime}`;

  console.log(`Generated receipt: ${receipt} (length: ${receipt.length})`);

  try {
    const order = await razorpayInstance.orders.create({
      amount: amount,
      currency: "INR",
      receipt: receipt,
      notes: {
        userId: userId,
        plan: planName,
      },
    });

    console.log(`[Razorpay] Order created: ${order.id} | Plan: ${planName} | Amount: ₹${amount / 100} | Receipt: ${receipt}`);

    res.json({
      order: {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
      },
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error("[Razorpay Order Creation Failed]:", err);
    res.status(500).json({
      error: "Failed to create Razorpay order",
      message: err.message || "Unknown error",
      code: err.code || err.error?.code || "unknown",
    });
  }
});

// ── Razorpay Payment Verification Endpoint ────────────────────────────────
app.post("/api/verify-razorpay-payment", async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, planName } = req.body;
  const userId = req.headers["x-user-id"];

  if (!userId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ success: false, error: "Missing payment details" });
  }

  try {
    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, error: "Invalid signature" });
    }

    const now = new Date();
    const endDate = new Date(now);
    endDate.setMonth(endDate.getMonth() + 1);

    await prisma.user.update({
      where: { id: userId },
      data: {
        currentPlan: { connect: { name: planName } },
        subscriptionStart: now,
        subscriptionEnd: endDate,
      },
    });

    console.log(`[Razorpay] Payment verified & plan updated for user ${userId} → ${planName}`);

    res.json({ success: true, message: "Payment verified and plan upgraded" });
  } catch (err) {
    console.error("[Payment Verification Failed]:", err);
    res.status(500).json({ success: false, error: "Verification failed" });
  }
});

// ── Google Login ────────────────────────────────────────────────────────────
app.post("/api/auth/google", async (req, res) => {
  const { token } = req.body;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    let user = await prisma.user.findUnique({
      where: { email: payload.email },
      include: { currentPlan: true },
    });

    if (!user) {
      const freePlan = await prisma.plan.findUnique({
        where: { name: "FREE" },
      });

      if (!freePlan) {
        console.error("FREE plan not found in database!");
        return res.status(500).json({ error: "Server configuration error: FREE plan missing" });
      }

      user = await prisma.user.create({
        data: {
          email: payload.email,
          name: payload.name,
          picture: payload.picture,
          currentPlan: {
            connect: { id: freePlan.id },
          },
          subscriptionStart: new Date(),
          subscriptionEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
        include: { currentPlan: true },
      });

      console.log(`New user created with FREE plan: ${user.email}`);
    }

    res.json({ user });
  } catch (err) {
    console.error("Google auth error:", err);
    res.status(401).json({ error: "Authentication failed" });
  }
});

// ── Google Tool Connect (OAuth flow for specific tools) ────────────────────
app.get("/api/google/auth", async (req, res) => {
  const userId = req.headers["x-user-id"];
  const tool = req.query.tool?.toLowerCase();

  if (!userId) return res.status(401).json({ error: "Unauthorized - user ID missing" });
  if (!tool || !TOOL_SCOPES[tool]) {
    return res.status(400).json({ error: "Invalid or missing tool parameter" });
  }

  try {
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    const oauth2Client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    const authorizeUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: TOOL_SCOPES[tool],
      state: JSON.stringify({ userId, tool }),
      prompt: 'consent',
    });

    res.json({ authUrl: authorizeUrl });
  } catch (err) {
    console.error("Failed to generate Google auth URL:", err);
    res.status(500).json({ error: "Failed to generate authorization URL" });
  }
});

// ── Google Tool Disconnect (Clear stored tokens) ──────────────────────────
app.post("/api/google/disconnect", async (req, res) => {
  const userId = req.headers["x-user-id"];
  const tool = req.query.tool?.toLowerCase();

  if (!userId) return res.status(401).json({ error: "Unauthorized - user ID missing" });
  if (!tool || !TOOL_SCOPES[tool]) {
    return res.status(400).json({ error: "Invalid or missing tool parameter" });
  }

  const tokenField = `${tool}Tokens`;

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { [tokenField]: null }
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Failed to disconnect tool:", err);
    res.status(500).json({ error: "Failed to disconnect tool" });
  }
});

// ── Google OAuth Callback ─────────────────────────────────────────────────
app.get("/api/google/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.status(400).send(`<h1>Authentication failed: ${error}</h1>`);
  }

  if (!code) {
    return res.status(400).send("<h1>No authorization code received</h1>");
  }

  let parsedState;
  try {
    parsedState = JSON.parse(state);
  } catch {
    return res.status(400).send("<h1>Invalid state parameter</h1>");
  }

  const { userId, tool } = parsedState;

  try {
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    const oauth2Client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    const { tokens } = await oauth2Client.getToken(code);

    // Update user with tool-specific tokens
    const updateData = {};
    updateData[`${tool}Tokens`] = tokens;

    await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    // Success page with auto-close for popup
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Connected Successfully</title></head>
      <body style="font-family:sans-serif; text-align:center; padding:80px 20px;">
        <h1 style="color:#10b981;">${tool.toUpperCase()} Connected Successfully!</h1>
        <p>You can now close this window and return to the app.</p>
        <script>
          if (window.opener) {
            window.opener.postMessage({ success: true, tool: "${tool}" }, "*");
          }
          setTimeout(() => window.close(), 3000);
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    res.status(500).send("<h1>Authentication failed. Please try again or contact support.</h1>");
  }
});

// ── Generate (AI Direct) ──────────────────────────────────────────────────
app.post("/api/generate", checkUsageAndPlan, async (req, res) => {
  const { prompt, model: requestedModel } = req.body;
  const model = sanitizeModel(requestedModel);

  if (!prompt) return res.status(400).json({ error: "Prompt required" });

  try {
    const { text } = await generateText({
      model: openai(model),
      prompt,
    });

    let suggestions = [];
    try {
      const sugRes = await generateText({
        model: openai(model),
        prompt: `Generate 3 intelligent follow-up questions.\n\nAnswer: ${text}\n\nOnly list the 3 questions, one per line.`,
      });
      suggestions = sugRes.text
        .split(/\n+/)
        .map(q => q.trim())
        .filter(q => q && !q.match(/^\d+\./))
        .slice(0, 3);
    } catch {}

    const tokens = Math.ceil((prompt.length + text.length) / 4) + 300;

    await prisma.usageLog.create({
      data: {
        userId: req.user.id,
        queryType: "generate",
        tokensUsed: tokens,
        modelUsed: model,
        success: true,
        inputText: prompt,
      },
    });

    await prisma.queryHistory.create({
      data: {
        userId: req.user.id,
        inputText: prompt,
        queryType: "generate",
      },
    });

    res.json({ text, suggestions, modelUsed: model });
  } catch (err) {
    console.error("Generate error:", err);
    res.status(500).json({ error: "Generation failed" });
  }
});

// ── Web Search ─────────────────────────────────────────────────────────────
app.post("/api/search", checkUsageAndPlan, async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "Query required" });

    let searchModel = "gpt-4o-mini";
    if (req.userPlan.name === "PRO") searchModel = "gpt-4o";
    if (req.userPlan.name === "ULTRA") searchModel = "gpt-4o";

    const tavilyRes = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        search_depth: "basic",
        max_results: req.userPlan.name === "ULTRA" ? 8 : 5,
      }),
    });

    if (!tavilyRes.ok) throw new Error(`Tavily failed: ${tavilyRes.status}`);

    const { results } = await tavilyRes.json();

    const sources = results.map((r, i) => `[${i+1}] ${r.title} (${r.url})`).join("\n");
    const context = results.map((r, i) => `[${i+1}] ${r.content}`).join("\n\n");

    const prompt = `Answer concisely using sources. Cite like [1], [2].\nQuestion: ${query}\n\nSources:\n${context}\n\nCitations:\n${sources}\n\nAnswer:`;

    let answer = "";
    try {
      const genRes = await generateText({
        model: openai(searchModel),
        prompt,
      });
      answer = genRes.text;
    } catch (err) {
      if (err?.status === 429 || err?.code === 'rate_limit_exceeded') {
        return res.status(429).json({
          error: "OpenAI rate limit reached. Try again in a minute.",
          retryAfter: "60s"
        });
      }
      throw err;
    }

    let suggestions = [];
    try {
      const sugRes = await generateText({
        model: openai(searchModel),
        prompt: `Suggest 3 smart follow-up questions based on this answer.\nAnswer: ${answer}\n\nList only the questions, one per line.`,
      });
      suggestions = sugRes.text.split(/\n+/).map(q => q.trim()).filter(Boolean).slice(0, 3);
    } catch {}

    const querySlug = createQuerySlug(query);
    const finalId = uuidv4();

    const tokens = Math.ceil((query.length + answer.length) / 4) + 500;

    await prisma.usageLog.create({
      data: {
        userId: req.user.id,
        queryType: "search",
        tokensUsed: tokens,
        modelUsed: searchModel,
        requestId: finalId,
        success: true,
        inputText: query,
      },
    });

    await prisma.queryHistory.create({
      data: {
        userId: req.user.id,
        inputText: query,
        queryType: "search",
      },
    });

    res.json({
      summary: answer,
      citations: results.map((r, i) => ({ id: i+1, title: r.title, url: r.url })),
      suggestions,
      querySlug,
      finalId,
      modelUsed: searchModel
    });
  } catch (err) {
    console.error("Search error:", err.message);
    res.status(500).json({ error: "Search failed" });
  }
});

app.get("/api/calendar/today-meetings", async (req, res) => {
  const userId = req.headers["x-user-id"];
  const focus = String(req.query.focus || "").trim().toLowerCase();
  const rawPastHours = Number(req.query.pastHours);
  const rawAheadHours = Number(req.query.aheadHours);
  const pastHours = Number.isFinite(rawPastHours) ? Math.min(Math.max(rawPastHours, 0), 12) : 2;
  const aheadHours = Number.isFinite(rawAheadHours) ? Math.min(Math.max(rawAheadHours, 1), 168) : 24;
  if (!userId) {
    return res.status(401).json({ error: "User not authenticated" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { calendarTokens: true }
    });

    if (!user?.calendarTokens) {
      return res.status(400).json({ error: "Please connect Google Calendar first" });
    }

    const oauth2Client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials(user.calendarTokens);

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const now = new Date();
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

    const nowInIST = new Date(now.getTime() + IST_OFFSET_MS);
    const startOfTodayIST = new Date(nowInIST);
    startOfTodayIST.setUTCHours(0, 0, 0, 0);

    // Recent + ahead window (configurable):
    // start = max(start of today IST, now - pastHours)
    // end = now + aheadHours
    const recentStart = new Date(now.getTime() - pastHours * 60 * 60 * 1000);
    const timeMinDate = recentStart > startOfTodayIST ? recentStart : startOfTodayIST;
    const timeMaxDate = new Date(now.getTime() + aheadHours * 60 * 60 * 1000);

    const timeMin = timeMinDate.toISOString();
    const timeMax = timeMaxDate.toISOString();

    console.log("[DEBUG] Server current time (UTC):", now.toISOString());
    console.log("[DEBUG] timeMin:", timeMin);
    console.log("[DEBUG] timeMax:", timeMax);

    const params = {
      calendarId: 'primary',
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 50,
      showDeleted: false,
      timeZone: 'Asia/Kolkata',  // Helps include all-day events correctly
      timeMin,
      timeMax,
    };

    const response = await calendar.events.list(params);

    const events = response.data.items || [];
    console.log("[DEBUG] Events count:", events.length);

    if (events.length > 0) {
      console.log("[DEBUG] First event sample:", JSON.stringify(events[0], null, 2));
    }

    if (events.length === 0) {
      return res.json({
        message: `No events found in the configured window (last ${pastHours} hours + next ${aheadHours} hours).`,
        debug: {
          count: 0,
          timeMin,
          timeMax,
          pastHours,
          aheadHours,
          note: "If 0 events but you see them in web → re-authorize with calendar.readonly scope"
        }
      });
    }

    // IST offset for display (since API returns UTC dateTime)
    const IST_DISPLAY_OFFSET_MS = 5.5 * 60 * 60 * 1000;

    const buildEventLine = (e) => {
      let time = "All Day";

      if (e.start?.dateTime) {
        const utcDate = new Date(e.start.dateTime);
        const istDate = new Date(utcDate.getTime() + IST_DISPLAY_OFFSET_MS);
        time = istDate.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });
      } else if (e.start?.date) {
        time = "All Day";
      }

      const meetingLink = e.hangoutLink || e.htmlLink || "";
      const location = e.location || "";
      const attendees = (e.attendees || [])
        .map((a) => a.email || a.displayName)
        .filter(Boolean)
        .slice(0, 5)
        .join(", ");
      const description = (e.description || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180);

      const extra = [
        location ? `Location: ${location}` : "",
        attendees ? `Attendees: ${attendees}` : "",
        meetingLink ? `Link: ${meetingLink}` : "",
        description ? `Notes: ${description}` : ""
      ].filter(Boolean).join(" | ");

      return `📅 ${e.summary || "(No title)"} at ${time} (ID: ${e.id})${extra ? ` | ${extra}` : ""}`;
    };

    const matchesFocus = (e) => {
      if (!focus) return true;

      const haystack = [
        e.summary || "",
        e.description || "",
        e.location || "",
        e.hangoutLink || "",
        e.htmlLink || "",
        ...(e.attendees || []).map((a) => `${a.email || ""} ${a.displayName || ""}`)
      ].join(" ").toLowerCase();

      return haystack.includes(focus);
    };

    const matchedEvents = focus ? events.filter(matchesFocus) : events;
    const formatted = matchedEvents.map(buildEventLine).join("\n");

    if (focus && matchedEvents.length === 0) {
      const fallback = events.slice(0, 2).map(buildEventLine).join("\n");
      return res.json({
        message: `Focus topic: ${focus}\n\nNo direct calendar match found for this focus in today's events.\n\nClosest items from today:\n${fallback || "No events available."}`,
        debug: { count: events.length, matchedCount: 0, focus }
      });
    }

    res.json({
      message: focus
        ? `Focused calendar events for "${focus}":\n\n${formatted}`
        : `Aaj ki meetings Google Calendar se:\n\n${formatted}`,
      debug: { count: events.length, matchedCount: matchedEvents.length, focus, pastHours, aheadHours, timeMin, timeMax }
    });

  } catch (err) {
    console.error("[ERROR] Calendar API failed:", err.message);
    if (err.response?.data) {
      console.error("[ERROR] Google response:", JSON.stringify(err.response.data, null, 2));
    }
    res.status(500).json({
      error: "Failed to fetch meetings",
      details: err.message,
      googleError: err.response?.data?.error?.message || "No details"
    });
  }
});

// ── Automate Workflows Endpoint (NO usage check) ──────────────────────────
app.post("/api/automate-workflows", async (req, res) => {
  const userId = req.headers["x-user-id"];

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized - user ID missing" });
  }

  try {
    console.log(`[Automate] Workflow dashboard access from user ${userId}`);

    res.json({
      success: true,
      message: "Workflow dashboard ready",
      redirectTo: "/workflows"
    });
  } catch (err) {
    console.error("[Automate Workflows Error]:", err);
    res.status(500).json({
      error: "Failed to access workflow dashboard"
    });
  }
});

app.post("/api/workflows/gmail-catchup/start", async (req, res) => {
  const userId = req.headers["x-user-id"];
  const catchupTopic = String(req.body?.catchup_topic || "").trim();
  const gmailLabel = String(req.body?.gmail_label || "").trim();
  const rawLookbackDays = Number(req.body?.lookback_days);
  const lookbackDays = Number.isFinite(rawLookbackDays)
    ? Math.min(Math.max(rawLookbackDays, 1), 365)
    : 30;

  if (!userId) {
    return res.status(401).json({ error: "User not authenticated" });
  }

  if (!catchupTopic) {
    return res.status(400).json({ error: "catchup_topic is required" });
  }

  if (!gmailLabel) {
    return res.status(400).json({ error: "gmail_label is required" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { gmailTokens: true }
    });

    if (!user?.gmailTokens) {
      return res.status(400).json({ error: "Please connect Gmail first" });
    }

    const oauth2Client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials(user.gmailTokens);

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    // Try strict-to-relaxed Gmail queries so user-entered label/topic combinations still work.
    const relaxedDays = Math.min(lookbackDays * 3, 365);
    const broadDays = Math.min(lookbackDays * 6, 365);
    const searchAttempts = [
      `in:anywhere newer_than:${lookbackDays}d label:"${gmailLabel}" "${catchupTopic}"`,
      `in:anywhere newer_than:${relaxedDays}d "${catchupTopic}" "${gmailLabel}"`,
      `in:anywhere newer_than:${broadDays}d "${catchupTopic}"`
    ];

    let messageRefs = [];
    let usedQuery = "";

    for (const q of searchAttempts) {
      const listResp = await gmail.users.messages.list({
        userId: "me",
        q,
        maxResults: 50
      });

      const found = listResp.data.messages || [];
      if (found.length > 0) {
        messageRefs = found;
        usedQuery = q;
        break;
      }
    }

    if (messageRefs.length === 0) {
      return res.json({
        success: true,
        summary: `No matching emails found for topic \"${catchupTopic}\" in the last ${lookbackDays} days. I checked label \"${gmailLabel}\" first, then broader Gmail search.`
      });
    }

    const detailedMessages = await Promise.all(
      messageRefs.map(async (m) => {
        const full = await gmail.users.messages.get({
          userId: "me",
          id: m.id,
          format: "metadata",
          metadataHeaders: ["From", "Subject", "Date"]
        });

        const headers = full.data.payload?.headers || [];
        const from = getHeader(headers, "From");
        const subject = getHeader(headers, "Subject") || "(No Subject)";
        const date = getHeader(headers, "Date");
        return {
          id: full.data.id,
          from,
          subject,
          date,
          snippet: (full.data.snippet || "").replace(/\s+/g, " ").trim()
        };
      })
    );

    const topicLC = catchupTopic.toLowerCase();
    const keywordLC = gmailLabel.toLowerCase();
    const filtered = detailedMessages
      .filter((m) => {
        const hay = `${m.subject} ${m.snippet} ${m.from}`.toLowerCase();
        return hay.includes(topicLC) || hay.includes(keywordLC);
      })
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    if (filtered.length === 0) {
      return res.json({
        success: true,
        fetchedCount: detailedMessages.length,
        matchedCount: 0,
        summary: `Fetched ${detailedMessages.length} emails (query: ${usedQuery || "fallback"}), but none were clearly related to \"${catchupTopic}\" or \"${gmailLabel}\".`
      });
    }

    const digestLines = filtered.slice(0, 12).map((m, idx) => (
      `${idx + 1}. From: ${m.from}\nSubject: ${m.subject}\nDate: ${m.date}\nSnippet: ${m.snippet}`
    )).join("\n\n");

    let summary;
    try {
      const aiResponse = await generateText({
        model: openai("gpt-4o-mini"),
        maxTokens: 500,
        prompt: `You are an email ops assistant. Create a concise catch-up summary from recent Gmail messages.
      Topic to track: ${catchupTopic}
      Gmail label: ${gmailLabel}

      Emails:\n${digestLines}

      Output format:
      1) Top Updates (5 bullets max)
      2) Action Items (3 bullets max)
      3) Follow-up Priority (High/Medium/Low list)`
      });
      summary = aiResponse.text;
    } catch (aiErr) {
      console.error("[Gmail Catch-up] AI summarization failed:", aiErr.message);
      summary = [
        `Gmail catch-up for topic \"${catchupTopic}\" in label \"${gmailLabel}\":`,
        ...filtered.slice(0, 8).map((m) => `- ${m.subject} (${m.from})`)
      ].join("\n");
    }

    res.json({
      success: true,
      usedQuery,
      lookbackDays,
      fetchedCount: detailedMessages.length,
      matchedCount: filtered.length,
      summary,
      emails: filtered.slice(0, 5)
    });
  } catch (err) {
    console.error("[Gmail Catch-up Error]:", err.message);
    if (err.response?.status === 401) {
      return res.status(401).json({ error: "Gmail session expired. Please reconnect Gmail." });
    }
    res.status(500).json({
      error: "Failed to fetch Gmail catch-up",
      details: err.message
    });
  }
});

app.post("/api/workflows/research-competitors/start", async (req, res) => {
  const userId = req.headers["x-user-id"];
  const competitorNames = String(req.body?.competitor_names || "").trim();

  if (!userId) {
    return res.status(401).json({ error: "User not authenticated" });
  }

  if (!competitorNames) {
    return res.status(400).json({ error: "competitor_names is required" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { docsTokens: true, currentPlan: true }
    });

    if (!user?.docsTokens) {
      return res.status(400).json({ error: "Please connect Google Docs first" });
    }

    const searchQuery = `Research competitors ${competitorNames}. Include strengths, weaknesses, pricing, recent news, and future plans with reliable sources.`;

    const tavilyRes = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: searchQuery,
        search_depth: "advanced",
        max_results: 8,
      }),
    });

    if (!tavilyRes.ok) throw new Error(`Tavily failed: ${tavilyRes.status}`);

    const { results = [] } = await tavilyRes.json();

    const sources = results.map((r, i) => `[${i + 1}] ${r.title} (${r.url})`).join("\n");
    const context = results.map((r, i) => `[${i + 1}] ${r.content}`).join("\n\n");

    const modelForReport = "gpt-4o-mini";
    const reportPrompt = `Create a concise competitor analysis report using the sources below.
Competitors: ${competitorNames}

Required sections:
1) Strengths
2) Weaknesses
3) Pricing
4) Recent News
5) Possible Future Plans

Rules:
- Use bullet points.
- Mention uncertainty when data is missing.
- Add inline citations like [1], [2].

Research Context:
${context}

Citations:
${sources}

Output:`;

    const aiRes = await generateText({
      model: openai(modelForReport),
      prompt: reportPrompt,
    });

    const reportText = aiRes.text || "No report generated.";
    const fullDocText = `Competitor Analysis: ${competitorNames}\n\n${reportText}\n\nSources:\n${sources || "No sources available."}`;

    const oauth2Client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials(user.docsTokens);

    const docs = google.docs({ version: "v1", auth: oauth2Client });

    const created = await docs.documents.create({
      requestBody: {
        title: `Competitor Analysis - ${competitorNames}`
      }
    });

    const documentId = created.data.documentId;

    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index: 1 },
              text: fullDocText
            }
          }
        ]
      }
    });

    const docUrl = `https://docs.google.com/document/d/${documentId}/edit`;

    res.json({
      success: true,
      docUrl,
      summary: reportText,
      sourcesCount: results.length
    });
  } catch (err) {
    console.error("[Research Competitors Error]:", err.message);
    res.status(500).json({
      error: "Failed to generate competitor report in Google Docs",
      details: err.message
    });
  }
});

app.post("/api/workflows/pitch-emails/upload-start", upload.single("investors_file"), async (req, res) => {
  const userId = req.headers["x-user-id"];
  const startupName = String(req.body?.startup_name || "").trim();
  const file = req.file;

  if (!userId) {
    return res.status(401).json({ error: "User not authenticated" });
  }

  if (!startupName) {
    return res.status(400).json({ error: "startup_name is required" });
  }

  if (!file) {
    return res.status(400).json({ error: "Please attach a local CSV/XLSX file" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { docsTokens: true }
    });

    if (!user?.docsTokens) {
      return res.status(400).json({ error: "Please connect Google Docs first" });
    }

    const fileName = String(file.originalname || "").toLowerCase();
    let rows = [];

    if (fileName.endsWith(".csv")) {
      const text = file.buffer.toString("utf-8");
      rows = text
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .map((line) => line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map((v) => v.replace(/^"|"$/g, "").trim()));
    } else if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
      const wb = XLSX.read(file.buffer, { type: "buffer" });
      const firstSheetName = wb.SheetNames?.[0];
      if (!firstSheetName) {
        return res.status(400).json({ error: "Uploaded spreadsheet has no sheet" });
      }
      rows = XLSX.utils.sheet_to_json(wb.Sheets[firstSheetName], { header: 1, raw: false });
    } else {
      return res.status(400).json({ error: "Unsupported file type. Use CSV, XLSX, or XLS" });
    }

    if (!rows || rows.length < 2) {
      return res.status(400).json({ error: "File should contain a header row and at least one investor row" });
    }

    const normalize = (s = "") => s.toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const headers = rows[0].map(normalize);

    const findCol = (aliases = []) => {
      for (const alias of aliases) {
        const idx = headers.findIndex((h) => h === alias || h.includes(alias));
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const nameIdx = findCol(["name", "investor name", "full name"]);
    const emailIdx = findCol(["email", "email address", "investor email"]);
    const focusIdx = findCol(["focus areas", "focus area", "thesis", "investment thesis", "focus"]);

    if (nameIdx === -1 || emailIdx === -1) {
      return res.status(400).json({ error: "File must contain Name and Email columns" });
    }

    const investors = rows
      .slice(1)
      .map((r) => ({
        name: String(r[nameIdx] || "").trim(),
        email: String(r[emailIdx] || "").trim(),
        focus: focusIdx !== -1 ? String(r[focusIdx] || "").trim() : ""
      }))
      .filter((r) => r.name && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email))
      .slice(0, 25);

    if (investors.length === 0) {
      return res.status(400).json({ error: "No valid investor rows found in uploaded file" });
    }

    const investorLines = investors
      .map((inv, i) => `${i + 1}. Name: ${inv.name} | Email: ${inv.email} | Focus Areas: ${inv.focus || "N/A"}`)
      .join("\n");

    const pitchPrompt = `You are a startup fundraising assistant. Draft personalized cold emails for each investor.

Startup name: ${startupName}
Investors:
${investorLines}

Output format for each investor:
### Investor: <Name> (<Email>)
Subject: <one line>
Body:
<120-170 words, personalized to focus area when available, concise and professional>

Keep each draft unique and practical.`;

    const aiRes = await generateText({
      model: openai("gpt-4o-mini"),
      prompt: pitchPrompt,
    });

    const draftsText = aiRes.text || "No drafts generated.";

    const docsOAuth = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    docsOAuth.setCredentials(user.docsTokens);

    const docs = google.docs({ version: "v1", auth: docsOAuth });

    const created = await docs.documents.create({
      requestBody: {
        title: `Personalized Pitch Emails - ${startupName}`
      }
    });

    const documentId = created.data.documentId;
    const docText = [
      "Personalized Pitch Email Drafts",
      `Startup: ${startupName}`,
      `Source File: ${file.originalname}`,
      `Generated For: ${investors.length} investors`,
      "",
      draftsText
    ].join("\n");

    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index: 1 },
              text: docText
            }
          }
        ]
      }
    });

    const docUrl = `https://docs.google.com/document/d/${documentId}/edit`;

    res.json({
      success: true,
      docUrl,
      draftedCount: investors.length,
      summary: `Created ${investors.length} personalized pitch email drafts for ${startupName} from local file in Google Docs.`
    });
  } catch (err) {
    console.error("[Pitch Emails Upload Workflow Error]:", err.message);
    res.status(500).json({
      error: "Failed to generate personalized pitch emails from local file",
      details: err.message
    });
  }
});

app.post("/api/workflows/pitch-emails/start", async (req, res) => {
  const userId = req.headers["x-user-id"];
  const sheetUrl = String(req.body?.sheet_url || "").trim();
  const startupName = String(req.body?.startup_name || "").trim();

  if (!userId) {
    return res.status(401).json({ error: "User not authenticated" });
  }

  if (!sheetUrl) {
    return res.status(400).json({ error: "sheet_url is required" });
  }

  if (!startupName) {
    return res.status(400).json({ error: "startup_name is required" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { sheetsTokens: true, docsTokens: true }
    });

    if (!user?.sheetsTokens) {
      return res.status(400).json({ error: "Please connect Google Sheets first" });
    }

    if (!user?.docsTokens) {
      return res.status(400).json({ error: "Please connect Google Docs first" });
    }

    const sheetMatch = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!sheetMatch?.[1]) {
      return res.status(400).json({ error: "Invalid Google Sheet URL" });
    }
    const spreadsheetId = sheetMatch[1];

    const sheetsOAuth = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    sheetsOAuth.setCredentials(user.sheetsTokens);

    const sheets = google.sheets({ version: "v4", auth: sheetsOAuth });

    const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId });
    const firstSheetTitle = sheetMeta.data.sheets?.[0]?.properties?.title;

    if (!firstSheetTitle) {
      return res.status(400).json({ error: "No tab found in the provided Google Sheet" });
    }

    const valuesRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${firstSheetTitle}!A1:Z300`
    });

    const rows = valuesRes.data.values || [];
    if (rows.length < 2) {
      return res.status(400).json({ error: "Sheet should contain header row and at least one investor row" });
    }

    const normalize = (s = "") => s.toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const headers = rows[0].map(normalize);

    const findCol = (aliases = []) => {
      for (const alias of aliases) {
        const idx = headers.findIndex((h) => h === alias || h.includes(alias));
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const nameIdx = findCol(["name", "investor name", "full name"]);
    const emailIdx = findCol(["email", "email address", "investor email"]);
    const focusIdx = findCol(["focus areas", "focus area", "thesis", "investment thesis", "focus"]);

    if (nameIdx === -1 || emailIdx === -1) {
      return res.status(400).json({
        error: "Sheet must contain Name and Email columns (Focus Areas recommended)"
      });
    }

    const investors = rows
      .slice(1)
      .map((r) => ({
        name: String(r[nameIdx] || "").trim(),
        email: String(r[emailIdx] || "").trim(),
        focus: focusIdx !== -1 ? String(r[focusIdx] || "").trim() : ""
      }))
      .filter((r) => r.name && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email))
      .slice(0, 25);

    if (investors.length === 0) {
      return res.status(400).json({ error: "No valid investor rows found in the sheet" });
    }

    const investorLines = investors
      .map((inv, i) => `${i + 1}. Name: ${inv.name} | Email: ${inv.email} | Focus Areas: ${inv.focus || "N/A"}`)
      .join("\n");

    const pitchPrompt = `You are a startup fundraising assistant. Draft personalized cold emails for each investor.

Startup name: ${startupName}
Investors:
${investorLines}

Output format for each investor:
### Investor: <Name> (<Email>)
Subject: <one line>
Body:
<120-170 words, personalized to focus area when available, concise and professional>

Keep each draft unique and practical.`;

    const aiRes = await generateText({
      model: openai("gpt-4o-mini"),
      prompt: pitchPrompt,
    });

    const draftsText = aiRes.text || "No drafts generated.";

    const docsOAuth = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    docsOAuth.setCredentials(user.docsTokens);

    const docs = google.docs({ version: "v1", auth: docsOAuth });

    const created = await docs.documents.create({
      requestBody: {
        title: `Personalized Pitch Emails - ${startupName}`
      }
    });

    const documentId = created.data.documentId;
    const docText = [
      `Personalized Pitch Email Drafts`,
      `Startup: ${startupName}`,
      `Source Sheet: ${sheetUrl}`,
      `Generated For: ${investors.length} investors`,
      "",
      draftsText
    ].join("\n");

    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index: 1 },
              text: docText
            }
          }
        ]
      }
    });

    const docUrl = `https://docs.google.com/document/d/${documentId}/edit`;

    res.json({
      success: true,
      docUrl,
      draftedCount: investors.length,
      summary: `Created ${investors.length} personalized pitch email drafts for ${startupName} in Google Docs.`
    });
  } catch (err) {
    console.error("[Pitch Emails Workflow Error]:", err.message);
    res.status(500).json({
      error: "Failed to generate personalized pitch emails",
      details: err.message
    });
  }
});

app.post("/api/workflows/send-doc-emails/start", async (req, res) => {
  const userId = req.headers["x-user-id"];
  const docUrl = String(req.body?.doc_url || "").trim();
  const recipientEmails = String(req.body?.recipient_emails || "").trim();
  const defaultSubject = String(req.body?.default_subject || "").trim() || "Quick intro from my startup";

  if (!userId) {
    return res.status(401).json({ error: "User not authenticated" });
  }

  if (!docUrl) {
    return res.status(400).json({ error: "doc_url is required" });
  }

  const docMatch = docUrl.match(/\/document\/d\/([a-zA-Z0-9-_]+)/);
  if (!docMatch?.[1]) {
    return res.status(400).json({ error: "Invalid Google Doc URL" });
  }
  const documentId = docMatch[1];

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { gmailTokens: true, docsTokens: true }
    });

    if (!user?.gmailTokens) {
      return res.status(400).json({ error: "Please connect Gmail first" });
    }

    if (!user?.docsTokens) {
      return res.status(400).json({ error: "Please connect Google Docs first" });
    }

    const docsOAuth = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    docsOAuth.setCredentials(user.docsTokens);

    const docs = google.docs({ version: "v1", auth: docsOAuth });
    const doc = await docs.documents.get({ documentId });

    const toPlainText = (document) => {
      const content = document?.data?.body?.content || [];
      let out = "";

      content.forEach((item) => {
        const elements = item?.paragraph?.elements || [];
        elements.forEach((el) => {
          const t = el?.textRun?.content || "";
          out += t;
        });
      });

      return out.replace(/\u000b/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    };

    const docText = toPlainText(doc);
    if (!docText) {
      return res.status(400).json({ error: "Google Doc is empty" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    const parsedDrafts = [];
    const normalizedDocText = docText.replace(/\r\n/g, "\n");
    const blocks = normalizedDocText
      .split(/\n(?=\s*#{0,6}\s*Investor:)/i)
      .map((b) => b.trim())
      .filter(Boolean);

    for (const block of blocks) {
      const investorLineMatch = block.match(/^\s*#{0,6}\s*Investor:\s*(.+)$/im);
      if (!investorLineMatch) continue;

      const investorLine = investorLineMatch[1].trim();
      const emailMatch = investorLine.match(/\(([^)\s]+@[^)\s]+)\)/);
      const email = String(emailMatch?.[1] || "").trim();
      const name = String(investorLine.replace(/\(([^)]+)\)/, "")).trim();

      if (!emailRegex.test(email)) continue;

      const subjectMatch = block.match(/^\s*Subject:\s*(.+)$/im);
      const subject = String(subjectMatch?.[1] || "").trim() || defaultSubject;

      const bodyStartMatch = block.match(/^\s*Body:\s*$/im) || block.match(/^\s*Body:\s*(.+)$/im);
      if (!bodyStartMatch) continue;

      let body = "";
      if (bodyStartMatch[1]) {
        body = String(bodyStartMatch[1]).trim();
      } else {
        const idx = block.search(/^\s*Body:\s*$/im);
        body = idx >= 0 ? block.slice(idx).replace(/^\s*Body:\s*\n?/i, "").trim() : "";
      }

      if (!body) continue;

      parsedDrafts.push({
        name,
        email,
        subject,
        body
      });
    }

    const fallbackRecipients = recipientEmails
      .split(/[;,\n]/)
      .map((e) => e.trim())
      .filter((e) => emailRegex.test(e));

    let emailsToSend = parsedDrafts;

    if (emailsToSend.length === 0) {
      if (fallbackRecipients.length === 0) {
        return res.status(400).json({
          error: "No sendable drafts found in document. Use format: Investor/Subject/Body or provide fallback recipient emails."
        });
      }

      const genericBody = docText.slice(0, 8000);
      emailsToSend = fallbackRecipients.map((email) => ({
        name: "",
        email,
        subject: defaultSubject,
        body: genericBody
      }));
    }

    const gmailOAuth = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    gmailOAuth.setCredentials(user.gmailTokens);

    const gmail = google.gmail({ version: "v1", auth: gmailOAuth });

    const sent = [];
    const failed = [];

    for (const item of emailsToSend.slice(0, 50)) {
      try {
        const bodyText = item.body.replace(/\n{3,}/g, "\n\n").trim();
        const mime = [
          `To: ${item.email}`,
          `Subject: ${item.subject}`,
          "MIME-Version: 1.0",
          'Content-Type: text/plain; charset="UTF-8"',
          "",
          bodyText,
        ].join("\r\n");

        const raw = Buffer.from(mime)
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");

        await gmail.users.messages.send({
          userId: "me",
          requestBody: { raw }
        });

        sent.push(item.email);
      } catch (sendErr) {
        failed.push({ email: item.email, reason: sendErr.message });
      }
    }

    res.json({
      success: true,
      parsedCount: parsedDrafts.length,
      sentCount: sent.length,
      failedCount: failed.length,
      sentRecipients: sent,
      failedRecipients: failed,
      summary: `Processed ${emailsToSend.length} draft emails from doc. Sent: ${sent.length}, Failed: ${failed.length}.`
    });
  } catch (err) {
    console.error("[Send Doc Emails Workflow Error]:", err.message);
    res.status(500).json({
      error: "Failed to send emails from Google Doc",
      details: err.message
    });
  }
});

app.post("/api/workflows/send-doc-emails/upload-start", upload.single("doc_file"), async (req, res) => {
  const userId = req.headers["x-user-id"];
  const recipientEmails = String(req.body?.recipient_emails || "").trim();
  const defaultSubject = String(req.body?.default_subject || "").trim() || "Quick intro from my startup";

  if (!userId) {
    return res.status(401).json({ error: "User not authenticated" });
  }

  if (!req.file) {
    return res.status(400).json({ error: "doc_file is required" });
  }

  const docText = req.file.buffer.toString("utf-8").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!docText) {
    return res.status(400).json({ error: "Uploaded file is empty" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { gmailTokens: true }
    });

    if (!user?.gmailTokens) {
      return res.status(400).json({ error: "Please connect Gmail first" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    const parsedDrafts = [];
    const blocks = docText
      .split(/\n(?=\s*#{0,6}\s*Investor:)/i)
      .map((b) => b.trim())
      .filter(Boolean);

    for (const block of blocks) {
      const investorLineMatch = block.match(/^\s*#{0,6}\s*Investor:\s*(.+)$/im);
      if (!investorLineMatch) continue;

      const investorLine = investorLineMatch[1].trim();
      const emailMatch = investorLine.match(/\(([^)\s]+@[^)\s]+)\)/);
      const email = String(emailMatch?.[1] || "").trim();
      const name = String(investorLine.replace(/\(([^)]+)\)/, "")).trim();

      if (!emailRegex.test(email)) continue;

      const subjectMatch = block.match(/^\s*Subject:\s*(.+)$/im);
      const subject = String(subjectMatch?.[1] || "").trim() || defaultSubject;

      const bodyStartMatch = block.match(/^\s*Body:\s*$/im) || block.match(/^\s*Body:\s*(.+)$/im);
      if (!bodyStartMatch) continue;

      let body = "";
      if (bodyStartMatch[1]) {
        body = String(bodyStartMatch[1]).trim();
      } else {
        const idx = block.search(/^\s*Body:\s*$/im);
        body = idx >= 0 ? block.slice(idx).replace(/^\s*Body:\s*\n?/i, "").trim() : "";
      }

      if (!body) continue;

      parsedDrafts.push({ name, email, subject, body });
    }

    const fallbackRecipients = recipientEmails
      .split(/[;,\n]/)
      .map((e) => e.trim())
      .filter((e) => emailRegex.test(e));

    let emailsToSend = parsedDrafts;

    if (emailsToSend.length === 0) {
      if (fallbackRecipients.length === 0) {
        return res.status(400).json({
          error: "No sendable drafts found in file. Use format: Investor/Subject/Body or provide fallback recipient emails."
        });
      }
      emailsToSend = fallbackRecipients.map((email) => ({
        name: "",
        email,
        subject: defaultSubject,
        body: docText.slice(0, 8000)
      }));
    }

    const gmailOAuth = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    gmailOAuth.setCredentials(user.gmailTokens);

    const gmail = google.gmail({ version: "v1", auth: gmailOAuth });

    const sent = [];
    const failed = [];

    for (const item of emailsToSend.slice(0, 50)) {
      try {
        const bodyText = item.body.replace(/\n{3,}/g, "\n\n").trim();
        const mime = [
          `To: ${item.email}`,
          `Subject: ${item.subject}`,
          "MIME-Version: 1.0",
          'Content-Type: text/plain; charset="UTF-8"',
          "",
          bodyText,
        ].join("\r\n");

        const raw = Buffer.from(mime)
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");

        await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
        sent.push(item.email);
      } catch (sendErr) {
        failed.push({ email: item.email, reason: sendErr.message });
      }
    }

    res.json({
      success: true,
      parsedCount: parsedDrafts.length,
      sentCount: sent.length,
      failedCount: failed.length,
      sentRecipients: sent,
      failedRecipients: failed,
      summary: `Processed ${emailsToSend.length} draft emails from uploaded file. Sent: ${sent.length}, Failed: ${failed.length}.`
    });
  } catch (err) {
    console.error("[Send Doc Emails Upload Error]:", err.message);
    res.status(500).json({ error: "Failed to send emails from uploaded file", details: err.message });
  }
});

app.post("/api/workflows/study-plan/start", async (req, res) => {
  const userId = req.headers["x-user-id"];
  const topic = String(req.body?.topic || "").trim();
  const currentLevel = String(req.body?.current_level || "").trim() || "intermediate";
  const goal = String(req.body?.goal || "").trim() || "consistent skill growth";
  const durationMonthsRaw = parseInt(req.body?.duration_months, 10);
  const intervalDaysRaw = parseInt(req.body?.interval_days, 10);
  const questionsPerDayRaw = parseInt(req.body?.questions_per_day, 10);
  const recipientEmailsRaw = String(req.body?.recipient_emails || "").trim();

  const durationMonths = Number.isFinite(durationMonthsRaw)
    ? Math.max(1, Math.min(12, durationMonthsRaw))
    : 3;
  const intervalDays = Number.isFinite(intervalDaysRaw)
    ? Math.max(1, Math.min(30, intervalDaysRaw))
    : 1;
  const questionsPerDay = Number.isFinite(questionsPerDayRaw)
    ? Math.max(5, Math.min(200, questionsPerDayRaw))
    : 20;

  if (!userId) {
    return res.status(401).json({ error: "User not authenticated" });
  }

  if (!topic) {
    return res.status(400).json({ error: "topic is required" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, gmailTokens: true, docsTokens: true, sheetsTokens: true }
    });

    if (!user?.gmailTokens) {
      return res.status(400).json({ error: "Please connect Gmail first" });
    }
    if (!user?.docsTokens) {
      return res.status(400).json({ error: "Please connect Google Docs first" });
    }
    if (!user?.sheetsTokens) {
      return res.status(400).json({ error: "Please connect Google Sheets first" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const recipients = recipientEmailsRaw
      .split(/[;,\n]/)
      .map((e) => e.trim())
      .filter((e) => emailRegex.test(e));

    if (recipients.length === 0 && user?.email && emailRegex.test(user.email)) {
      recipients.push(user.email);
    }

    if (recipients.length === 0) {
      return res.status(400).json({ error: "Please provide at least one valid recipient email" });
    }

    const docsOAuth = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    docsOAuth.setCredentials(user.docsTokens);
    const docs = google.docs({ version: "v1", auth: docsOAuth });

    const sheetsOAuth = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    sheetsOAuth.setCredentials(user.sheetsTokens);
    const sheets = google.sheets({ version: "v4", auth: sheetsOAuth });

    const gmailOAuth = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    gmailOAuth.setCredentials(user.gmailTokens);
    const gmail = google.gmail({ version: "v1", auth: gmailOAuth });

    const weeks = durationMonths * 4;
    const totalDays = durationMonths * 30;

    const roadmapPrompt = `Create a ${durationMonths}-month study roadmap for topic: ${topic}.

Requirements:
- Weekly milestones (${weeks} weeks total)
- Daily study routine template
- Revision plan
- Mock/practice strategy
- End each week with measurable outcomes
  - Personalize for level: ${currentLevel}
  - Primary goal: ${goal}

Format with headings and concise bullet points.`;

    const practicePrompt = `Generate a structured daily practice plan for ${topic} for ${totalDays} days.

Return as plain text rows in this exact format:
  Day | Week | Difficulty | Question Focus | Practice Task | Question Count | Target Time | Checkpoint

  Rules:
  - One row per day
  - Question Count should be ${questionsPerDay}
  - Personalize for level: ${currentLevel}
  - Align with goal: ${goal}
  - Keep tasks realistic and progressive.`;

    const [roadmapRes, practiceRes] = await Promise.all([
      generateText({ model: openai("gpt-4o-mini"), prompt: roadmapPrompt }),
      generateText({ model: openai("gpt-4o-mini"), prompt: practicePrompt })
    ]);

    const roadmapText = roadmapRes.text || `Study roadmap for ${topic}`;
    const practiceText = practiceRes.text || "Day | Week | Difficulty | Question Focus | Practice Task | Question Count | Target Time | Checkpoint | Sample Questions";

    const headerRow = ["Day", "Week", "Difficulty", "Question Focus", "Practice Task", "Question Count", "Target Time", "Checkpoint", "Sample Questions"];

    const buildFallbackRows = () => {
      const fallbackRows = [];
      for (let day = 1; day <= totalDays; day += 1) {
        const week = Math.ceil(day / 7);
        const phase = day <= totalDays / 3 ? "foundation" : day <= (2 * totalDays) / 3 ? "intermediate" : "advanced";
        const difficulty = phase === "foundation" ? "Easy-Medium" : phase === "intermediate" ? "Medium" : "Medium-Hard";
        const focus = `${topic} - ${phase} concepts`;
        const task = `Solve ${questionsPerDay} questions and review mistakes`;
        const targetTime = `${Math.min(240, Math.max(60, questionsPerDay * 6))} min`;
        const checkpoint = `Log accuracy and top 3 learnings (Day ${day})`;
        const sampleQuestions = [
          `1) Core ${topic} concept drill`,
          `2) Applied ${topic} scenario for ${goal}`,
          `3) Timed mixed-practice set`
        ].join(" ; ");

        fallbackRows.push([
          String(day),
          `Week ${week}`,
          difficulty,
          focus,
          task,
          String(questionsPerDay),
          targetTime,
          checkpoint,
          sampleQuestions
        ]);
      }
      return fallbackRows;
    };

    const docCreated = await docs.documents.create({
      requestBody: {
        title: `${topic} - ${durationMonths} Month Study Roadmap`
      }
    });
    const documentId = docCreated.data.documentId;

    const spreadsheet = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: `${topic} - Practice Questions (${durationMonths}M)`
        },
        sheets: [{ properties: { title: "Practice Plan" } }]
      }
    });

    const spreadsheetId = spreadsheet.data.spreadsheetId;
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    const docUrl = `https://docs.google.com/document/d/${documentId}/edit`;

    const parsedRowsMap = new Map();
    const rawLines = practiceText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

    for (const line of rawLines) {
      if (/^\|?\s*[-:]{3,}/.test(line)) continue;
      const normalized = line.replace(/^\|/, "").replace(/\|$/, "");
      const cells = normalized.split("|").map((cell) => cell.trim());
      if (cells.length < 8) continue;

      if (/^day$/i.test(cells[0])) continue;

      const dayNum = parseInt(String(cells[0]).replace(/[^0-9]/g, ""), 10);
      if (!Number.isFinite(dayNum) || dayNum < 1 || dayNum > totalDays) continue;

      parsedRowsMap.set(dayNum, [
        String(dayNum),
        cells[1] || `Week ${Math.ceil(dayNum / 7)}`,
        cells[2] || "Medium",
        cells[3] || `${topic} focused practice`,
        cells[4] || `Solve ${questionsPerDay} questions`,
        cells[5] || String(questionsPerDay),
        cells[6] || `${Math.min(240, Math.max(60, questionsPerDay * 6))} min`,
        cells[7] || `Update progress log for Day ${dayNum}`,
        cells[8] || `1) Core ${topic} drill ; 2) Applied set ; 3) Timed revision`
      ]);
    }

    const fallbackRows = buildFallbackRows();
    const mergedRows = fallbackRows.map((row) => {
      const day = parseInt(row[0], 10);
      return parsedRowsMap.get(day) || row;
    });
    const valuesToWrite = [headerRow, ...mergedRows];

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Practice Plan!A1",
      valueInputOption: "RAW",
      requestBody: {
        values: valuesToWrite
      }
    });

    const practicePreviewLines = mergedRows
      .slice(0, Math.min(14, mergedRows.length))
      .map((r) => `Day ${r[0]} | ${r[2]} | ${r[3]} | Questions: ${r[5]} | Sample: ${r[8]}`)
      .join("\n");

    const roadmapDocText = [
      `${topic} Study Roadmap`,
      `Current Level: ${currentLevel}`,
      `Goal: ${goal}`,
      `Duration: ${durationMonths} months (${weeks} weeks)` ,
      `Questions Per Day: ${questionsPerDay}`,
      `Email Interval: every ${intervalDays} day(s)`,
      "",
      roadmapText,
      "",
      "Practice Questions Preview (First 14 Days)",
      practicePreviewLines,
      "",
      `Full practice question plan is in Google Sheets: ${sheetUrl}`
    ].join("\n");

    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index: 1 },
              text: roadmapDocText
            }
          }
        ]
      }
    });

    const findRowByDay = (dayNumber) => {
      const normalized = valuesToWrite.slice(1);
      const target = normalized.find((r) => String(r[0] || "").replace(/[^0-9]/g, "") === String(dayNumber));
      return target || null;
    };

    const sendStudyEmail = async (subjectPrefix = "Study Plan Update", dayNumber = 1) => {
      const safeDay = Math.max(1, Math.min(totalDays, dayNumber));
      const todayRow = findRowByDay(safeDay);

      let dailyBrief = "Review roadmap, solve planned questions, and update your progress notes.";
      try {
        const briefRes = await generateText({
          model: openai("gpt-4o-mini"),
          prompt: `Create a concise daily study brief.
Topic: ${topic}
Current Level: ${currentLevel}
Goal: ${goal}
Day: ${safeDay} of ${totalDays}
Questions today: ${questionsPerDay}
Practice row: ${todayRow ? todayRow.join(" | ") : "N/A"}

Output:
1) Focus for today (1 line)
2) Questions strategy (2 bullets)
3) Checkpoint before sleep (1 line)`
        });
        if (briefRes?.text?.trim()) {
          dailyBrief = briefRes.text.trim();
        }
      } catch (briefErr) {
        console.error("[Study Plan Daily Brief Error]:", briefErr.message);
      }

      const body = [
        `Topic: ${topic}`,
        `Current Level: ${currentLevel}`,
        `Goal: ${goal}`,
        `Day Progress: ${safeDay}/${totalDays}`,
        `Duration: ${durationMonths} month(s)`,
        `Practice horizon: ${weeks} weeks`,
        `Questions Today: ${questionsPerDay}`,
        `Interval: every ${intervalDays} day(s)`,
        "",
        todayRow
          ? `Today's Plan: ${todayRow[2]} | ${todayRow[3]} | ${todayRow[4]} | ${todayRow[6]} | Sample Questions: ${todayRow[8]}`
          : "Today's Plan: Follow roadmap milestones and complete focused practice.",
        "",
        dailyBrief,
        "",
        `Roadmap (Google Docs): ${docUrl}`,
        `Practice Questions (Google Sheets): ${sheetUrl}`,
        "",
        "Reply to this email with what you completed today for personalized next-step adjustments."
      ].join("\n");

      for (const recipient of recipients) {
        const mime = [
          `To: ${recipient}`,
          `Subject: ${subjectPrefix}: ${topic}`,
          "MIME-Version: 1.0",
          'Content-Type: text/plain; charset="UTF-8"',
          "",
          body,
        ].join("\r\n");

        const raw = Buffer.from(mime)
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");

        await gmail.users.messages.send({
          userId: "me",
          requestBody: { raw }
        });
      }
    };

    await sendStudyEmail("Study Plan Started", 1);

    const scheduleKey = `${userId}:${topic.toLowerCase()}`;
    const existing = studyPlanSchedules.get(scheduleKey);
    if (existing?.timer) clearInterval(existing.timer);

    const intervalMs = intervalDays * 24 * 60 * 60 * 1000;
    const startAt = Date.now();
    const timer = setInterval(async () => {
      try {
        const elapsedDays = Math.floor((Date.now() - startAt) / (24 * 60 * 60 * 1000));
        const dayNumber = Math.min(totalDays, 1 + elapsedDays);
        await sendStudyEmail("Study Plan Reminder", dayNumber);
      } catch (mailErr) {
        console.error("[Study Plan Scheduler Email Error]:", mailErr.message);
      }
    }, intervalMs);

    studyPlanSchedules.set(scheduleKey, {
      timer,
      startAt,
      totalDays,
      topic,
      recipients,
      questionsPerDay,
      intervalDays
    });

    res.json({
      success: true,
      docUrl,
      sheetUrl,
      recipients,
      intervalDays,
      durationMonths,
      questionsPerDay,
      generatedQuestionRows: mergedRows.length,
      summary: `Created personalized ${durationMonths}-month roadmap for ${topic}, generated ${mergedRows.length} daily question rows (${questionsPerDay} questions/day), and scheduled progress emails every ${intervalDays} day(s) for ${recipients.length} recipient(s).`
    });
  } catch (err) {
    console.error("[Study Plan Workflow Error]:", err.message);
    res.status(500).json({
      error: "Failed to create study roadmap workflow",
      details: err.message
    });
  }
});

app.get("/api/calendar/today-meetings", async (req, res) => {

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { calendarTokens: true }
    });

    if (!user?.calendarTokens) {
      return res.status(400).json({ error: "Please connect Google Calendar first" });
    }

    const oauth2Client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials(user.calendarTokens);

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const now = new Date();
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

    // Today start (IST midnight → UTC)
    const todayStartUTC = new Date(now.getTime() + IST_OFFSET_MS);
    todayStartUTC.setUTCHours(0, 0, 0, 0);
    
    // Today end (IST 23:59:59 → UTC)
    const todayEndUTC = new Date(todayStartUTC);
    todayEndUTC.setUTCHours(23, 59, 59, 999);

    const timeMin = todayStartUTC.toISOString();  // e.g. 2026-03-17T18:30:00.000Z
    const timeMax = todayEndUTC.toISOString();    // e.g. 2026-03-18T18:29:59.999Z

    console.log("[DEBUG] Current UTC:", now.toISOString());
    console.log("[DEBUG] IST approx:", now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }));
    console.log("[DEBUG] timeMin:", timeMin);
    console.log("[DEBUG] timeMax:", timeMax);

    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 100,
      showDeleted: false,
      timeZone: "Asia/Kolkata"
    });

    const events = response.data.items || [];

    console.log("[DEBUG] Today's events count:", events.length);

    if (events.length > 0) {
      console.log("[DEBUG] First few events:");
      events.slice(0, 5).forEach(e => {
        console.log(`- ${e.summary || "No title"} | Start: ${e.start?.dateTime || e.start?.date || "unknown"}`);
      });
    }

    if (events.length === 0) {
      return res.json({
        message: "🎉 Aaj ke liye koi event API se nahi mila.\n\nCheck karo:\n- Events March 18, 2026 ko primary calendar mein hain?\n- Event ka time zone 'Asia/Kolkata' set hai?\n- New test event banao abhi aur phir try karo.\nWeb pe dikhte hain toh calendarId 'primary' sahi hai ya nahi confirm karo.",
        debug: { timeMin, timeMax, count: 0 }
      });
    }

    // IST time ke liye
    const formatTime = (dateTime) => {
      if (!dateTime) return "All Day";
      const dt = new Date(dateTime);
      return dt.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: "Asia/Kolkata"
      });
    };

    // Group by time slots
    const morning = [], afternoon = [], evening = [], night = [], allDay = [];

    events.forEach(e => {
      const entry = `**${formatTime(e.start?.dateTime)}**: ${e.summary || "(No title)"} (ID: ${e.id.slice(0, 12)}...)`;

      if (e.start?.date) {
        allDay.push(`**All Day**: ${e.summary || "(No title)"} (ID: ${e.id.slice(0, 12)}...)`);
        return;
      }

      const hour = new Date(e.start.dateTime).getUTCHours(); // UTC hour
      const localHour = (hour + 5.5) % 24; // rough IST hour

      if (localHour < 12) morning.push(entry);
      else if (localHour < 17) afternoon.push(entry);
      else if (localHour < 21) evening.push(entry);
      else night.push(entry);
    });

    let summary = "Here's a summary of your meetings for today from Google Calendar:\n\n";

    if (morning.length) summary += "### Morning\n" + morning.map(e => `- ${e}`).join("\n") + "\n\n";
    if (afternoon.length) summary += "### Afternoon\n" + afternoon.map(e => `- ${e}`).join("\n") + "\n\n";
    if (evening.length) summary += "### Evening\n" + evening.map(e => `- ${e}`).join("\n") + "\n\n";
    if (night.length) summary += "### Late Evening/Night\n" + night.map(e => `- ${e}`).join("\n") + "\n\n";
    if (allDay.length) summary += "### Additional Items\n" + allDay.join("\n") + "\n\n";

    summary += "Notes:\n- Back-to-back schedules hain (flights + interviews) – time overlaps pe dhyan do.\n- Flight boarding time aur prep ready rakho.\n- Updates ke liye calendar check karte raho!\n\nBusy day ahead – all the best! 🚀";

    res.json({
      message: summary,
      count: events.length,
      debug: { timeMin, timeMax }
    });

  } catch (err) {
    console.error("[ERROR] Calendar error:", err.message);
    if (err.response?.data) console.error("Google details:", err.response.data);

    res.status(500).json({
      error: "Failed to fetch today's schedule",
      details: err.message
    });
  }
});

app.get("/api/integrations", async (req, res) => {

  const userId = req.headers["x-user-id"];

  if (!userId) {
    return res.status(401).json({ error: "User not authenticated" });
  }

  try {

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { currentPlan: true }
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      gmail: !!user.gmailTokens,
      calendar: !!user.calendarTokens,
      docs: !!user.docsTokens,
      sheets: !!user.sheetsTokens,
      currentPlanName: user.currentPlan?.name || "FREE"
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Failed to fetch integrations"
    });

  }

});

// ── History Endpoint ──────────────────────────────────────────────────────
app.get("/api/history", checkUsageAndPlan, async (req, res) => {
  try {
    const history = await prisma.queryHistory.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, inputText: true, queryType: true, createdAt: true },
    });

    res.json({ history });
  } catch (err) {
    console.error("History fetch error:", err);
    res.status(500).json({ error: "Failed to load history" });
  }
});

// ── SPA Routes ────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  const p = path.join(__dirname, "public", "index.html");
  if (!existsSync(p)) return res.status(404).send("Homepage not found");
  res.sendFile(p);
});

app.get("/search", (req, res) => {
  const p = path.join(__dirname, "dist", "index.html");
  if (!existsSync(p)) return res.status(404).send("App not found");
  res.sendFile(p);
});

app.get("/pricing", (req, res) => {
  const p = path.join(__dirname, "dist", "index.html");
  if (!existsSync(p)) return res.status(404).send("Pricing page not found");
  res.sendFile(p);
});

app.get("*", (req, res) => {
  const p = path.join(__dirname, "dist", "index.html");
  if (!existsSync(p)) return res.status(404).send("App not found");
  res.sendFile(p);
});

app.get("/favicon.ico", (req, res) => res.status(204).end());

// ── START SERVER ──────────────────────────────────────────────────────────
app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${port}`);
  console.log(`Frontend expected at: http://0.0.0.0:${port}/search`);
  console.log(`Pricing page: http://0.0.0.0:${port}/pricing`);
  console.log("Server fully started - ready for requests");
});