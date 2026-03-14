// server.js - Updated with receipt length fix for Razorpay and FREE plan auto-assignment

import { config } from "dotenv";
config();

// Early env check with more details
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("Environment variables loaded:");
console.log("GOOGLE_CLIENT_ID:", process.env.GOOGLE_CLIENT_ID ? process.env.GOOGLE_CLIENT_ID.substring(0, 10) + "..." : "MISSING / EMPTY");
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

// Razorpay Instance with debug
const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

console.log("Razorpay SDK Initialized:");
if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.log("❌ ERROR: RAZORPAY_KEY_ID or KEY_SECRET missing in .env");
} else if (process.env.RAZORPAY_KEY_ID.startsWith('rzp_live_')) {
  console.log("✅ LIVE MODE active (rzp_live_ key detected)");
} else if (process.env.RAZORPAY_KEY_ID.startsWith('rzp_test_')) {
  console.log("⚠️ TEST MODE active (rzp_test_ key detected)");
} else {
  console.log("⚠️ UNKNOWN MODE – key doesn't start with rzp_test_ or rzp_live_");
}
console.log("Key ID (partial):", process.env.RAZORPAY_KEY_ID?.substring(0, 12) + "..." || "N/A");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down Prisma...');
  await prisma.$disconnect();
  process.exit(0);
});

const app = express();
const port = process.env.PORT || 8080;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── MIDDLEWARE ────────────────────────────────────────────────────────────
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:8080'],
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
const userLastRequest = new Map(); // userId → timestamp

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

// ── Razorpay Order Creation Endpoint (receipt length fixed) ───────────────
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
    PRO: 999 * 100,     // ₹999 → 99900 paise
    ULTRA: 3999 * 100,  // ₹3999 → 399900 paise
  };

  const amount = planAmounts[planName];
  if (!amount) {
    return res.status(400).json({ error: "Amount not configured for this plan" });
  }

  // Short receipt (max 40 chars) - using short userId prefix + short timestamp
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

    // Payment verified → update subscription
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

// ── Google Auth ────────────────────────────────────────────────────────────
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
      // Find the FREE plan once
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
          // Optional: set subscription dates for FREE plan
          subscriptionStart: new Date(),
          // For FREE plan you can leave subscriptionEnd null or set very far future
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