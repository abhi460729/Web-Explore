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

    if (isPaidPlan) {
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
          subscriptionEnd: new Date(2099, 11, 31),
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

    // Debug current time
    const now = new Date();
    console.log("[DEBUG] Server current time (UTC):", now.toISOString());

    // Optional: today's range in UTC (IST midnight to midnight)
    // Uncomment if you want to filter to today only (after scopes fix)
    /*
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const todayStartUTC = new Date(now.getTime() + IST_OFFSET_MS);
    todayStartUTC.setUTCHours(0, 0, 0, 0);
    const todayEndUTC = new Date(todayStartUTC);
    todayEndUTC.setUTCHours(23, 59, 59, 999);

    const timeMin = todayStartUTC.toISOString();
    const timeMax = todayEndUTC.toISOString();

    console.log("[DEBUG] timeMin:", timeMin);
    console.log("[DEBUG] timeMax:", timeMax);
    */

    const params = {
      calendarId: 'primary',
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 50,
      showDeleted: false,
      timeZone: 'Asia/Kolkata',  // Helps include all-day events correctly
      // timeMin, timeMax,   // ← uncomment when scopes are fixed
    };

    const response = await calendar.events.list(params);

    const events = response.data.items || [];
    console.log("[DEBUG] Events count:", events.length);

    if (events.length > 0) {
      console.log("[DEBUG] First event sample:", JSON.stringify(events[0], null, 2));
    }

    if (events.length === 0) {
      return res.json({
        message: "🎉 Aaj ke liye koi meeting nahi hai (ya calendar access issue ho sakta hai – scopes check karo).",
        debug: {
          count: 0,
          // timeMin: timeMin || 'not set',
          // timeMax: timeMax || 'not set',
          note: "If 0 events but you see them in web → re-authorize with calendar.readonly scope"
        }
      });
    }

    // IST offset for display (since API returns UTC dateTime)
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

    const formatted = events.map(e => {
      let time = "All Day";

      if (e.start?.dateTime) {
        const utcDate = new Date(e.start.dateTime);
        const istDate = new Date(utcDate.getTime() + IST_OFFSET_MS);
        time = istDate.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });
      } else if (e.start?.date) {
        time = "All Day";
      }

      return `📅 ${e.summary || "(No title)"} at ${time} (ID: ${e.id})`;
    }).join("\n");

    res.json({
      message: `Aaj ki meetings Google Calendar se:\n\n${formatted}`,
      debug: { count: events.length }
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

app.get("/api/calendar/today-meetings", async (req, res) => {
  const userId = req.headers["x-user-id"];
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
      where: { id: userId }
    });

    res.json({
      gmail: !!user.gmailTokens,
      calendar: !!user.calendarTokens,
      docs: !!user.docsTokens,
      sheets: !!user.sheetsTokens
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