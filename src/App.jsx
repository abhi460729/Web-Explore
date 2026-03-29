import React, { useState, useCallback, useEffect } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import debounce from "lodash/debounce";
import DOMPurify from "dompurify";
import { Plus, User, X, Bot, Globe, Mic, Sun, Moon, Check, Zap, ArrowLeft } from "lucide-react";
import { jsPDF } from "jspdf";
import { v4 as uuidv4 } from "uuid";

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;
if (recognition) {
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = "en-US";
}

const SAFE_SEARCH_OPTIONS = [
  { key: "strict", label: "Filter" },
  { key: "blur", label: "Blur" },
  { key: "off", label: "Off" },
];

const DEFAULT_SAFE_SEARCH_BY_TAB = {
  images: "strict",
  videos: "strict",
  shortVideos: "strict",
  news: "strict",
};

const SENSITIVE_PATTERN = /\b(?:porn|xxx|sex|nude|naked|escort|erotic|adult|nsfw|fetish|camgirl|onlyfans|hentai|hardcore|milf|bdsm|anal)\b/i;
const BLOCKED_MEDIA_DOMAINS = [
  "pornhub.com",
  "xvideos.com",
  "xnxx.com",
  "xhamster.com",
  "redtube.com",
  "spankbang.com",
  "youporn.com",
  "tube8.com",
  "rule34",
  "onlyfans.com",
  "hentai",
];

function normalizeSafeMode(mode) {
  const normalized = String(mode || "").toLowerCase();
  return ["strict", "blur", "off"].includes(normalized) ? normalized : "strict";
}

function normalizeSafeSearchByTab(rawValue) {
  if (!rawValue) return DEFAULT_SAFE_SEARCH_BY_TAB;

  try {
    const parsed = JSON.parse(rawValue);
    return {
      images: normalizeSafeMode(parsed?.images),
      videos: normalizeSafeMode(parsed?.videos),
      shortVideos: normalizeSafeMode(parsed?.shortVideos),
      news: normalizeSafeMode(parsed?.news),
    };
  } catch {
    return DEFAULT_SAFE_SEARCH_BY_TAB;
  }
}

function isSensitiveValue(value = "") {
  const text = String(value || "").toLowerCase();
  if (!text) return false;
  if (SENSITIVE_PATTERN.test(text)) return true;
  return BLOCKED_MEDIA_DOMAINS.some((domain) => text.includes(domain));
}

function isInstagramHostedUrl(rawUrl = "") {
  try {
    const parsed = new URL(String(rawUrl || ""));
    const host = parsed.hostname.toLowerCase();
    return host.includes("instagram.com") || host.includes("cdninstagram.com") || host.includes("fbcdn.net") || host.includes("scontent");
  } catch {
    return false;
  }
}

function getImageRenderUrl(rawUrl = "") {
  if (!rawUrl) return "";
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    if (host.includes("instagram.com") && (/^\/p\//.test(path) || /^\/reel\//.test(path) || /^\/tv\//.test(path))) {
      return `/api/instagram/resolve-image?url=${encodeURIComponent(rawUrl)}`;
    }
  } catch {
    // Keep fallback behavior for malformed URLs
  }

  if (isInstagramHostedUrl(rawUrl)) {
    return `/api/image-proxy?url=${encodeURIComponent(rawUrl)}`;
  }
  return rawUrl;
}

function normalizeImageItem(item, forceSensitive = false) {
  if (typeof item === "string") {
    const url = item.trim();
    if (!url) return null;
    return {
      url,
      renderUrl: getImageRenderUrl(url),
      isSensitive: forceSensitive || isSensitiveValue(url),
    };
  }

  if (item && typeof item === "object") {
    const url = String(item.url || item.image_url || item.src || "").trim();
    if (!url) return null;
    return {
      url,
      renderUrl: getImageRenderUrl(url),
      isSensitive: forceSensitive || Boolean(item.isSensitive || item.sensitive) || isSensitiveValue(`${url} ${item.reason || ""}`),
    };
  }

  return null;
}

const loadImageAsDataUrl = (url) => new Promise((resolve) => {
  if (!url) {
    resolve(null);
    return;
  }

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    } catch {
      resolve(null);
    }
  };
  img.onerror = () => resolve(null);
  img.src = url;
});

const addParagraph = (doc, text, x, y, width, lineHeight = 16) => {
  const lines = doc.splitTextToSize(text, width);
  doc.text(lines, x, y);
  return y + lines.length * lineHeight;
};

const downloadExperienceLetterPdf = async (payload) => {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentWidth = pageWidth - margin * 2;
  let cursorY = margin;

  const letterheadImage = await loadImageAsDataUrl(payload.letterheadUrl);
  if (letterheadImage) {
    doc.addImage(letterheadImage, "PNG", margin, cursorY, contentWidth, 72);
    cursorY += 92;
  } else {
    doc.setFillColor(243, 244, 246);
    doc.roundedRect(margin, cursorY, contentWidth, 58, 12, 12, "F");
    doc.setTextColor(31, 41, 55);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text(payload.companyName, margin + 18, cursorY + 28);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("Official Experience Letter", margin + 18, cursorY + 46);
    cursorY += 82;
  }

  doc.setTextColor(17, 24, 39);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("EXPERIENCE LETTER", pageWidth / 2, cursorY, { align: "center" });
  cursorY += 26;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Date: ${payload.issueDate}`, pageWidth - margin, cursorY, { align: "right" });
  cursorY += 32;

  doc.setFont("helvetica", "bold");
  doc.text("TO WHOM IT MAY CONCERN", margin, cursorY);
  cursorY += 24;

  doc.setFont("helvetica", "normal");
  payload.paragraphs.forEach((paragraph) => {
    cursorY = addParagraph(doc, paragraph, margin, cursorY, contentWidth);
    cursorY += 10;
  });

  cursorY += 12;
  doc.text("Yours faithfully,", margin, cursorY);
  cursorY += 18;

  const signatureImage = await loadImageAsDataUrl(payload.signatureUrl);
  if (signatureImage) {
    doc.addImage(signatureImage, "PNG", margin, cursorY, 132, 44);
    cursorY += 52;
  } else {
    doc.setDrawColor(156, 163, 175);
    doc.line(margin, cursorY + 18, margin + 132, cursorY + 18);
    cursorY += 28;
  }

  doc.setFont("helvetica", "bold");
  doc.text(payload.signatoryName, margin, cursorY);
  cursorY += 16;
  doc.setFont("helvetica", "normal");
  doc.text(payload.signatoryTitle, margin, cursorY);
  cursorY += 16;
  doc.text(payload.companyName, margin, cursorY);

  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  doc.text(
    "This document is system-generated and must be reviewed, approved, and signed by authorized HR personnel before external use.",
    margin,
    pageHeight - 28
  );

  const safeName = payload.employeeName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "employee";
  doc.save(`experience-letter-${safeName}.pdf`);
};

function App() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  
  const getDoodle = () => {
    const today = new Date();
    const monthDay = `${today.getMonth() + 1}-${today.getDate()}`;
    const holidays = ["1-26", "8-15", "10-2", "12-25", "1-1", "3-23", "4-14", "8-9", "10-31", "11-1"];
    const isHoliday = holidays.includes(monthDay);

    if (isHoliday && Math.random() < 0.65) {
      if (monthDay === "1-26" || monthDay === "8-15" || monthDay === "8-9") {
        return { text: "Web Explore 🇮🇳", className: "explore-doodle republic-doodle" };
      }
      if (monthDay === "10-2") {
        return { text: "Web Explore", className: "explore-doodle gandhi-doodle" };
      }
      if (monthDay === "12-25") {
        return { text: "Web Explore 🎄", className: "explore-doodle christmas-doodle" };
      }
      if (monthDay === "1-1") {
        return { text: "Web Explore 🎉", className: "explore-doodle newyear-doodle" };
      }
      if (monthDay === "4-14") {
        return { text: "Web Explore 🌸", className: "explore-doodle holi-doodle" };
      }
      if (monthDay === "10-31") {
        return { text: "Web Explore 🎃", className: "explore-doodle halloween-doodle" };
      }
      if (monthDay === "11-1") {
        return { text: "Web Explore 🪔", className: "explore-doodle diwali-doodle" };
      }
    }
    return { text: "Web Explore", className: "explore-doodle" };
  };

  const doodle = getDoodle();

  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedModel, setSelectedModel] = useState("gpt-4o-mini");
  const [mode, setMode] = useState("search");
  const [listening, setListening] = useState(false);
  const [isProfileSidebarOpen, setIsProfileSidebarOpen] = useState(false);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("answer");
  const [safeSearchByTab, setSafeSearchByTab] = useState(() => normalizeSafeSearchByTab(localStorage.getItem("safeSearchByTab")));
  const [imageResults, setImageResults] = useState([]);
  const [imageResultsQuery, setImageResultsQuery] = useState("");
  const [imagesLoading, setImagesLoading] = useState(false);
  const [videoResults, setVideoResults] = useState([]);
  const [videoResultsQuery, setVideoResultsQuery] = useState("");
  const [videosLoading, setVideosLoading] = useState(false);
  const [shortVideoResults, setShortVideoResults] = useState([]);
  const [shortVideoResultsQuery, setShortVideoResultsQuery] = useState("");
  const [shortVideosLoading, setShortVideosLoading] = useState(false);
  const [newsResults, setNewsResults] = useState([]);
  const [newsResultsQuery, setNewsResultsQuery] = useState("");
  const [newsLoading, setNewsLoading] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "light");
  const [values, setValues] = useState({});
  const [attachedInvestorFile, setAttachedInvestorFile] = useState(null);
  const [attachedDocFile, setAttachedDocFile] = useState(null);
  const [isExecutingWorkflow, setIsExecutingWorkflow] = useState(false);
  const [activeEmbedSlug, setActiveEmbedSlug] = useState("");
  const [activeWorkflowTab, setActiveWorkflowTab] = useState("All");
  const [integrations, setIntegrations] = useState({
    gmail: false,
    calendar: false,
    docs: false,
    sheets: false
  });
  const [toast, setToast] = useState(null);

  const showToast = (message, type = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const [currentPlanName, setCurrentPlanName] = useState(user?.currentPlan?.name || "FREE");
  const isUltraUser = currentPlanName === "ULTRA";

  const handleUpgradePlanClick = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    navigate("/pricing");
  };

  const handleWorkflowCardClick = (e, slug) => {
    if (e.defaultPrevented) return;
    if (e.target.closest("button")) return;
    navigate(`/workflow-input/${slug}`);
  };

  const models = [
    "gpt-4o-mini",
    "mistralai/mistral-7b-instruct",
    "meta-llama/llama-3-8b-instruct",
  ];

  const modes = [
    { key: "search", label: "Web Search" },
    { key: "ai", label: "AI Search" },
  ];

  const workflowCards = [
    {
      title: "Alumni Details",
      slug: "alumni-details",
      category: "Research & Intelligence",
      promptTemplate: "help me find 10 people who went to {{school}} in the last few years who now work at {{company}}",
      videoSrc: "",
      fields: [
        { key: "school", label: "School / University", placeholder: "e.g. IIT Bombay, Stanford", required: true },
        { key: "company", label: "Target Company", placeholder: "e.g. Google, Cred", required: true }
      ]
    },
    {
      title: "YC Company Founders Details",
      slug: "yc-company-founders",
      category: "Research & Intelligence",
      promptTemplate: "do a deep dive on founders of YC company: {{company}}",
      fields: [
        { key: "company", label: "Company Name", placeholder: "e.g. Stripe, Brex, OpenAI", required: true }
      ]
    },
    {
      title: "Antler Company Founder Details",
      slug: "antler-company-founder",
      category: "Research & Intelligence",
      promptTemplate: "do a deep dive on founders of Antler company: {{company}}",
      fields: [
        { key: "company", label: "Company Name", placeholder: "e.g. Xalts, Razorpay", required: true }
      ]
    },
    {
      title: "YC Company Details",
      slug: "yc-company-details",
      category: "Research & Intelligence",
      promptTemplate: "Tell me about what this YC company called {{company}} does",
      fields: [
        { key: "company", label: "Company Name", placeholder: "e.g. Stripe, Airbnb, Cred", required: true }
      ]
    },
    {
      title: "Antler Company Details",
      slug: "antler-company-details",
      category: "Research & Intelligence",
      promptTemplate: "Tell me about what this Antler company called {{company}} does",
      fields: [
        { key: "company", label: "Company Name", placeholder: "e.g. Razorpay, Cred", required: true }
      ]
    },
    {
      title: "LinkedIn Viral Post Research",
      slug: "linkedin-viral-post",
      category: "Research & Intelligence",
      promptTemplate: "Tell a viral post by {{person name}} on LinkedIn",
      fields: [
        { key: "person name", label: "Person Name", placeholder: "e.g. Ankur Warikoo, Shradha Sharma", required: true }
      ]
    },
    {
      title: "Reddit Viral Post Research",
      slug: "reddit-viral-post",
      category: "Research & Intelligence",
      promptTemplate: "Tell me about a viral post on Reddit about {{person name}}",
      fields: [
        { key: "person name", label: "Person Name", placeholder: "e.g. Naval Ravikant, Lex Fridman", required: true }
      ]
    },
    {
      title: "Email Draft",
      slug: "email-draft",
      category: "Communication",
      promptTemplate: "Draft me a email for {{subject}}",
      fields: [
        { key: "subject", label: "Email Subject / Purpose", placeholder: "e.g. job application follow-up, meeting request", required: true }
      ]
    },
    {
      title: "Podcaster - Guest Insight Questions",
      slug: "podcaster-guest-insight",
      category: "Communication",
      promptTemplate: "You are an elite podcast pre-production assistant. Build a guest-history-aligned interview plan for episode theme {{episode_theme}}.\n\nGuest Name: {{guest_name}}\nRole/Title: {{guest_role}}\nAudience Type: {{audience_type}}\nDesired Tone: {{interview_tone}}\nTarget Episode Length (minutes): {{episode_length_minutes}}\nGuest Bio / Profile Links: {{guest_bio}}\nMajor Milestones Timeline: {{guest_milestones}}\nNotable Achievements: {{guest_achievements}}\nSensitive Topics to Avoid: {{sensitive_topics}}\n\nRequirements:\n1) Ask exactly 20 main questions and align each question to specific guest history.\n2) For each question include: history reference used, why it matters for listeners, one follow-up prompt, priority tag (Must-Ask/Good-to-Ask/Optional), estimated time in minutes, and relevance score (1-10).\n3) Use this exact distribution: Origin story (3), Turning points (4), Challenges/failures (3), Signature work/decision process (3), Industry insights (3), Future plans (2), Personal close/rapid fire (2).\n4) Apply duplicate-question check: no repeated intent across main questions.\n5) Apply risk filter: if a question can touch sensitive topics, flag it and provide a safer alternative phrasing.\n6) End with a recommended interview flow timeline and Top 5 must-ask questions.",
      fields: [
        { key: "guest_name", label: "Guest Name", placeholder: "e.g. Kunal Shah", required: true },
        { key: "episode_theme", label: "Episode Theme", placeholder: "e.g. Building resilient startups in India", required: true },
        { key: "guest_role", label: "Guest Role / Title", placeholder: "e.g. Founder and CEO at CRED", required: true },
        { key: "guest_bio", label: "Guest Bio / Profile Links", placeholder: "Paste a short bio and relevant profile links", required: true, multiline: true, rows: 4 },
        { key: "guest_milestones", label: "Major Career Milestones", placeholder: "List timeline events with year and milestone", required: true, multiline: true, rows: 5 },
        { key: "guest_achievements", label: "Notable Achievements", placeholder: "Awards, exits, books, launches, major outcomes", required: false, multiline: true, rows: 3 },
        { key: "sensitive_topics", label: "Sensitive Topics to Avoid", placeholder: "Any topics to avoid or approach carefully", required: false, multiline: true, rows: 3 },
        { key: "interview_tone", label: "Desired Interview Tone", placeholder: "e.g. bold, casual, technical, inspiring", required: false },
        { key: "audience_type", label: "Audience Type", placeholder: "e.g. founders, creators, beginners, enterprise leaders", required: false },
        { key: "episode_length_minutes", label: "Target Episode Length (minutes)", placeholder: "e.g. 60", required: false }
      ]
    },
    {
      title: "HR Ops - Onboarding Email",
      slug: "hr-ops",
      category: "HR Automation",
      promptTemplate: "Draft an HR onboarding email to {{email}} for {{name}} using company email {{company_email}} and security code {{security_code}}.",
      fields: [
        { key: "email", label: "Recipient Email", placeholder: "e.g. employee.personal@email.com", required: true },
        { key: "name", label: "Employee Name", placeholder: "e.g. Priya Sharma", required: true },
        { key: "company_email", label: "Company Email", placeholder: "e.g. priya.sharma@company.com", required: true },
        { key: "security_code", label: "Security Code", placeholder: "e.g. 123456", required: true }
      ]
    },
    {
      title: "Leadership to HR Handover",
      slug: "leadership-hr-handover",
      category: "HR Automation",
      promptTemplate: "Draft a leadership-to-HR onboarding handover note for {{employee_name}} ({{employee_email}}), role {{role_title}}, immediate manager {{immediate_manager}}, reporting manager {{reporting_manager}}, start date {{start_date}}, employee ID {{employee_id}}, company email {{company_email}}, and security code {{security_code}}.",
      fields: [
        { key: "employee_name", label: "Employee Name", placeholder: "e.g. Rohan Mehta", required: true },
        { key: "employee_email", label: "Employee Personal Email", placeholder: "e.g. rohan.mehta@email.com", required: true },
        { key: "role_title", label: "Role Title", placeholder: "e.g. Product Analyst", required: true },
        { key: "immediate_manager", label: "Immediate Manager", placeholder: "e.g. Anita Sharma", required: true },
        { key: "reporting_manager", label: "Reporting Manager", placeholder: "e.g. Vikram Singh", required: true },
        { key: "start_date", label: "Start Date", placeholder: "e.g. 2026-04-01", required: true },
        { key: "employee_id", label: "Employee ID", placeholder: "e.g. EMP-12345", required: true },
        { key: "company_email", label: "Company Email", placeholder: "e.g. rohan.mehta@company.com", required: true },
        { key: "security_code", label: "Security Code", placeholder: "e.g. 123456", required: true },
        { key: "hr_email", label: "HR Email", placeholder: "e.g. hr@company.com", required: true }
      ]
    },
    {
      title: "HR Release Email",
      slug: "hr-release",
      category: "HR Automation",
      promptTemplate: "Draft an HR release/offboarding email for {{employee_name}} ({{employee_email}}) with last working day {{last_working_day}}, reason {{reason}}, final settlement {{final_settlement}}, and return instructions. Keep it professional and supportive.",
      fields: [
        { key: "employee_name", label: "Employee Name", placeholder: "e.g. Rohan Mehta", required: true },
        { key: "employee_email", label: "Employee Email", placeholder: "e.g. rohan.mehta@email.com", required: true },
        { key: "last_working_day", label: "Last Working Day", placeholder: "e.g. 2026-03-31", required: true },
        { key: "reason", label: "Reason for Release", placeholder: "e.g. Resignation, Termination, Contract End", required: true },
        { key: "final_settlement", label: "Final Settlement Details", placeholder: "e.g. Pending salary, gratuity, dues", required: true },
        { key: "hr_manager_name", label: "HR Manager Name", placeholder: "e.g. Priya Sharma", required: true }
      ]
    },
    {
      title: "Experience Letter",
      slug: "experience-letter",
      category: "HR Automation",
      promptTemplate: "Generate a professional experience letter for {{employee_name}} who worked as {{designation}} in {{department}} from {{joining_date}} to {{leaving_date}}. Manager: {{manager_name}}. Include key responsibilities and achievements. Note: This needs manual review and authorized signature to be legally valid.",
      fields: [
        { key: "employee_name", label: "Employee Name", placeholder: "e.g. Rohan Mehta", required: true },
        { key: "designation", label: "Designation / Role", placeholder: "e.g. Product Analyst", required: true },
        { key: "department", label: "Department", placeholder: "e.g. Product Management", required: true },
        { key: "joining_date", label: "Joining Date", placeholder: "e.g. 2023-06-01", required: true },
        { key: "leaving_date", label: "Leaving Date", placeholder: "e.g. 2026-03-31", required: true },
        { key: "manager_name", label: "Reporting Manager Name", placeholder: "e.g. Anita Sharma", required: true },
        { key: "company_name", label: "Company Name", placeholder: "e.g. TechCorp India", required: true },
        { key: "authorized_signatory_name", label: "Authorized Signatory Name", placeholder: "e.g. Priya Sharma", required: true },
        { key: "authorized_signatory_title", label: "Authorized Signatory Title", placeholder: "e.g. HR Manager", required: true },
        { key: "company_letterhead_url", label: "Company Letterhead Image URL (optional)", placeholder: "https://example.com/letterhead.png", required: false },
        { key: "signature_image_url", label: "E-Signature Image URL (optional)", placeholder: "https://example.com/signature.png", required: false }
      ]
    },
    {
      title: "College Comparison",
      slug: "college-comparison",
      category: "Learning & Education",
      promptTemplate: "Compare colleges {{college 1}} and {{college 2}} and tell me which is overall better",
      fields: [
        { key: "college 1", label: "College 1", placeholder: "e.g. IIT Bombay, NIT Trichy", required: true },
        { key: "college 2", label: "College 2", placeholder: "e.g. IIIT Hyderabad, VIT Vellore", required: true }
      ]
    },
    {
      title: "Country Comparison to Settle",
      slug: "country-comparison",
      category: "General Lookup",
      promptTemplate: "Country comparison to settle between {{country 1}} and {{country 2}}",
      fields: [
        { key: "country 1", label: "Country 1", placeholder: "e.g. Canada, Australia", required: true },
        { key: "country 2", label: "Country 2", placeholder: "e.g. Germany, Singapore", required: true }
      ]
    },
    {
      title: "University Comparison Abroad",
      slug: "university-comparison",
      category: "Learning & Education",
      promptTemplate: "Comparison between universities abroad: Compare university {{university 1}} and {{university 2}} and tell me which is overall better",
      fields: [
        { key: "university 1", label: "University 1", placeholder: "e.g. MIT, Stanford", required: true },
        { key: "university 2", label: "University 2", placeholder: "e.g. Oxford, Harvard", required: true }
      ]
    },
    {
      title: "Best Faculties at College",
      slug: "best-faculties-college",
      category: "Learning & Education",
      promptTemplate: "Some of the best faculties at {{college name}} in {{department}} at {{campus}}",
      fields: [
        { key: "college name", label: "College Name", placeholder: "e.g. IIT Kanpur", required: true },
        { key: "department", label: "Department", placeholder: "e.g. Computer Science, Mechanical", required: true },
        { key: "campus", label: "Campus (optional)", placeholder: "e.g. Main campus", required: false }
      ]
    },
    {
      title: "Best Faculties at School",
      slug: "best-faculties-school",
      category: "Learning & Education",
      promptTemplate: "Some of the best faculties at {{school}} in {{city}} for {{subject}}",
      fields: [
        { key: "school", label: "School Name", placeholder: "e.g. DPS RK Puram", required: true },
        { key: "city", label: "City", placeholder: "e.g. Delhi, Mumbai", required: true },
        { key: "subject", label: "Subject", placeholder: "e.g. Physics, Mathematics", required: true }
      ]
    },
    {
      title: "Best Coaching Institutes",
      slug: "best-coaching",
      category: "Learning & Education",
      promptTemplate: "Best coaching institutes to prepare for {{exam}}",
      fields: [
        { key: "exam", label: "Exam Name", placeholder: "e.g. JEE Advanced, NEET, UPSC", required: true }
      ]
    },
    {
      title: "Best Restaurant in City",
      slug: "best-restaurant",
      category: "General Lookup",
      promptTemplate: "Best restaurant in city {{city}}",
      fields: [
        { key: "city", label: "City Name", placeholder: "e.g. Mumbai, Bangalore, Ahmedabad", required: true }
      ]
    },
    {
      title: "Catch me up on Enterprise or Individual communications",
      slug: "gmail-catchup",
      category: "Communication",
      promptTemplate: "Connect Gmail, fetch recent emails in real time, and summarize key updates based on my topic and label",
      embedUrl: "https://youtu.be/GqurWrKfpic",
      fields: [
        { key: "catchup_topic", label: "What do you want to track?", placeholder: "e.g. Passport", required: true },
        { key: "gmail_label", label: "Gmail Label", placeholder: "e.g. Book Appointment", required: true },
        { key: "lookback_days", label: "Lookback Window in Days (optional)", placeholder: "e.g. 30", required: false }
      ]
    },
    {
      title: "Catch me up on Enterprise or Individual meetings and tasks",
      slug: "project-reminders",
      category: "Communication",
      promptTemplate: "Connect Google Calendar, fetch meetings and tasks in real time, and summarize key updates",
      embedUrl: "https://youtu.be/iyejLV7W3SY",
      fields: [
        { key: "task subject", label: "Focus topic (optional)", placeholder: "e.g. Website Redesign, Client Onboarding", required: false },
        { key: "past_hours", label: "Recent Past Window in Hours (optional)", placeholder: "e.g. 2", required: false },
        { key: "ahead_hours", label: "Upcoming Window in Hours (optional)", placeholder: "e.g. 24", required: false }
      ]
    },
    {
      title: "Research Competitors",
      slug: "research-competitors",
      category: "Sales & Business",
      promptTemplate: "Research my main competitors {{competitor names}} and create a detailed Google Doc report with their strengths, weaknesses, pricing, recent news and possible future plans",
      embedUrl: "https://youtu.be/iyejLV7W3SY",
      fields: [
        { key: "competitor names", label: "Competitor Names (comma separated)", placeholder: "e.g. Canva, Figma, Notion", required: true }
      ]
    },
    {
      title: "Personalized Pitch Emails",
      slug: "pitch-emails",
      category: "Sales & Business",
      promptTemplate: "I have a Google Sheet with potential investors (columns: Name, Email, Focus Areas). Draft personalized cold pitch emails for each one highlighting why my startup fits their investment thesis and save all drafts in Google Docs.",
      embedUrl: "https://youtu.be/kh2_4JGzMdo",
      fields: [
        { key: "sheet_url", label: "Google Sheet URL", placeholder: "https://docs.google.com/spreadsheets/d/...", required: true },
        { key: "startup_name", label: "Your Startup Name", placeholder: "e.g. Taskify AI", required: true }
      ]
    },
    {
      title: "Send Pitch Emails from Google Docs",
      slug: "send-doc-emails",
      category: "Sales & Business",
      promptTemplate: "Attach a Google Doc containing pitch email drafts and send those emails directly via Gmail.",
      embedUrl: "https://youtu.be/3BIHszVxZXc",
      fields: [
        { key: "doc_url", label: "Google Doc URL", placeholder: "https://docs.google.com/document/d/...", required: true },
        { key: "recipient_emails", label: "Fallback Recipient Emails (optional)", placeholder: "email1@domain.com, email2@domain.com", required: false },
        { key: "default_subject", label: "Default Subject (optional)", placeholder: "Quick intro - startup fit", required: false }
      ]
    },
    {
      title: "Weekly Class Timetable Generator",
      slug: "weekly-timetable",
      category: "Learning & Education",
      promptTemplate: "You are a school timetable formatter and auditor. Use the exact user-provided 5-day, 7-period manual grid for {{class_name}}. Do not auto-reassign slots.\n\nManual Slot Entries (Subject - Teacher):\nMonday: P1 {{mon_p1}}, P2 {{mon_p2}}, P3 {{mon_p3}}, P4 {{mon_p4}}, P5 {{mon_p5}}, P6 {{mon_p6}}, P7 {{mon_p7}}\nTuesday: P1 {{tue_p1}}, P2 {{tue_p2}}, P3 {{tue_p3}}, P4 {{tue_p4}}, P5 {{tue_p5}}, P6 {{tue_p6}}, P7 {{tue_p7}}\nWednesday: P1 {{wed_p1}}, P2 {{wed_p2}}, P3 {{wed_p3}}, P4 {{wed_p4}}, P5 {{wed_p5}}, P6 {{wed_p6}}, P7 {{wed_p7}}\nThursday: P1 {{thu_p1}}, P2 {{thu_p2}}, P3 {{thu_p3}}, P4 {{thu_p4}}, P5 {{thu_p5}}, P6 {{thu_p6}}, P7 {{thu_p7}}\nFriday: P1 {{fri_p1}}, P2 {{fri_p2}}, P3 {{fri_p3}}, P4 {{fri_p4}}, P5 {{fri_p5}}, P6 {{fri_p6}}, P7 {{fri_p7}}\n\nRequirements:\n1) Render a clean timetable grid exactly in Mon-Fri rows and Period 1-7 columns using the slot values above.\n2) Keep entries exactly as provided. Do not optimize, reshuffle, or replace subjects/teachers.\n3) Validate and then report: duplicate overloads, too many consecutive same-subject periods, and any obvious teacher scheduling risks.\n4) Add a Subject Load Summary table: Subject | Teacher | Periods per Week.\n5) End with a short Recommendations section with only non-destructive suggestions (no slot changes unless user asks).",
      fields: [
        { key: "class_name", label: "Class / Grade", placeholder: "e.g. Class 8 - Section A", required: true },
        { key: "mon_p1", label: "Monday - Period 1", placeholder: "e.g. Mathematics - Mr. Sharma", required: true },
        { key: "mon_p2", label: "Monday - Period 2", placeholder: "e.g. English - Ms. Khan", required: true },
        { key: "mon_p3", label: "Monday - Period 3", placeholder: "e.g. Science - Ms. Patel", required: true },
        { key: "mon_p4", label: "Monday - Period 4", placeholder: "e.g. Hindi - Mr. Verma", required: true },
        { key: "mon_p5", label: "Monday - Period 5", placeholder: "e.g. Social Studies - Ms. Gupta", required: true },
        { key: "mon_p6", label: "Monday - Period 6", placeholder: "e.g. Computer - Mr. Singh", required: true },
        { key: "mon_p7", label: "Monday - Period 7", placeholder: "e.g. PT - Coach Yadav", required: true },
        { key: "tue_p1", label: "Tuesday - Period 1", placeholder: "e.g. Mathematics - Mr. Sharma", required: true },
        { key: "tue_p2", label: "Tuesday - Period 2", placeholder: "e.g. English - Ms. Khan", required: true },
        { key: "tue_p3", label: "Tuesday - Period 3", placeholder: "e.g. Science - Ms. Patel", required: true },
        { key: "tue_p4", label: "Tuesday - Period 4", placeholder: "e.g. Hindi - Mr. Verma", required: true },
        { key: "tue_p5", label: "Tuesday - Period 5", placeholder: "e.g. Social Studies - Ms. Gupta", required: true },
        { key: "tue_p6", label: "Tuesday - Period 6", placeholder: "e.g. Computer - Mr. Singh", required: true },
        { key: "tue_p7", label: "Tuesday - Period 7", placeholder: "e.g. Library - Ms. Roy", required: true },
        { key: "wed_p1", label: "Wednesday - Period 1", placeholder: "e.g. Mathematics - Mr. Sharma", required: true },
        { key: "wed_p2", label: "Wednesday - Period 2", placeholder: "e.g. English - Ms. Khan", required: true },
        { key: "wed_p3", label: "Wednesday - Period 3", placeholder: "e.g. Science - Ms. Patel", required: true },
        { key: "wed_p4", label: "Wednesday - Period 4", placeholder: "e.g. Hindi - Mr. Verma", required: true },
        { key: "wed_p5", label: "Wednesday - Period 5", placeholder: "e.g. Social Studies - Ms. Gupta", required: true },
        { key: "wed_p6", label: "Wednesday - Period 6", placeholder: "e.g. Art - Ms. Das", required: true },
        { key: "wed_p7", label: "Wednesday - Period 7", placeholder: "e.g. Computer - Mr. Singh", required: true },
        { key: "thu_p1", label: "Thursday - Period 1", placeholder: "e.g. Mathematics - Mr. Sharma", required: true },
        { key: "thu_p2", label: "Thursday - Period 2", placeholder: "e.g. English - Ms. Khan", required: true },
        { key: "thu_p3", label: "Thursday - Period 3", placeholder: "e.g. Science - Ms. Patel", required: true },
        { key: "thu_p4", label: "Thursday - Period 4", placeholder: "e.g. Hindi - Mr. Verma", required: true },
        { key: "thu_p5", label: "Thursday - Period 5", placeholder: "e.g. Social Studies - Ms. Gupta", required: true },
        { key: "thu_p6", label: "Thursday - Period 6", placeholder: "e.g. Computer - Mr. Singh", required: true },
        { key: "thu_p7", label: "Thursday - Period 7", placeholder: "e.g. PT - Coach Yadav", required: true },
        { key: "fri_p1", label: "Friday - Period 1", placeholder: "e.g. Mathematics - Mr. Sharma", required: true },
        { key: "fri_p2", label: "Friday - Period 2", placeholder: "e.g. English - Ms. Khan", required: true },
        { key: "fri_p3", label: "Friday - Period 3", placeholder: "e.g. Science - Ms. Patel", required: true },
        { key: "fri_p4", label: "Friday - Period 4", placeholder: "e.g. Hindi - Mr. Verma", required: true },
        { key: "fri_p5", label: "Friday - Period 5", placeholder: "e.g. Social Studies - Ms. Gupta", required: true },
        { key: "fri_p6", label: "Friday - Period 6", placeholder: "e.g. Computer - Mr. Singh", required: true },
        { key: "fri_p7", label: "Friday - Period 7", placeholder: "e.g. Activity - Ms. Roy", required: true },
        { key: "recipient_emails", label: "Recipient Emails", placeholder: "e.g. principal@school.edu, class8a.parents@school.edu", required: false }
      ]
    },
    {
      title: "Tuition Classes Timetable Generator",
      slug: "tuition-timetable",
      category: "Learning & Education",
      promptTemplate: "You are a tuition timetable planner and formatter. Build a clean Monday to Friday timetable from the user-provided 1-hour slots. Classes can be at any time, but each class duration must be exactly 1 hour. Do not auto-add or remove classes.\n\nTuition Batch: {{class_name}}\nMonday slots:\n{{monday_slots}}\nTuesday slots:\n{{tuesday_slots}}\nWednesday slots:\n{{wednesday_slots}}\nThursday slots:\n{{thursday_slots}}\nFriday slots:\n{{friday_slots}}\n\nRules:\n1) Parse each day input as one slot per line in this format: HH:MM-HH:MM | Subject | Teacher.\n2) Keep only valid 1-hour slots. If any slot is invalid, list it in Validation Issues.\n3) Output a final timetable grouped by day and sorted by start time.\n4) Add a Weekly Summary table with total classes per subject and teacher.\n5) End with a short clash check (teacher overlap across same time slots).",
      fields: [
        { key: "class_name", label: "Tuition Batch / Class Name", placeholder: "e.g. Class 10 Science Batch A", required: true },
        { key: "monday_slots", label: "Monday Slots", placeholder: "e.g. 16:00-17:00 | Maths | Mr. Sharma", required: true, multiline: true, rows: 4 },
        { key: "tuesday_slots", label: "Tuesday Slots", placeholder: "e.g. 17:00-18:00 | Physics | Ms. Gupta", required: true, multiline: true, rows: 4 },
        { key: "wednesday_slots", label: "Wednesday Slots", placeholder: "e.g. 18:00-19:00 | Chemistry | Mr. Verma", required: true, multiline: true, rows: 4 },
        { key: "thursday_slots", label: "Thursday Slots", placeholder: "e.g. 15:00-16:00 | English | Ms. Khan", required: true, multiline: true, rows: 4 },
        { key: "friday_slots", label: "Friday Slots", placeholder: "e.g. 19:00-20:00 | Biology | Dr. Das", required: true, multiline: true, rows: 4 },
        { key: "recipient_emails", label: "Recipient Emails", placeholder: "e.g. parent1@email.com, parent2@email.com", required: false }
      ]
    },
    {
      title: "Learning Roadmap",
      slug: "study-plan",
      category: "Learning & Education",
      promptTemplate: "Create a study roadmap in Google Docs, generate practice questions in Google Sheets, and send recurring progress emails via Gmail.",
      embedUrl: "https://youtu.be/7w4XpQjRx58",
      fields: [
        { key: "topic", label: "Study Topic", placeholder: "e.g. Data Structures and Algorithms", required: true },
        { key: "current_level", label: "Current Level (optional)", placeholder: "e.g. beginner, intermediate, advanced", required: false },
        { key: "goal", label: "Goal (optional)", placeholder: "e.g. crack interviews, master system design, exam prep", required: false },
        { key: "duration_months", label: "Duration in Months", placeholder: "e.g. 3", required: false },
        { key: "interval_days", label: "Email Interval (days)", placeholder: "e.g. 1 for daily, 2, 7", required: false },
        { key: "questions_per_day", label: "Questions Per Day", placeholder: "e.g. 20", required: false },
        { key: "recipient_emails", label: "Recipient Emails (optional)", placeholder: "email1@domain.com, email2@domain.com", required: false }
      ]
    }
  ];

  useEffect(() => {

    const handleMessage = (event) => {

      if (event.data?.success) {
        window.location.reload();
      }

    };

    window.addEventListener("message", handleMessage);

    return () => window.removeEventListener("message", handleMessage);

  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("safeSearchByTab", JSON.stringify(safeSearchByTab));
  }, [safeSearchByTab]);

  useEffect(() => {

    const fetchIntegrations = async () => {

      try {

        const user = JSON.parse(localStorage.getItem("user") || "{}");

        if (!user?.id) return;

        const res = await fetch("/api/integrations", {
          headers: {
            "x-user-id": user.id
          }
        });

        const data = await res.json();

        setIntegrations({
          gmail: !!data.gmail,
          calendar: !!data.calendar,
          docs: !!data.docs,
          sheets: !!data.sheets
        });

        if (data.currentPlanName) {
          setCurrentPlanName(data.currentPlanName);

          const updatedUser = {
            ...user,
            currentPlan: { ...(user.currentPlan || {}), name: data.currentPlanName }
          };
          localStorage.setItem("user", JSON.stringify(updatedUser));
        }

      } catch (err) {
        console.error("Failed to fetch integrations", err);
      }

    };

    fetchIntegrations();

  }, [location.pathname]);

  useEffect(() => {
    const isDev = import.meta.env.DEV;
    const baseTitle = isDev ? "Web Explore - Local" : "Web Explore";

    if (location.pathname.startsWith("/search")) document.title = baseTitle;
    else if (location.pathname === "/pricing") document.title = isDev ? "Pricing - Web Explore Local" : "Pricing - Web Explore";
    else if (location.pathname === "/workflows") document.title = isDev ? "Workflows - Web Explore Local" : "Workflows - Web Explore";
    else document.title = baseTitle;
  }, [location.pathname]);

  useEffect(() => {
    const query = new URLSearchParams(location.search).get("query");
    const prefillFromState = location.state?.prefillPrompt;
    const autoRunMode = location.state?.autoRunMode;

    if (id && query) {
      handleUrlSearch(query, id);
    } else if (prefillFromState && location.pathname === "/search") {
      setPrompt(prefillFromState);
      setResponse(null);
      setMode("search");
      setError("");

      if (autoRunMode) {
        handleSubmit(null, prefillFromState, autoRunMode);
      }
    } else if (location.pathname === "/search") {
      setResponse(null);
      setPrompt("");
      setMode("search");
      setError("");
    }
  }, [id, location.search, location.pathname, location.state?.prefillPrompt, location.state?.autoRunMode]);

  useEffect(() => {
    setActiveEmbedSlug("");
  }, [location.pathname]);

  const toggleTheme = () => setTheme(theme === "light" ? "dark" : "light");

  const toggleModelDropdown = () => setIsModelDropdownOpen(!isModelDropdownOpen);

  const selectModel = (model) => {
    setSelectedModel(model);
    setIsModelDropdownOpen(false);
  };

  const generateQuerySlug = (query) =>
    query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);

  const extractYouTubeId = (url = "") => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return "";

    try {
      const parsed = new URL(trimmedUrl);
      const host = parsed.hostname.replace(/^www\./, "").replace(/^m\./, "");
      const pathParts = parsed.pathname.split("/").filter(Boolean);

      if (host === "youtu.be" && pathParts[0]) {
        return pathParts[0];
      }

      if (host.includes("youtube.com") || host.includes("youtube-nocookie.com")) {
        const vParam = parsed.searchParams.get("v");
        if (vParam) return vParam;

        if (["embed", "shorts", "live", "reel"].includes(pathParts[0]) && pathParts[1]) {
          return pathParts[1];
        }
      }
    } catch {
      // Fall back to regex parsing for non-standard/partial URLs.
    }

    const shortMatch = trimmedUrl.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/);
    if (shortMatch?.[1]) return shortMatch[1];

    const embedMatch = trimmedUrl.match(/youtube(?:-nocookie)?\.com\/(?:embed|shorts|live|reel)\/([a-zA-Z0-9_-]{6,})/);
    if (embedMatch?.[1]) return embedMatch[1];

    const watchMatch = trimmedUrl.match(/[?&]v=([a-zA-Z0-9_-]{6,})/);
    if (watchMatch?.[1]) return watchMatch[1];

    return "";
  };

  const debouncedSetPrompt = useCallback(debounce((value) => setPrompt(value), 300), []);

  const connectGoogleTool = async (tool) => {

    try {

      const user = JSON.parse(localStorage.getItem("user") || "{}");

      if (!user?.id) {
        return;
      }

      const res = await fetch(`/api/google/auth?tool=${tool}`, {
        headers: {
          "x-user-id": user.id
        }
      });

      const data = await res.json();

      if (!res.ok) {
        console.error(data.error || "Failed to connect");
        return;
      }

      if (data.authUrl) {
        window.open(data.authUrl, "_blank", "width=500,height=600");
      }

    } catch (err) {
      console.error(err);
    }

  };

  const disconnectGoogleTool = async (tool) => {
    try {
      const user = JSON.parse(localStorage.getItem("user") || "{}");

      if (!user?.id) {
        return;
      }

      const res = await fetch(`/api/google/disconnect?tool=${tool}`, {
        method: "POST",
        headers: {
          "x-user-id": user.id
        }
      });

      const data = await res.json();

      if (!res.ok) {
        console.error(data.error || "Failed to disconnect");
        return;
      }

      setIntegrations((prev) => ({ ...prev, [tool]: false }));
    } catch (err) {
      console.error(err);
    }
  };

  const fetchTodayMeetings = async () => {

  try {

    const user = JSON.parse(localStorage.getItem("user") || "{}");

    if (!user?.id) {
      return;
    }

    const res = await fetch("/api/calendar/meetings", {
      headers: {
        "x-user-id": user.id
      }
    });

    const data = await res.json();

    if (!res.ok) {
      console.error(data.error || "Failed to fetch meetings");
      return;
    }

    // auto fill prompt in chat
    setPrompt(data.message);

    // automatically run AI search
    handleSubmit(null, data.message, "ai");

  } catch (err) {

    console.error(err);

  }

};

  const handleMicClick = () => {
    if (!recognition) {
      console.warn("Speech recognition is not supported in this browser.");
      return;
    }
    if (listening) {
      recognition.stop();
      setListening(false);
    } else {
      setListening(true);
      recognition.start();
      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setPrompt(transcript);
        setListening(false);
        handleSubmit(null, transcript);
      };
      recognition.onerror = (event) => {
        setError("Voice input error: " + event.error);
        setListening(false);
      };
      recognition.onend = () => setListening(false);
    }
  };

  const makeCitationsClickable = (text, citations = []) => {
    return text.replace(/\[(\d+)\]/g, (match, num) => {
      const citation = citations.find((c) => c.id === parseInt(num));
      if (citation) {
        return `<sup class="citation"><a href="${citation.url}" target="_blank" rel="noopener noreferrer">[${num}]</a></sup>`;
      }
      return match;
    });
  };

  const renderMarkdown = (text) => {
    if (!text) return "";
    let html = text
      // Escape HTML entities first
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      // Headers
      .replace(/^#### (.+)$/gm, "<h4>$1</h4>")
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      // Bold + italic
      .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
      // Bold
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      // Italic
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      // Inline code
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      // Horizontal rule
      .replace(/^[-*]{3,}$/gm, "<hr/>")
      // Unordered list items
      .replace(/^[\-\*\•] (.+)$/gm, "<li>$1</li>")
      // Ordered list items
      .replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

    // Wrap consecutive <li> in <ul>
    html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

    // Paragraphs — blank line separates blocks
    const blocks = html.split(/\n{2,}/);
    html = blocks.map((block) => {
      block = block.trim();
      if (!block) return "";
      if (/^<(h[1-4]|ul|ol|li|hr|blockquote)/.test(block)) return block;
      // Single newlines inside a paragraph → <br>
      return `<p>${block.replace(/\n/g, "<br/>")}</p>`;
    }).join("\n");

    return html;
  };

  function shouldShowHeading(text) {
    if (!text) return false;
    const wordCount = text.trim().split(/\s+/).length;
    return wordCount <= 20;
  }

  const fetchImageResults = async (rawQuery, selectedMode = safeSearchByTab.images) => {
    const effectiveQuery = String(rawQuery || "").trim();
    const cacheKey = `${effectiveQuery}::${selectedMode}`;
    if (!effectiveQuery) {
      setImageResults([]);
      setImageResultsQuery("");
      return;
    }

    if (imageResultsQuery === cacheKey && imageResults.length > 0) {
      return;
    }

    setImagesLoading(true);
    try {
      const res = await fetch("/api/search/images", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": user?.id || "",
        },
        body: JSON.stringify({ query: effectiveQuery, safeMode: selectedMode }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to fetch images");
      }

      setImageResults(Array.isArray(data.images) ? data.images : []);
      setImageResultsQuery(cacheKey);
    } catch (err) {
      console.error("Failed to fetch images:", err);
      setImageResults([]);
      setImageResultsQuery(cacheKey);
    } finally {
      setImagesLoading(false);
    }
  };

  const fetchVideoResults = async (rawQuery, selectedMode = safeSearchByTab.videos) => {
    const effectiveQuery = String(rawQuery || "").trim();
    const cacheKey = `${effectiveQuery}::${selectedMode}`;
    if (!effectiveQuery) {
      setVideoResults([]);
      setVideoResultsQuery("");
      return;
    }

    if (videoResultsQuery === cacheKey && videoResults.length > 0) {
      return;
    }

    setVideosLoading(true);
    try {
      const res = await fetch("/api/search/videos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": user?.id || "",
        },
        body: JSON.stringify({ query: effectiveQuery, safeMode: selectedMode }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to fetch videos");
      }

      setVideoResults(data.videos || []);
      setVideoResultsQuery(cacheKey);
    } catch (err) {
      console.error("Failed to fetch videos:", err);
      setVideoResults([]);
      setVideoResultsQuery(cacheKey);
    } finally {
      setVideosLoading(false);
    }
  };

  const fetchShortVideoResults = async (rawQuery, selectedMode = safeSearchByTab.shortVideos) => {
    const effectiveQuery = String(rawQuery || "").trim();
    const cacheKey = `${effectiveQuery}::${selectedMode}`;
    if (!effectiveQuery) {
      setShortVideoResults([]);
      setShortVideoResultsQuery("");
      return;
    }

    if (shortVideoResultsQuery === cacheKey && shortVideoResults.length > 0) {
      return;
    }

    setShortVideosLoading(true);
    try {
      const res = await fetch("/api/search/short-videos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": user?.id || "",
        },
        body: JSON.stringify({ query: effectiveQuery, safeMode: selectedMode }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to fetch short videos");
      }

      setShortVideoResults(data.videos || []);
      setShortVideoResultsQuery(cacheKey);
    } catch (err) {
      console.error("Failed to fetch short videos:", err);
      setShortVideoResults([]);
      setShortVideoResultsQuery(cacheKey);
    } finally {
      setShortVideosLoading(false);
    }
  };

  const fetchNewsResults = async (rawQuery, selectedMode = safeSearchByTab.news) => {
    const effectiveQuery = String(rawQuery || "").trim();
    const cacheKey = `${effectiveQuery}::${selectedMode}`;
    if (!effectiveQuery) {
      setNewsResults([]);
      setNewsResultsQuery("");
      return;
    }

    if (newsResultsQuery === cacheKey && newsResults.length > 0) {
      return;
    }

    setNewsLoading(true);
    try {
      const res = await fetch("/api/search/news", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": user?.id || "",
        },
        body: JSON.stringify({ query: effectiveQuery, safeMode: selectedMode }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to fetch news");
      }

      setNewsResults(data.news || []);
      setNewsResultsQuery(cacheKey);
    } catch (err) {
      console.error("Failed to fetch news:", err);
      setNewsResults([]);
      setNewsResultsQuery(cacheKey);
    } finally {
      setNewsLoading(false);
    }
  };

  const showTab = async (tab) => {
    setActiveTab(tab);
    const routeQuery = new URLSearchParams(location.search).get("query") || prompt;
    if (tab === "images" && mode === "ai") {
      await fetchImageResults(routeQuery);
    }
    if (tab === "videos") {
      await fetchVideoResults(routeQuery);
    }
    if (tab === "short-videos") {
      await fetchShortVideoResults(routeQuery);
    }
    if (tab === "news") {
      await fetchNewsResults(routeQuery);
    }
  };

  const handleSuggestionClick = (suggestion) => {
    setPrompt(suggestion);
    handleSubmit(null, suggestion);
  };

  const handleAutomateWorkflows = () => {
    navigate("/workflows");
    setIsProfileSidebarOpen(false);
  };

  const handleSubmit = async (e, customPrompt = null, customMode = null) => {
    if (e?.preventDefault) e.preventDefault();
    const query = customPrompt || prompt;
    const activeMode = customMode || mode;

    if (!query.trim()) return;

    setLoading(true);
    setError("");
    setResponse(null);
    setActiveTab("answer");
    setImageResults([]);
    setImageResultsQuery("");
    setVideoResults([]);
    setVideoResultsQuery("");
    setShortVideoResults([]);
    setShortVideoResultsQuery("");
    setNewsResults([]);
    setNewsResultsQuery("");

    const tempId = uuidv4();
    const querySlug = generateQuerySlug(query);

    try {
      let res, data;
      if (activeMode === "search") {
        navigate(`/search/new/${tempId}?query=${encodeURIComponent(query)}`);
        res = await fetch("/api/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": user?.id || "",
          },
          body: JSON.stringify({ query, safeMode: safeSearchByTab.images }),
        });
      } else {
        navigate(`/search/ai/new/${tempId}?query=${encodeURIComponent(query)}`);
        res = await fetch("/api/generate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": user?.id || "",
          },
          body: JSON.stringify({ prompt: query, model: selectedModel }),
        });
      }

      data = await res.json();

      if (!res.ok) {
        if (data.upgradeNeeded === true) {
          navigate(data.redirectTo || "/pricing");
          setError((data.error || "Plan limit reached") + " → Redirecting to pricing...");
          setTimeout(() => {
            window.location.href = data.redirectTo || "/pricing";
          }, 1800);
          setLoading(false);
          return;
        }
        setError(data.error || "Failed to fetch response");
        setLoading(false);
        return;
      }

      setPrompt(query);
      setMode(activeMode);
      setResponse(data);

      if (activeMode === "search") {
        navigate(`/search/${data.querySlug || querySlug}-${data.finalId}?query=${encodeURIComponent(query)}`);
      } else {
        const finalId = uuidv4();
        navigate(`/search/ai/${querySlug}-${finalId}?query=${encodeURIComponent(query)}`);
      }
    } catch (err) {
      setError("Something went wrong during the request");
    } finally {
      setLoading(false);
    }
  };

  const handleUrlSearch = async (query, searchId) => {
    if (!query || query.length < 3) {
      setError("Invalid or missing query in URL");
      return;
    }

    setLoading(true);
    setError("");
    setResponse(null);
    setImageResults([]);
    setImageResultsQuery("");
    setVideoResults([]);
    setVideoResultsQuery("");
    setShortVideoResults([]);
    setShortVideoResultsQuery("");
    setNewsResults([]);
    setNewsResultsQuery("");

    try {
      let res, data;
      if (searchId.startsWith("ai/") || searchId.startsWith("ai/new/")) {
        res = await fetch("/api/generate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": user?.id || "",
          },
          body: JSON.stringify({ prompt: query, model: selectedModel }),
        });
      } else {
        res = await fetch("/api/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": user?.id || "",
          },
          body: JSON.stringify({ query, safeMode: safeSearchByTab.images }),
        });
      }

      data = await res.json();

      if (!res.ok) {
        if (data.upgradeNeeded === true) {
          navigate(data.redirectTo || "/pricing");
          setError((data.error || "Plan limit reached") + " → Redirecting...");
          setTimeout(() => window.location.href = data.redirectTo || "/pricing", 1800);
          setLoading(false);
          return;
        }
        setError(data.error || "Failed to fetch response");
        setLoading(false);
        return;
      }

      setPrompt(query);
      setMode(searchId.startsWith("ai/") ? "ai" : "search");
      setResponse(data);

      const querySlug = generateQuerySlug(query);
      const finalId = searchId.includes("new/") ? (data.finalId || uuidv4()) : searchId.split("-").pop();

      if (searchId.startsWith("ai/")) {
        navigate(`/search/ai/${querySlug}-${finalId}?query=${encodeURIComponent(query)}`);
      } else {
        navigate(`/search/${querySlug}-${finalId}?query=${encodeURIComponent(query)}`);
      }
    } catch (err) {
      setError("Something went wrong during URL search");
    } finally {
      setLoading(false);
    }
  };

  if (location.pathname.startsWith("/workflow-input/")) {
    const slug = location.pathname.replace("/workflow-input/", "");
    const workflow = workflowCards.find((w) => w.slug === slug);
    const youtubeId = extractYouTubeId(workflow?.embedUrl || "");
    const youtubeEmbedUrl = youtubeId
      ? `https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&rel=0&modestbranding=1&iv_load_policy=3&playsinline=1`
      : "";

    if (!workflow) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
          <p className="text-2xl text-red-600 dark:text-red-400">Workflow not found</p>
        </div>
      );
    }

    const handleChange = (key, value) => {
      setValues((prev) => ({ ...prev, [key]: value }));
    };

    const hasPitchStartupName = (values.startup_name?.trim?.() || "").length > 0;
    const hasPitchSheetUrl = (values.sheet_url?.trim?.() || "").length > 0;
    const hasPitchLocalFile = !!attachedInvestorFile;
    const isPitchUsingLocalFile = hasPitchLocalFile;
    const isPitchIntegrationReady = isPitchUsingLocalFile
      ? integrations.docs
      : integrations.docs && integrations.sheets;
    const canExecutePitchEmails = hasPitchStartupName && (hasPitchSheetUrl || hasPitchLocalFile);
    const pitchEmailsMissingRequirements = [
      !hasPitchStartupName ? "Startup name is required" : "",
      !hasPitchSheetUrl && !hasPitchLocalFile ? "Add a Google Sheet URL or attach a local investor file" : "",
      !integrations.docs ? "Connect Google Docs" : "",
      !isPitchUsingLocalFile && !integrations.sheets ? "Connect Google Sheets" : ""
    ].filter(Boolean);

    const isValid = workflow.slug === "pitch-emails"
      ? canExecutePitchEmails
      : workflow.slug === "send-doc-emails"
      ? !!attachedDocFile || (values.doc_url?.trim?.() || "").length > 0
      : workflow.fields.every(
          (f) => !f.required || (values[f.key]?.trim?.() || "").length > 0
        );

    const integrationWorkflowSlugs = new Set([
      "gmail-catchup",
      "project-reminders",
      "research-competitors",
      "hr-ops",
      "leadership-hr-handover",
      "hr-release",
      "experience-letter",
      "pitch-emails",
      "send-doc-emails",
      "study-plan",
      "podcaster-guest-insight",
      "weekly-timetable"
    ]);
    const isIntegrationWorkflow = integrationWorkflowSlugs.has(workflow.slug);

    const isTimetableWorkflow = workflow.slug === "weekly-timetable";

    const canSavePodcasterToDocs = workflow.slug === "podcaster-guest-insight" && integrations.docs;
    const canSaveWeeklyToDocs = isTimetableWorkflow && integrations.docs;
    const canSendWeeklyByEmail = isTimetableWorkflow && integrations.gmail;
    const canSaveTuitionToDocs = workflow.slug === "tuition-timetable" && integrations.docs;

    const buildWorkflowPrompt = () => {
      let finalPrompt = workflow.promptTemplate;
      Object.entries(values).forEach(([k, v]) => {
        finalPrompt = finalPrompt.replace(`{{${k}}}`, (v || "").trim());
      });
      return finalPrompt;
    };

    const handleGenerate = async () => {
      if (!isValid || isExecutingWorkflow) return;
      setIsExecutingWorkflow(true);

      try {

      if (workflow.slug === "gmail-catchup") {

      try {

        const res = await fetch("/api/workflows/gmail-catchup/start", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": user?.id || ""
          },
          body: JSON.stringify({
            gmail_label: values.gmail_label || null,
            catchup_topic: values.catchup_topic || "",
            lookback_days: values.lookback_days || ""
          })
        });

        const data = await res.json();

        if (!res.ok) {
          console.error(data.error || "Automation failed");
          return;
        }

        navigate("/search", {
          state: {
            prefillPrompt: data.summary || "Summarize my latest Gmail updates",
            autoRunMode: "ai"
          }
        });

        } catch (err) {
          console.error("Failed to start automation", err);
        }

        return;
      }

      if (workflow.slug === "research-competitors") {

        try {

          const competitorNames = (values["competitor names"] || "").trim();

          const res = await fetch("/api/workflows/research-competitors/start", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-user-id": user?.id || ""
            },
            body: JSON.stringify({
              competitor_names: competitorNames
            })
          });

          const data = await res.json();

          if (!res.ok) {
            console.error(data.error || "Failed to generate competitor report");
            return;
          }

          if (data.docUrl) {
            window.open(data.docUrl, "_blank");
          }

          navigate("/search", {
            state: {
              prefillPrompt: data.summary || "Summarize competitor analysis",
              autoRunMode: "ai"
            }
          });

        } catch (err) {
          console.error("Failed to start competitor docs automation", err);
        }

        return;
      }

      if (workflow.slug === "project-reminders") {

        try {

          const focusTopic = (values["task subject"] || "").trim();
          const pastHours = (values["past_hours"] || "").trim();
          const aheadHours = (values["ahead_hours"] || "").trim();

          const params = new URLSearchParams();
          if (focusTopic) params.set("focus", focusTopic);
          if (pastHours) params.set("pastHours", pastHours);
          if (aheadHours) params.set("aheadHours", aheadHours);

          const query = params.toString() ? `?${params.toString()}` : "";

          const res = await fetch(`/api/calendar/meetings${query}`, {
            headers: {
              "x-user-id": user?.id || ""
            }
          });

          const data = await res.json();

          if (!res.ok) {
            console.error(data.error || "Failed to fetch meetings and tasks");
            return;
          }

          const summaryPrompt = data.message || "Summarize my latest calendar meetings and tasks";
          const finalPrompt = focusTopic
            ? `${summaryPrompt}\n\nFocus topic: ${focusTopic}\nInstructions:\n1) Prioritize only focus-related items first.\n2) If no exact matches found, clearly say no direct match and then provide at most 2 closest items.\n3) Keep output concise with: Top Updates, Action Items, and Priority.`
            : summaryPrompt;

          navigate("/search", {
            state: {
              prefillPrompt: finalPrompt,
              autoRunMode: "ai"
            }
          });

        } catch (err) {
          console.error("Failed to start calendar automation", err);
        }

        return;
      }

      if (workflow.slug === "pitch-emails") {

        try {
          const hasLocalFile = !!attachedInvestorFile;

          let docsConnected = !!integrations.docs;
          let sheetsConnected = !!integrations.sheets;

          try {
            const integrationsRes = await fetch("/api/integrations", {
              headers: {
                "x-user-id": user?.id || ""
              }
            });

            const integrationsContentType = integrationsRes.headers.get("content-type") || "";
            let integrationsData = null;

            if (integrationsContentType.includes("application/json")) {
              integrationsData = await integrationsRes.json();
            } else {
              await integrationsRes.text();
            }

            if (integrationsRes.ok && integrationsData) {
              docsConnected = !!integrationsData.docs;
              sheetsConnected = !!integrationsData.sheets;
              setIntegrations((prev) => ({
                ...prev,
                docs: docsConnected,
                sheets: sheetsConnected
              }));
            }
          } catch (integrationErr) {
            console.error("Pitch workflow integration pre-check failed", integrationErr);
          }

          if (!docsConnected || (!hasLocalFile && !sheetsConnected)) {
            const missing = [
              !docsConnected ? "Google Docs" : "",
              !hasLocalFile && !sheetsConnected ? "Google Sheets" : ""
            ].filter(Boolean);

            showToast(`Please connect ${missing.join(" and ")} and try again.`, "error");
            return;
          }

          const res = hasLocalFile
            ? await fetch("/api/workflows/pitch-emails/upload-start", {
                method: "POST",
                headers: {
                  "x-user-id": user?.id || ""
                },
                body: (() => {
                  const formData = new FormData();
                  formData.append("investors_file", attachedInvestorFile);
                  formData.append("startup_name", values.startup_name || "");
                  return formData;
                })()
              })
            : await fetch("/api/workflows/pitch-emails/start", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-user-id": user?.id || ""
                },
                body: JSON.stringify({
                  sheet_url: values.sheet_url || "",
                  startup_name: values.startup_name || ""
                })
              });

          let data = null;
          const contentType = res.headers.get("content-type") || "";
          if (contentType.includes("application/json")) {
            data = await res.json();
          } else {
            const rawText = await res.text();
            data = {
              error: rawText?.trim?.() || "Unexpected non-JSON response from server"
            };
          }

          if (!res.ok) {
            showToast(data.error || "Failed to generate pitch emails", "error");
            console.error(data.error || "Failed to generate pitch emails");
            return;
          }

          if (data.docUrl) {
            window.open(data.docUrl, "_blank");
          }

          navigate("/search", {
            state: {
              prefillPrompt: data.summary || "Summarize my investor pitch email drafts",
              autoRunMode: "ai"
            }
          });
        } catch (err) {
          showToast(`Failed to start pitch email automation: ${err?.message || "Unexpected error"}`, "error");
          console.error("Failed to start pitch email automation", err);
        }

        return;
      }

      if (workflow.slug === "send-doc-emails") {

        try {
          const hasLocalFile = !!attachedDocFile;

          const res = hasLocalFile
            ? await fetch("/api/workflows/send-doc-emails/upload-start", {
                method: "POST",
                headers: { "x-user-id": user?.id || "" },
                body: (() => {
                  const formData = new FormData();
                  formData.append("doc_file", attachedDocFile);
                  formData.append("recipient_emails", values.recipient_emails || "");
                  formData.append("default_subject", values.default_subject || "");
                  return formData;
                })()
              })
            : await fetch("/api/workflows/send-doc-emails/start", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-user-id": user?.id || ""
                },
                body: JSON.stringify({
                  doc_url: values.doc_url || "",
                  recipient_emails: values.recipient_emails || "",
                  default_subject: values.default_subject || ""
                })
              });

          const data = await res.json();

          if (!res.ok) {
            console.error(data.error || "Failed to send emails from doc");
            return;
          }

          navigate("/search", {
            state: {
              prefillPrompt: data.summary || "Summarize my email send activity",
              autoRunMode: "ai"
            }
          });
        } catch (err) {
          console.error("Failed to start doc-to-gmail automation", err);
        }

        return;
      }

      if (workflow.slug === "study-plan") {

        try {
          const res = await fetch("/api/workflows/study-plan/start", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-user-id": user?.id || ""
            },
            body: JSON.stringify({
              topic: values.topic || "",
              current_level: values.current_level || "",
              goal: values.goal || "",
              duration_months: values.duration_months || "",
              interval_days: values.interval_days || "",
              questions_per_day: values.questions_per_day || "",
              recipient_emails: values.recipient_emails || ""
            })
          });

          const data = await res.json();

          if (!res.ok) {
            console.error(data.error || "Failed to start learning roadmap workflow");
            return;
          }

          if (data.docUrl) {
            window.open(data.docUrl, "_blank");
          }
          if (data.sheetUrl) {
            window.open(data.sheetUrl, "_blank");
          }

          navigate("/search", {
            state: {
              prefillPrompt: data.summary || "Summarize my learning roadmap, practice sheet, and email schedule",
              autoRunMode: "ai"
            }
          });
        } catch (err) {
          console.error("Failed to start study-plan automation", err);
        }

        return;
      }

      if (workflow.slug === "hr-ops") {
        if (!isUltraUser) {
          navigate("/pricing");
          return;
        }

        try {
          const res = await fetch("/api/workflows/hr-ops/start", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-user-id": user?.id || ""
            },
            body: JSON.stringify({
              email: values.email || "",
              name: values.name || "",
              company_email: values.company_email || "",
              security_code: values.security_code || ""
            })
          });

          const data = await res.json();

          if (!res.ok) {
            console.error(data.error || "Failed to start HR Ops workflow");
            return;
          }

          navigate("/search", {
            state: {
              prefillPrompt: data.summary || "Summarize my HR onboarding email activity",
              autoRunMode: "ai"
            }
          });
        } catch (err) {
          console.error("Failed to start HR Ops automation", err);
        }

        return;
      }

      if (workflow.slug === "leadership-hr-handover") {
        if (!isUltraUser) {
          navigate("/pricing");
          return;
        }

        try {
          const res = await fetch("/api/workflows/leadership-hr-handover/start", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-user-id": user?.id || ""
            },
            body: JSON.stringify({
              employee_name: values.employee_name || "",
              employee_email: values.employee_email || "",
              role_title: values.role_title || "",
              immediate_manager: values.immediate_manager || "",
              reporting_manager: values.reporting_manager || "",
              start_date: values.start_date || "",
              employee_id: values.employee_id || "",
              company_email: values.company_email || "",
              security_code: values.security_code || "",
              hr_email: values.hr_email || ""
            })
          });

          const data = await res.json();

          if (!res.ok) {
            console.error(data.error || "Failed to start Leadership HR Handover workflow");
            return;
          }

          navigate("/search", {
            state: {
              prefillPrompt: data.summary || "Summarize my leadership to HR handover activity",
              autoRunMode: "ai"
            }
          });
        } catch (err) {
          console.error("Failed to start Leadership HR Handover automation", err);
        }

        return;
      }

      if (workflow.slug === "hr-release") {
        if (!isUltraUser) {
          navigate("/pricing");
          return;
        }

        try {
          const res = await fetch("/api/workflows/hr-release/start", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-user-id": user?.id || ""
            },
            body: JSON.stringify({
              employee_name: values.employee_name || "",
              employee_email: values.employee_email || "",
              last_working_day: values.last_working_day || "",
              reason: values.reason || "",
              final_settlement: values.final_settlement || "",
              hr_manager_name: values.hr_manager_name || ""
            })
          });

          const data = await res.json();

          if (!res.ok) {
            console.error(data.error || "Failed to start HR Release workflow");
            return;
          }

          navigate("/search", {
            state: {
              prefillPrompt: data.summary || "Summarize my HR release email activity",
              autoRunMode: "ai"
            }
          });
        } catch (err) {
          console.error("Failed to start HR Release automation", err);
        }

        return;
      }

      if (workflow.slug === "experience-letter") {
        if (!isUltraUser) {
          navigate("/pricing");
          return;
        }

        try {
          const res = await fetch("/api/workflows/experience-letter/start", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-user-id": user?.id || ""
            },
            body: JSON.stringify({
              employee_name: values.employee_name || "",
              designation: values.designation || "",
              department: values.department || "",
              joining_date: values.joining_date || "",
              leaving_date: values.leaving_date || "",
              manager_name: values.manager_name || "",
              company_name: values.company_name || "",
              authorized_signatory_name: values.authorized_signatory_name || "",
              authorized_signatory_title: values.authorized_signatory_title || ""
            })
          });

          const data = await res.json();

          if (!res.ok) {
            console.error(data.error || "Failed to start Experience Letter workflow");
            return;
          }

          await downloadExperienceLetterPdf({
            employeeName: values.employee_name || "Employee",
            companyName: values.company_name || "Company",
            issueDate: data.issueDate,
            paragraphs: data.paragraphs || [],
            signatoryName: values.authorized_signatory_name || data.signatoryName || "Authorized Signatory",
            signatoryTitle: values.authorized_signatory_title || data.signatoryTitle || "HR Manager",
            letterheadUrl: (values.company_letterhead_url || "").trim(),
            signatureUrl: (values.signature_image_url || "").trim()
          });
          showToast("Experience letter PDF downloaded. Review and sign before issuing.", "success");
        } catch (err) {
          console.error("Failed to start Experience Letter automation", err);
          showToast("Failed to generate experience letter PDF", "error");
        }

        return;
      }

      if (isTimetableWorkflow) {
        showToast("Use the buttons below: Generate + Save in Docs or Generate + Send Email.", "info");
        return;
      }


      const finalPrompt = buildWorkflowPrompt();

      if (workflow.slug === "podcaster-guest-insight") {
        navigate("/search", {
          state: {
            prefillPrompt: finalPrompt,
            autoRunMode: "ai"
          }
        });
        return;
      }

      if (workflow.slug === "tuition-timetable") {
        navigate("/search", {
          state: {
            prefillPrompt: finalPrompt,
            autoRunMode: "ai"
          }
        });
        return;
      }

      navigate("/search", { state: { prefillPrompt: finalPrompt } });
      } finally {
        setIsExecutingWorkflow(false);
      }
    };

    const handleGenerateAndSavePodcasterDoc = async () => {
      if (workflow.slug !== "podcaster-guest-insight" || !isValid || isExecutingWorkflow) return;

      if (!isUltraUser) {
        navigate("/pricing");
        return;
      }

      if (!integrations.docs) {
        showToast("Please connect Google Docs first.", "error");
        return;
      }

      setIsExecutingWorkflow(true);
      try {
        const finalPrompt = buildWorkflowPrompt();

        const res = await fetch("/api/workflows/podcaster-guest-insight/start", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": user?.id || ""
          },
          body: JSON.stringify({
            prompt: finalPrompt,
            guest_name: values.guest_name || "",
            episode_theme: values.episode_theme || ""
          })
        });

        const data = await res.json();

        if (!res.ok) {
          showToast(data.error || "Failed to generate and save podcast questions", "error");
          return;
        }

        if (data.docUrl) {
          window.open(data.docUrl, "_blank");
        }

        showToast("Full interview plan saved to Google Docs.", "success");

        navigate("/search", {
          state: {
            prefillPrompt: finalPrompt,
            autoRunMode: "ai"
          }
        });
      } catch (err) {
        console.error("Failed to create podcaster doc", err);
        showToast("Failed to save interview plan to Google Docs", "error");
      } finally {
        setIsExecutingWorkflow(false);
      }
    };

    const handleGenerateAndSaveWeeklyDoc = async () => {
      if (!isTimetableWorkflow || !isValid || isExecutingWorkflow) return;

      if (!isUltraUser) {
        navigate("/pricing");
        return;
      }

      if (!integrations.docs) {
        showToast("Please connect Google Docs first.", "error");
        return;
      }

      setIsExecutingWorkflow(true);
      try {
        const finalPrompt = buildWorkflowPrompt();
        const res = await fetch("/api/workflows/weekly-timetable/save-doc", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": user?.id || ""
          },
          body: JSON.stringify({
            prompt: finalPrompt,
            class_name: values.class_name || ""
          })
        });

        const data = await res.json();

        if (!res.ok) {
          const errorMessage = [data.error, data.details, data.activationUrl]
            .filter(Boolean)
            .join(" ");
          showToast(errorMessage || "Failed to save timetable in Google Docs", "error");
          return;
        }

        if (data.docUrl) {
          window.open(data.docUrl, "_blank");
        }

        showToast("Weekly timetable saved to Google Docs.", "success");

        navigate("/search", {
          state: {
            prefillPrompt: data.summary || finalPrompt,
            autoRunMode: "ai"
          }
        });
      } catch (err) {
        console.error("Failed to save weekly timetable doc", err);
        showToast("Failed to generate and save timetable doc", "error");
      } finally {
        setIsExecutingWorkflow(false);
      }
    };

    const handleGenerateAndSaveTuitionDoc = async () => {
      if (workflow.slug !== "tuition-timetable" || !isValid || isExecutingWorkflow) return;

      if (!isUltraUser) {
        navigate("/pricing");
        return;
      }

      if (!integrations.docs) {
        showToast("Please connect Google Docs first.", "error");
        return;
      }

      setIsExecutingWorkflow(true);
      try {
        const finalPrompt = buildWorkflowPrompt();

        const res = await fetch("/api/workflows/tuition-timetable/save-doc", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": user?.id || ""
          },
          body: JSON.stringify({
            prompt: finalPrompt,
            class_name: values.class_name || ""
          })
        });

        const data = await res.json();

        if (!res.ok) {
          const errorMessage = [data.error, data.details, data.activationUrl].filter(Boolean).join(" ");
          showToast(errorMessage || "Failed to save timetable in Google Docs", "error");
          return;
        }

        if (data.docUrl) {
          window.open(data.docUrl, "_blank");
        }

        showToast("Tuition timetable saved to Google Docs.", "success");

        navigate("/search", {
          state: {
            prefillPrompt: data.summary || finalPrompt,
            autoRunMode: "ai"
          }
        });
      } catch (err) {
        console.error("Failed to save tuition timetable doc", err);
        showToast("Failed to generate and save timetable doc", "error");
      } finally {
        setIsExecutingWorkflow(false);
      }
    };

    const handleGenerateAndSendWeeklyEmail = async () => {
      if (!isTimetableWorkflow || !isValid || isExecutingWorkflow) return;

      if (!isUltraUser) {
        navigate("/pricing");
        return;
      }

      if (!integrations.gmail) {
        showToast("Please connect Gmail first.", "error");
        return;
      }

      if (!(values.recipient_emails?.trim?.() || "").length) {
        showToast("Please enter at least one recipient email.", "error");
        return;
      }

      setIsExecutingWorkflow(true);
      try {
        const finalPrompt = buildWorkflowPrompt();
        const res = await fetch("/api/workflows/weekly-timetable/send-email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": user?.id || ""
          },
          body: JSON.stringify({
            prompt: finalPrompt,
            class_name: values.class_name || "",
            recipient_emails: values.recipient_emails || ""
          })
        });

        const data = await res.json();

        if (!res.ok) {
          showToast(data.error || "Failed to send weekly timetable emails", "error");
          return;
        }

        showToast(`Weekly timetable email sent to ${data.recipientsSent || 0} recipient(s).`, "success");

        navigate("/search", {
          state: {
            prefillPrompt: data.summary || finalPrompt,
            autoRunMode: "ai"
          }
        });
      } catch (err) {
        console.error("Failed to send weekly timetable email", err);
        showToast("Failed to generate and send weekly timetable email", "error");
      } finally {
        setIsExecutingWorkflow(false);
      }
    };

    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
        {toast && (
          <div
            className={`fixed top-5 right-5 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${
              toast.type === "success" ? "bg-green-600" : toast.type === "error" ? "bg-red-600" : "bg-blue-600"
            }`}
          >
            <span>{toast.message}</span>
            <button onClick={() => setToast(null)} className="ml-2 opacity-70 hover:opacity-100">
              <X size={15} />
            </button>
          </div>
        )}
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <button
              onClick={() => navigate("/workflows")}
              className="inline-flex items-center gap-2 px-6 py-3 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-medium rounded-lg transition shadow-sm"
            >
              ← Back to Workflows
            </button>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-3xl p-8 shadow-xl">
            <h1 className="text-4xl font-bold text-center mb-4 text-gray-900 dark:text-white">
              {workflow.title}
            </h1>

            <p className="text-center text-gray-600 dark:text-gray-400 mb-8">
              {workflow.fields.length === 1
                ? "Enter the required information below"
                : "Fill in the details below"}
            </p>

            <div className="space-y-6">
              {workflow.fields.map((field) => (
                <div key={field.key}>
                  {(() => {
                    const isPitchSheetField = workflow.slug === "pitch-emails" && field.key === "sheet_url";
                    const showRequired = field.required && !(isPitchSheetField && attachedInvestorFile);
                    return (
                  <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                    {field.label}
                    {showRequired && <span className="text-red-500 ml-1">*</span>}
                  </label>
                    );
                  })()}
                  {field.multiline ? (
                    <textarea
                      value={values[field.key] || ""}
                      onChange={(e) => handleChange(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      rows={field.rows || 4}
                      className="w-full px-5 py-4 text-lg border border-gray-300 dark:border-gray-600 rounded-2xl focus:outline-none focus:border-gray-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-y"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && isValid) {
                          e.preventDefault();
                          handleGenerate();
                        }
                      }}
                    />
                  ) : (
                    <input
                      type="text"
                      value={values[field.key] || ""}
                      onChange={(e) => handleChange(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      className="w-full px-5 py-4 text-lg border border-gray-300 dark:border-gray-600 rounded-2xl focus:outline-none focus:border-gray-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      onKeyDown={(e) => e.key === "Enter" && isValid && handleGenerate()}
                    />
                  )}

                  {workflow.slug === "pitch-emails" && field.key === "sheet_url" && (
                    <div className="mt-3 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => window.open("https://docs.google.com/spreadsheets/", "_blank")}
                        className="px-4 py-2 rounded-xl bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-sm font-medium text-gray-800 dark:text-gray-200"
                      >
                        Open Google Sheets
                      </button>

                      <label className="px-4 py-2 rounded-xl bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-sm font-medium text-gray-800 dark:text-gray-200 cursor-pointer">
                        Attach From Local Computer
                        <input
                          type="file"
                          accept=".csv,.xlsx,.xls"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0] || null;
                            setAttachedInvestorFile(file);
                            if (file) {
                              handleChange("sheet_url", "");
                            }
                          }}
                        />
                      </label>

                      {attachedInvestorFile && (
                        <button
                          type="button"
                          onClick={() => setAttachedInvestorFile(null)}
                          className="px-4 py-2 rounded-xl bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-sm font-medium text-gray-800 dark:text-gray-200"
                        >
                          Remove Local File
                        </button>
                      )}

                      {attachedInvestorFile && (
                        <p className="w-full text-sm text-gray-600 dark:text-gray-300">
                          Attached file: {attachedInvestorFile.name}
                        </p>
                      )}
                    </div>
                  )}

                  {workflow.slug === "send-doc-emails" && field.key === "doc_url" && (
                    <div className="mt-3 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => window.open("https://docs.google.com/document/", "_blank")}
                        className="px-4 py-2 rounded-xl bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-sm font-medium text-gray-800 dark:text-gray-200"
                      >
                        Open Google Docs
                      </button>

                      <label className="px-4 py-2 rounded-xl bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-sm font-medium text-gray-800 dark:text-gray-200 cursor-pointer">
                        Attach From Local Computer
                        <input
                          type="file"
                          accept=".txt,.md"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0] || null;
                            setAttachedDocFile(file);
                            if (file) handleChange("doc_url", "");
                          }}
                        />
                      </label>

                      {attachedDocFile && (
                        <button
                          type="button"
                          onClick={() => setAttachedDocFile(null)}
                          className="px-4 py-2 rounded-xl bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-sm font-medium text-gray-800 dark:text-gray-200"
                        >
                          Remove File
                        </button>
                      )}

                      {attachedDocFile && (
                        <p className="w-full text-sm text-gray-600 dark:text-gray-300">
                          Attached: {attachedDocFile.name}
                        </p>
                      )}
                    </div>
                  )}

                  {workflow.slug === "study-plan" && field.key === "topic" && (
                    <div className="mt-3 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => window.open("https://docs.google.com/document/", "_blank")}
                        className="px-4 py-2 rounded-xl bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-sm font-medium text-gray-800 dark:text-gray-200"
                      >
                        Open Google Docs
                      </button>
                      <button
                        type="button"
                        onClick={() => window.open("https://docs.google.com/spreadsheets/", "_blank")}
                        className="px-4 py-2 rounded-xl bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-sm font-medium text-gray-800 dark:text-gray-200"
                      >
                        Open Google Sheets
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {workflow.slug === "pitch-emails" && (
              <div className="mt-6 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4">
                <div className="flex flex-wrap gap-3 mb-3">
                  {!isUltraUser ? (
                    <button
                      type="button"
                      onClick={handleUpgradePlanClick}
                      className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-500 hover:bg-gray-600 text-white transition"
                    >
                      Upgrade Plan
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => integrations.sheets ? disconnectGoogleTool("sheets") : connectGoogleTool("sheets")}
                        className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
                          integrations.sheets
                            ? "bg-gray-700 text-white hover:bg-gray-800"
                            : "bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200"
                        }`}
                      >
                        {integrations.sheets ? "Sheets Connected ✓" : "Connect Google Sheets"}
                      </button>
                      <button
                        type="button"
                        onClick={() => integrations.docs ? disconnectGoogleTool("docs") : connectGoogleTool("docs")}
                        className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
                          integrations.docs
                            ? "bg-gray-700 text-white hover:bg-gray-800"
                            : "bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200"
                        }`}
                      >
                        {integrations.docs ? "Docs Connected ✓" : "Connect Google Docs"}
                      </button>
                    </>
                  )}
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  {!isUltraUser
                    ? "Pitch Emails is available on the ULTRA plan. Upgrade to continue."
                    : hasPitchLocalFile
                    ? "Local file mode needs Google Docs connection only."
                    : "Google Sheet URL mode needs both Google Sheets and Google Docs connected."}
                </p>
                {!canExecutePitchEmails && pitchEmailsMissingRequirements.length > 0 && (
                  <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                    Before executing: {pitchEmailsMissingRequirements.join(" • ")}
                  </p>
                )}
                {canExecutePitchEmails && !isPitchIntegrationReady && (
                  <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
                    Execute can still be tried, but backend may ask you to reconnect missing integrations: {pitchEmailsMissingRequirements.join(" • ")}
                  </p>
                )}
              </div>
            )}

            {workflow.slug === "podcaster-guest-insight" && (
              <div className="mt-6 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4">
                <div className="flex flex-wrap gap-3 mb-3">
                  {!isUltraUser ? (
                    <button
                      type="button"
                      onClick={handleUpgradePlanClick}
                      className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-500 hover:bg-gray-600 text-white transition"
                    >
                      Upgrade Plan
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => integrations.docs ? disconnectGoogleTool("docs") : connectGoogleTool("docs")}
                      className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
                        integrations.docs
                          ? "bg-gray-700 text-white hover:bg-gray-800"
                          : "bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200"
                      }`}
                    >
                      {integrations.docs ? "Docs Connected ✓" : "Connect Google Docs"}
                    </button>
                  )}
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  {!isUltraUser
                    ? "Podcaster workflow is available on the ULTRA plan. Upgrade to continue."
                    : "Connect Google Docs and click the button below to generate the full 20-question interview plan and save the complete output in a Google Doc."}
                </p>
              </div>
            )}

            {isTimetableWorkflow && (
              <div className="mt-6 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4">
                <div className="flex flex-wrap gap-3 mb-3">
                  {!isUltraUser ? (
                    <button
                      type="button"
                      onClick={handleUpgradePlanClick}
                      className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-500 hover:bg-gray-600 text-white transition"
                    >
                      Upgrade Plan
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => integrations.docs ? disconnectGoogleTool("docs") : connectGoogleTool("docs")}
                        className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
                          integrations.docs
                            ? "bg-gray-700 text-white hover:bg-gray-800"
                            : "bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200"
                        }`}
                      >
                        {integrations.docs ? "Docs Connected ✓" : "Connect Google Docs"}
                      </button>
                      <button
                        type="button"
                        onClick={() => integrations.gmail ? disconnectGoogleTool("gmail") : connectGoogleTool("gmail")}
                        className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
                          integrations.gmail
                            ? "bg-gray-700 text-white hover:bg-gray-800"
                            : "bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200"
                        }`}
                      >
                        {integrations.gmail ? "Gmail Connected ✓" : "Connect Gmail"}
                      </button>
                    </>
                  )}
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  {!isUltraUser
                    ? "Timetable automation is available on the ULTRA plan. Upgrade to continue."
                    : "Use separate actions below: Generate + Save in Docs, and Generate + Send Email."}
                </p>
              </div>
            )}

            {workflow.slug === "tuition-timetable" && (
              <div className="mt-6 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4">
                <div className="flex flex-wrap gap-3 mb-3">
                  {!isUltraUser ? (
                    <button
                      type="button"
                      onClick={handleUpgradePlanClick}
                      className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-500 hover:bg-gray-600 text-white transition"
                    >
                      Upgrade Plan
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => integrations.docs ? disconnectGoogleTool("docs") : connectGoogleTool("docs")}
                      className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
                        integrations.docs
                          ? "bg-gray-700 text-white hover:bg-gray-800"
                          : "bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200"
                      }`}
                    >
                      {integrations.docs ? "Docs Connected ✓" : "Connect Google Docs"}
                    </button>
                  )}
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  {!isUltraUser
                    ? "Tuition Timetable automation is available on the ULTRA plan. Upgrade to continue."
                    : "Connect Google Docs to save the generated timetable directly to a Google Doc."}
                </p>
              </div>
            )}

            {workflow.slug === "hr-ops" && (
              <div className="mt-6 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4">
                <div className="flex flex-wrap gap-3 mb-3">
                  {!isUltraUser ? (
                    <button
                      type="button"
                      onClick={handleUpgradePlanClick}
                      className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-500 hover:bg-gray-600 text-white transition"
                    >
                      Upgrade Plan
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => integrations.gmail ? disconnectGoogleTool("gmail") : connectGoogleTool("gmail")}
                      className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
                        integrations.gmail
                          ? "bg-gray-700 text-white hover:bg-gray-800"
                          : "bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200"
                      }`}
                    >
                      {integrations.gmail ? "Gmail Connected ✓" : "Connect Gmail"}
                    </button>
                  )}
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  {!isUltraUser
                    ? "HR Ops is available on the ULTRA plan. Upgrade to continue."
                    : "HR Ops execute flow sends the onboarding email through your connected Gmail account."}
                </p>
              </div>
            )}

            {workflow.slug === "leadership-hr-handover" && (
              <div className="mt-6 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4">
                <div className="flex flex-wrap gap-3 mb-3">
                  {!isUltraUser ? (
                    <button
                      type="button"
                      onClick={handleUpgradePlanClick}
                      className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-500 hover:bg-gray-600 text-white transition"
                    >
                      Upgrade Plan
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => integrations.gmail ? disconnectGoogleTool("gmail") : connectGoogleTool("gmail")}
                      className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
                        integrations.gmail
                          ? "bg-gray-700 text-white hover:bg-gray-800"
                          : "bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200"
                      }`}
                    >
                      {integrations.gmail ? "Gmail Connected ✓" : "Connect Gmail"}
                    </button>
                  )}
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  {!isUltraUser
                    ? "Leadership to HR Handover is available on the ULTRA plan. Upgrade to continue."
                    : "Leadership to HR Handover execute flow sends the handover note through your connected Gmail account to the employee."}
                </p>
              </div>
            )}

            {workflow.slug === "hr-release" && (
              <div className="mt-6 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4">
                <div className="flex flex-wrap gap-3 mb-3">
                  {!isUltraUser ? (
                    <button
                      type="button"
                      onClick={handleUpgradePlanClick}
                      className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-500 hover:bg-gray-600 text-white transition"
                    >
                      Upgrade Plan
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => integrations.gmail ? disconnectGoogleTool("gmail") : connectGoogleTool("gmail")}
                      className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
                        integrations.gmail
                          ? "bg-gray-700 text-white hover:bg-gray-800"
                          : "bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200"
                      }`}
                    >
                      {integrations.gmail ? "Gmail Connected ✓" : "Connect Gmail"}
                    </button>
                  )}
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  {!isUltraUser
                    ? "HR Release is available on the ULTRA plan. Upgrade to continue."
                    : "HR Release execute flow sends the offboarding email through your connected Gmail account to the employee."}
                </p>
              </div>
            )}

            {workflow.slug === "experience-letter" && (
              <div className="mt-6 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4">
                <div className="flex flex-wrap gap-3 mb-3">
                  {!isUltraUser ? (
                    <button
                      type="button"
                      onClick={handleUpgradePlanClick}
                      className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-500 hover:bg-gray-600 text-white transition"
                    >
                      Upgrade Plan
                    </button>
                  ) : null}
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  {!isUltraUser
                    ? "Experience Letter generation is available on the ULTRA plan. Upgrade to continue."
                    : "Generate a PDF draft with optional company letterhead and e-signature. Manual review, authorization, and final sign-off are still required."}
                </p>
              </div>
            )}

            {!isTimetableWorkflow && (
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!isValid || isExecutingWorkflow}
                className={`mt-8 w-full py-4 rounded-2xl font-semibold text-lg transition-all ${
                  isValid && !isExecutingWorkflow
                    ? "bg-gray-700 hover:bg-gray-800 text-white"
                    : "bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed"
                }`}
              >
                {isExecutingWorkflow ? (
                  <span className="inline-flex items-center gap-3">
                    <span className="workflow-orb-loader" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                      <span />
                    </span>
                    Executing Task...
                  </span>
                ) : workflow.slug === "experience-letter"
                  ? "Generate PDF Draft"
                  : workflow.slug === "podcaster-guest-insight"
                    ? "Generate in AI Search"
                    : isIntegrationWorkflow ? "Execute Task" : "Generate Query & Go to Search →"}
              </button>
            )}

            {workflow.slug === "podcaster-guest-insight" && (
              <button
                type="button"
                onClick={handleGenerateAndSavePodcasterDoc}
                disabled={!isValid || isExecutingWorkflow || !canSavePodcasterToDocs}
                className={`mt-4 w-full py-4 rounded-2xl font-semibold text-lg transition-all ${
                  isValid && !isExecutingWorkflow && canSavePodcasterToDocs
                    ? "bg-gray-900 hover:bg-black text-white"
                    : "bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed"
                }`}
              >
                {isExecutingWorkflow ? "Generating and Saving..." : "Generate + Save to Google Docs"}
              </button>
            )}

            {workflow.slug === "tuition-timetable" && (
              <button
                type="button"
                onClick={handleGenerateAndSaveTuitionDoc}
                disabled={!isValid || isExecutingWorkflow || !canSaveTuitionToDocs || !isUltraUser}
                className={`mt-4 w-full py-4 rounded-2xl font-semibold text-lg transition-all ${
                  isValid && !isExecutingWorkflow && canSaveTuitionToDocs && isUltraUser
                    ? "bg-gray-900 hover:bg-black text-white"
                    : "bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed"
                }`}
              >
                {isExecutingWorkflow ? "Generating and Saving..." : "Generate + Save in Google Docs"}
              </button>
            )}

            {isTimetableWorkflow && (
              <>
                <button
                  type="button"
                  onClick={handleGenerateAndSaveWeeklyDoc}
                  disabled={!isValid || isExecutingWorkflow || !canSaveWeeklyToDocs || !isUltraUser}
                  className={`mt-8 w-full py-4 rounded-2xl font-semibold text-lg transition-all ${
                    isValid && !isExecutingWorkflow && canSaveWeeklyToDocs && isUltraUser
                      ? "bg-gray-900 hover:bg-black text-white"
                      : "bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed"
                  }`}
                >
                  {isExecutingWorkflow ? "Generating and Saving..." : "Generate + Save in Google Docs"}
                </button>

                <button
                  type="button"
                  onClick={handleGenerateAndSendWeeklyEmail}
                  disabled={!isValid || isExecutingWorkflow || !canSendWeeklyByEmail || !isUltraUser || !((values.recipient_emails?.trim?.() || "").length > 0)}
                  className={`mt-4 w-full py-4 rounded-2xl font-semibold text-lg transition-all ${
                    isValid && !isExecutingWorkflow && canSendWeeklyByEmail && isUltraUser && (values.recipient_emails?.trim?.() || "").length > 0
                      ? "bg-gray-700 hover:bg-gray-800 text-white"
                      : "bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed"
                  }`}
                >
                  {isExecutingWorkflow ? "Generating and Sending..." : "Generate + Send Email"}
                </button>
              </>
            )}

            {(workflow.embedUrl || workflow.videoSrc) && (
              <div className="mt-8 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700 bg-black shadow-sm">
                {workflow.embedUrl ? (
                  youtubeId && activeEmbedSlug !== workflow.slug ? (
                    <button
                      type="button"
                      onClick={() => setActiveEmbedSlug(workflow.slug)}
                      className="group relative block w-full text-left bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900"
                      aria-label={`Play ${workflow.title} video walkthrough`}
                    >
                      <div className="relative w-full" style={{ paddingTop: "56.25%" }}>
                        <span className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(56,189,248,0.28),transparent_34%),radial-gradient(circle_at_84%_78%,rgba(52,211,153,0.24),transparent_36%)]" aria-hidden="true" />
                        <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-black/15" aria-hidden="true" />
                        <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
                        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/95 shadow-xl transition-transform duration-200 group-hover:scale-105">
                          <span className="ml-1 h-0 w-0 border-y-[10px] border-y-transparent border-l-[16px] border-l-gray-900" />
                        </span>
                        </span>
                        <span className="absolute left-4 top-4 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                          Web Explore AI Walkthrough
                        </span>
                        <span className="absolute bottom-4 left-4 rounded-full bg-black/70 px-3 py-1 text-xs font-semibold text-white">
                          Watch walkthrough
                        </span>
                      </div>
                    </button>
                  ) : (
                    <div className="relative w-full" style={{ paddingTop: "56.25%" }}>
                      <button
                        type="button"
                        onClick={() => setActiveEmbedSlug("")}
                        className="absolute right-3 top-3 z-10 rounded-full bg-black/65 px-3 py-1 text-xs font-semibold text-white backdrop-blur-sm hover:bg-black/80"
                      >
                        Close video
                      </button>
                      <iframe
                        className="absolute inset-0 h-full w-full"
                        src={youtubeId ? youtubeEmbedUrl : workflow.embedUrl}
                        title={`${workflow.title} video walkthrough`}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        referrerPolicy="strict-origin-when-cross-origin"
                      />
                    </div>
                  )
                ) : (
                  <video
                    className="block w-full h-auto max-h-[420px]"
                    controls
                    preload="metadata"
                    playsInline
                  >
                    <source src={workflow.videoSrc} type="video/mp4" />
                    Your browser does not support the video tag.
                  </video>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (location.pathname === "/workflows") {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-4xl sm:text-5xl font-bold text-center mb-4 text-gray-900 dark:text-white">
            Workflow Automation
          </h1>
          <p className="text-center text-lg text-gray-600 dark:text-gray-400 mb-12 max-w-3xl mx-auto">
            Click any card to load the ready-made prompt. Replace{" "}
            <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-sm">
              {"{{placeholders}}"}
            </code>{" "}
            and press Enter.
          </p>

          {/* CATEGORY TABS */}
          <div className="flex flex-wrap justify-center gap-2 mb-8">
            {["All", "HR Automation", "Sales & Business", "Research & Intelligence", "Communication", "Learning & Education", "General Lookup"].map((category) => (
              <button
                key={category}
                onClick={() => setActiveWorkflowTab(category)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                  activeWorkflowTab === category
                    ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900"
                    : "bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600"
                }`}
              >
                {category}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
            {workflowCards
              .filter((card) => activeWorkflowTab === "All" || card.category === activeWorkflowTab)
              .map((card, index) => (
                <div
                  key={index}
                  onClick={(e) => handleWorkflowCardClick(e, card.slug)}
                  className="bg-white dark:bg-gray-800 rounded-3xl p-6 sm:p-8 shadow-lg hover:shadow-2xl transition-all duration-300 cursor-pointer border border-gray-100 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500 group"
                >
                  <h3 className="text-xl sm:text-2xl font-semibold mb-4 text-gray-900 dark:text-white group-hover:text-gray-700 dark:group-hover:text-gray-300">
                    {card.title}
                  </h3>

                  <p className="text-sm text-gray-500 dark:text-gray-400 italic break-words mb-4">
                    {card.promptTemplate}
                  </p>

                  {/* CONNECT BUTTONS */}

                  {card.slug === "gmail-catchup" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isUltraUser) {
                          navigate("/pricing");
                        } else {
                          if (integrations.gmail) {
                            disconnectGoogleTool("gmail");
                          } else {
                            connectGoogleTool("gmail");
                          }
                        }
                      }}
                      className={`mt-2 px-4 py-2 rounded-lg text-sm cursor-pointer transition ${
                        !isUltraUser
                          ? "bg-gray-500 hover:bg-gray-600 text-white block mx-auto"
                          : integrations.gmail
                          ? "bg-gray-600 hover:bg-gray-700"
                          : "bg-gray-500 hover:bg-gray-600"
                      }`}
                    >
                      {!isUltraUser ? "Upgrade Plan" : integrations.gmail ? "Connected ✓ (click to disconnect)" : "Connect Gmail"}
                    </button>
                  )}

                  {card.slug === "project-reminders" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isUltraUser) {
                          navigate("/pricing");
                        } else {
                          if (integrations.calendar) {
                            disconnectGoogleTool("calendar");
                          } else {
                            connectGoogleTool("calendar");
                          }
                        }
                      }}
                      className={`mt-2 px-4 py-2 rounded-lg text-sm cursor-pointer transition ${
                        !isUltraUser
                          ? "bg-gray-500 hover:bg-gray-600 text-white block mx-auto"
                          : integrations.calendar
                          ? "bg-gray-600 hover:bg-gray-700"
                          : "bg-gray-500 hover:bg-gray-600"
                      }`}
                    >
                      {!isUltraUser ? "Upgrade Plan" : integrations.calendar ? "Connected ✓ (click to disconnect)" : "Connect Calendar"}
                    </button>
                  )}

                  {card.slug === "research-competitors" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isUltraUser) {
                          navigate("/pricing");
                        } else {
                          if (integrations.docs) {
                            disconnectGoogleTool("docs");
                          } else {
                            connectGoogleTool("docs");
                          }
                        }
                      }}
                      className={`mt-2 px-4 py-2 rounded-lg text-sm cursor-pointer transition ${
                        !isUltraUser
                          ? "bg-gray-500 hover:bg-gray-600 text-white block mx-auto"
                          : integrations.docs
                          ? "bg-gray-600 hover:bg-gray-700"
                          : "bg-gray-500 hover:bg-gray-600"
                      }`}
                    >
                      {!isUltraUser ? "Upgrade Plan" : integrations.docs ? "Connected ✓ (click to disconnect)" : "Connect Docs"}
                    </button>
                  )}

                  {card.slug === "podcaster-guest-insight" && (
                    !isUltraUser ? (
                      <button
                        onClick={handleUpgradePlanClick}
                        className="mt-2 px-4 py-2 rounded-lg text-sm bg-gray-500 hover:bg-gray-600 text-white cursor-pointer transition block mx-auto"
                      >
                        Upgrade Plan
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (integrations.docs) {
                            disconnectGoogleTool("docs");
                          } else {
                            connectGoogleTool("docs");
                          }
                        }}
                        className={`mt-2 px-4 py-2 rounded-lg text-sm cursor-pointer transition ${
                          integrations.docs
                            ? "bg-gray-600 hover:bg-gray-700 text-white"
                            : "bg-gray-500 hover:bg-gray-600 text-white block mx-auto"
                        }`}
                      >
                        {integrations.docs ? "Connected ✓ (click to disconnect)" : "Connect Docs"}
                      </button>
                    )
                  )}

                  {card.slug === "weekly-timetable" && (
                    !isUltraUser ? (
                      <button
                        onClick={handleUpgradePlanClick}
                        className="mt-2 px-4 py-2 rounded-lg text-sm bg-gray-500 hover:bg-gray-600 text-white cursor-pointer transition block mx-auto"
                      >
                        Upgrade Plan
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (integrations.docs) {
                              disconnectGoogleTool("docs");
                            } else {
                              connectGoogleTool("docs");
                            }
                          }}
                          className={`mt-2 px-4 py-2 rounded-lg text-sm cursor-pointer transition ${
                            integrations.docs
                              ? "bg-gray-600 hover:bg-gray-700"
                              : "bg-gray-500 hover:bg-gray-600"
                          }`}
                        >
                          {integrations.docs ? "Docs Connected ✓ (click to disconnect)" : "Connect Docs"}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (integrations.gmail) {
                              disconnectGoogleTool("gmail");
                            } else {
                              connectGoogleTool("gmail");
                            }
                          }}
                          className={`mt-2 ml-2 px-4 py-2 rounded-lg text-sm cursor-pointer transition ${
                            integrations.gmail
                              ? "bg-gray-600 hover:bg-gray-700"
                              : "bg-gray-500 hover:bg-gray-600"
                          }`}
                        >
                          {integrations.gmail ? "Gmail Connected ✓ (click to disconnect)" : "Connect Gmail"}
                        </button>
                      </>
                    )
                  )}

                  {card.slug === "tuition-timetable" && (
                    !isUltraUser ? (
                      <button
                        onClick={handleUpgradePlanClick}
                        className="mt-2 px-4 py-2 rounded-lg text-sm bg-gray-500 hover:bg-gray-600 text-white cursor-pointer transition block mx-auto"
                      >
                        Upgrade Plan
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (integrations.docs) {
                            disconnectGoogleTool("docs");
                          } else {
                            connectGoogleTool("docs");
                          }
                        }}
                        className={`mt-2 px-4 py-2 rounded-lg text-sm cursor-pointer transition ${
                          integrations.docs
                            ? "bg-gray-600 hover:bg-gray-700 text-white"
                            : "bg-gray-500 hover:bg-gray-600 text-white block mx-auto"
                        }`}
                      >
                        {integrations.docs ? "Docs Connected ✓ (click to disconnect)" : "Connect Docs"}
                      </button>
                    )
                  )}

                  {card.slug === "pitch-emails" && (
                    !isUltraUser ? (
                      <button
                        onClick={handleUpgradePlanClick}
                        className="mt-2 px-4 py-2 rounded-lg text-sm bg-gray-500 hover:bg-gray-600 text-white cursor-pointer transition block mx-auto"
                      >
                        Upgrade Plan
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (integrations.sheets) {
                              disconnectGoogleTool("sheets");
                            } else {
                              connectGoogleTool("sheets");
                            }
                          }}
                          className={`mt-2 px-4 py-2 rounded-lg text-sm cursor-pointer transition ${
                            integrations.sheets
                              ? "bg-gray-600 hover:bg-gray-700"
                              : "bg-gray-500 hover:bg-gray-600"
                          }`}
                        >
                          {integrations.sheets ? "Sheets Connected ✓ (click to disconnect)" : "Connect Sheets"}
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (integrations.docs) {
                              disconnectGoogleTool("docs");
                            } else {
                              connectGoogleTool("docs");
                            }
                          }}
                          className={`mt-2 ml-2 px-4 py-2 rounded-lg text-sm cursor-pointer transition ${
                            integrations.docs
                              ? "bg-gray-600 hover:bg-gray-700"
                              : "bg-gray-500 hover:bg-gray-600"
                          }`}
                        >
                          {integrations.docs ? "Docs Connected ✓ (click to disconnect)" : "Connect Docs"}
                        </button>
                      </>
                    )
                  )}

                  {card.slug === "send-doc-emails" && (
                    !isUltraUser ? (
                      <button
                        onClick={handleUpgradePlanClick}
                        className="mt-2 px-4 py-2 rounded-lg text-sm bg-gray-500 hover:bg-gray-600 text-white cursor-pointer transition block mx-auto"
                      >
                        Upgrade Plan
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (integrations.gmail) {
                              disconnectGoogleTool("gmail");
                            } else {
                              connectGoogleTool("gmail");
                            }
                          }}
                          className={`mt-2 px-4 py-2 rounded-lg text-sm cursor-pointer transition ${
                            integrations.gmail
                              ? "bg-gray-600 hover:bg-gray-700"
                              : "bg-gray-500 hover:bg-gray-600"
                          }`}
                        >
                          {integrations.gmail ? "Gmail Connected ✓ (click to disconnect)" : "Connect Gmail"}
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (integrations.docs) {
                              disconnectGoogleTool("docs");
                            } else {
                              connectGoogleTool("docs");
                            }
                          }}
                          className={`mt-2 ml-2 px-4 py-2 rounded-lg text-sm cursor-pointer transition ${
                            integrations.docs
                              ? "bg-gray-600 hover:bg-gray-700"
                              : "bg-gray-500 hover:bg-gray-600"
                          }`}
                        >
                          {integrations.docs ? "Docs Connected ✓ (click to disconnect)" : "Connect Docs"}
                        </button>
                      </>
                    )
                  )}

                  {card.slug === "hr-ops" && (
                    !isUltraUser ? (
                      <button
                        onClick={handleUpgradePlanClick}
                        className="mt-2 px-4 py-2 rounded-lg text-sm bg-gray-500 hover:bg-gray-600 text-white cursor-pointer transition block mx-auto"
                      >
                        Upgrade Plan
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (integrations.gmail) {
                            disconnectGoogleTool("gmail");
                          } else {
                            connectGoogleTool("gmail");
                          }
                        }}
                        className={`mt-2 px-4 py-2 rounded-lg text-sm cursor-pointer transition ${
                          integrations.gmail
                            ? "bg-gray-600 hover:bg-gray-700"
                            : "bg-gray-500 hover:bg-gray-600"
                        }`}
                      >
                        {integrations.gmail ? "Gmail Connected ✓ (click to disconnect)" : "Connect Gmail"}
                      </button>
                    )
                  )}

                  {card.slug === "leadership-hr-handover" && (
                    !isUltraUser ? (
                      <button
                        onClick={handleUpgradePlanClick}
                        className="mt-2 px-4 py-2 rounded-lg text-sm bg-gray-500 hover:bg-gray-600 text-white cursor-pointer transition block mx-auto"
                      >
                        Upgrade Plan
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (integrations.gmail) {
                            disconnectGoogleTool("gmail");
                          } else {
                            connectGoogleTool("gmail");
                          }
                        }}
                        className={`mt-2 px-4 py-2 rounded-lg text-sm cursor-pointer transition ${
                          integrations.gmail
                            ? "bg-gray-600 hover:bg-gray-700"
                            : "bg-gray-500 hover:bg-gray-600"
                        }`}
                      >
                        {integrations.gmail ? "Gmail Connected ✓ (click to disconnect)" : "Connect Gmail"}
                      </button>
                    )
                  )}

                  {card.slug === "hr-release" && (
                    !isUltraUser ? (
                      <button
                        onClick={handleUpgradePlanClick}
                        className="mt-2 px-4 py-2 rounded-lg text-sm bg-gray-500 hover:bg-gray-600 text-white cursor-pointer transition block mx-auto"
                      >
                        Upgrade Plan
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (integrations.gmail) {
                            disconnectGoogleTool("gmail");
                          } else {
                            connectGoogleTool("gmail");
                          }
                        }}
                        className={`mt-2 px-4 py-2 rounded-lg text-sm cursor-pointer transition ${
                          integrations.gmail
                            ? "bg-gray-600 hover:bg-gray-700"
                            : "bg-gray-500 hover:bg-gray-600"
                        }`}
                      >
                        {integrations.gmail ? "Gmail Connected ✓ (click to disconnect)" : "Connect Gmail"}
                      </button>
                    )
                  )}

                  {card.slug === "experience-letter" && (
                    !isUltraUser ? (
                      <button
                        onClick={handleUpgradePlanClick}
                        className="mt-2 px-4 py-2 rounded-lg text-sm bg-gray-500 hover:bg-gray-600 text-white cursor-pointer transition block mx-auto"
                      >
                        Upgrade Plan
                      </button>
                    ) : (
                      <div className="mt-2 text-xs text-gray-500 italic">
                        ⚠️ Requires manual review & authorization
                      </div>
                    )
                  )}

                  {card.slug === "study-plan" && (
                    !isUltraUser ? (
                      <button
                        onClick={handleUpgradePlanClick}
                        className="mt-2 px-4 py-2 rounded-lg text-sm bg-gray-500 hover:bg-gray-600 text-white cursor-pointer transition block mx-auto"
                      >
                        Upgrade Plan
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (integrations.sheets) {
                              disconnectGoogleTool("sheets");
                            } else {
                              connectGoogleTool("sheets");
                            }
                          }}
                          className={`mt-2 px-4 py-2 rounded-lg text-sm cursor-pointer transition ${
                            integrations.sheets
                              ? "bg-gray-600 hover:bg-gray-700"
                              : "bg-gray-500 hover:bg-gray-600"
                          }`}
                        >
                          {integrations.sheets ? "Sheets Connected ✓ (click to disconnect)" : "Connect Sheets"}
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (integrations.gmail) {
                              disconnectGoogleTool("gmail");
                            } else {
                              connectGoogleTool("gmail");
                            }
                          }}
                          className={`mt-2 ml-2 px-4 py-2 rounded-lg text-sm cursor-pointer transition ${
                            integrations.gmail
                              ? "bg-gray-600 hover:bg-gray-700"
                              : "bg-gray-500 hover:bg-gray-600"
                          }`}
                        >
                          {integrations.gmail ? "Gmail Connected ✓ (click to disconnect)" : "Connect Gmail"}
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (integrations.docs) {
                              disconnectGoogleTool("docs");
                            } else {
                              connectGoogleTool("docs");
                            }
                          }}
                          className={`mt-2 ml-2 px-4 py-2 rounded-lg text-sm cursor-pointer transition ${
                            integrations.docs
                              ? "bg-gray-600 hover:bg-gray-700"
                              : "bg-gray-500 hover:bg-gray-600"
                          }`}
                        >
                          {integrations.docs ? "Docs Connected ✓ (click to disconnect)" : "Connect Docs"}
                        </button>
                      </>
                    )
                  )}
                </div>
              ))}
          </div>

          <div className="mt-16 flex justify-center">
            <button
              onClick={() => navigate("/search")}
              className="px-8 py-4 bg-gray-700 hover:bg-gray-800 text-white font-medium rounded-2xl text-lg transition shadow-lg flex items-center justify-center gap-2"
            >
              <ArrowLeft size={20} /> Back to Search
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (location.pathname === "/pricing") {
    const plans = [
      {
        name: "FREE",
        price: 0,
        period: "Lifetime",
        features: ["100 AI Credits", "1 Credit = 1,000 tokens", "Basic support"],
        buttonText: "Current Plan",
        disabled: true,
        popular: false,
      },
      {
        name: "PRO",
        price: 999,
        period: "per month",
        features: [
          "1,000 AI Credits / month",
          "1 Credit = 1,000 tokens",
          "Faster responses",
          "Priority support",
        ],
        buttonText: "Upgrade to PRO",
        popular: true,
      },
      {
        name: "ULTRA",
        price: 3999,
        period: "per month",
        features: [
          "5,000 AI Credits / month",
          "1 Credit = 1,000 tokens",
          "Ultra fast",
          "Integration Powered Automation",
          "Enterprise features",
          "Dedicated support",
        ],
        buttonText: "Upgrade to ULTRA",
        popular: false,
      },
    ];

    const handleUpgrade = async (plan) => {
      if (plan.disabled) return;

      if (!user || !user.id) {
        showToast("Please sign in first to upgrade your plan", "error");
        navigate("/");
        return;
      }

      try {
        const orderResponse = await fetch("/api/create-razorpay-order", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": user.id,
          },
          body: JSON.stringify({ planName: plan.name }),
        });

        if (!orderResponse.ok) {
          const error = await orderResponse.json();
          throw new Error(error.error || "Failed to create order");
        }

        const orderData = await orderResponse.json();

        const options = {
          key: orderData.key,
          amount: orderData.order.amount,
          currency: orderData.order.currency,
          name: "Web Explore",
          description: `Upgrade to ${plan.name} Plan`,
          order_id: orderData.order.id,
          handler: async function (response) {
            try {
              const verifyResponse = await fetch("/api/verify-razorpay-payment", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-user-id": user.id,
                },
                body: JSON.stringify({
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                  planName: plan.name,
                }),
              });

              if (verifyResponse.ok) {
                showToast(`Successfully upgraded to ${plan.name} plan!`, "success");
                setTimeout(() => window.location.reload(), 1500);
              } else {
                const error = await verifyResponse.json();
                showToast(`Payment verification failed: ${error.error}`, "error");
              }
            } catch (err) {
              console.error("Payment verification error:", err);
              showToast("Payment verification failed. Please contact support.", "error");
            }
          },
          prefill: {
            name: user.name || "",
            email: user.email || "",
          },
          theme: {
            color: "#2563eb",
          },
        };

        if (!window.Razorpay) {
          throw new Error("Razorpay SDK not loaded. Please refresh the page.");
        }

        const rzp = new window.Razorpay(options);
        rzp.open();
      } catch (err) {
        console.error("Payment error:", err);
        showToast(`Payment failed: ${err.message}`, "error");
      }
    };

    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-12 px-4 sm:px-6 lg:px-8">
        {toast && (
          <div
            className={`fixed top-5 right-5 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${
              toast.type === "success" ? "bg-green-600" : toast.type === "error" ? "bg-red-600" : "bg-blue-600"
            }`}
          >
            <span>{toast.message}</span>
            <button onClick={() => setToast(null)} className="ml-2 opacity-70 hover:opacity-100">
              <X size={15} />
            </button>
          </div>
        )}
        <div className="max-w-6xl mx-auto">
          <div className="mb-10 flex justify-center">
            <button
              onClick={() => navigate("/search")}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm hover:bg-white dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200 font-medium rounded-full shadow-sm hover:shadow transition-all duration-200"
            >
              ← Back to Search
            </button>
          </div>

          <div className="text-center mb-12">
            <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 dark:text-white tracking-tight">
              Choose Your Plan
            </h1>
            <p className="mt-4 text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
              Unlock more tokens, advanced models and priority access
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`relative bg-white dark:bg-gray-800/90 rounded-3xl p-7 sm:p-9 shadow-xl border transition-all duration-300 hover:shadow-2xl hover:-translate-y-1 ${
                  plan.popular
                    ? "border-gray-600/50 scale-[1.03] md:scale-105 z-10 ring-1 ring-gray-500/20"
                    : "border-gray-200 dark:border-gray-700"
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-5 py-1.5 bg-gradient-to-r from-gray-700 to-gray-900 text-white text-sm font-semibold rounded-full shadow-md">
                    MOST POPULAR
                  </div>
                )}

                <h3 className="text-2xl font-bold text-center mb-6 text-gray-900 dark:text-white">
                  {plan.name}
                </h3>

                <div className="text-center mb-8">
                  <span className="text-5xl sm:text-6xl font-extrabold text-gray-900 dark:text-gray-100">
                    {plan.price === 0 ? "Free" : `₹${plan.price.toLocaleString()}`}
                  </span>
                  <span className="block mt-1 text-base text-gray-500 dark:text-gray-400">
                    {plan.period}
                  </span>
                </div>

                <ul className="space-y-4 mb-10 text-gray-700 dark:text-gray-300">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-center gap-3">
                      <Check className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                      <span className="text-base">{feature}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handleUpgrade(plan)}
                  disabled={plan.disabled}
                  className={`w-full py-3.5 rounded-2xl font-semibold text-base transition-all duration-200 ${
                    plan.disabled
                      ? "bg-gray-200 dark:bg-gray-700 text-gray-500 cursor-not-allowed"
                      : "bg-gray-800 hover:bg-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600 text-white shadow-md hover:shadow-lg"
                  }`}
                >
                  {plan.buttonText}
                </button>
              </div>
            ))}
          </div>

          <p className="text-center mt-12 text-sm text-gray-500 dark:text-gray-500">
            Questions? Contact{" "}
            <a
              href="mailto:founders@exploresearch.net"
              className="underline hover:text-gray-700 dark:hover:text-gray-300"
            >
              support
            </a>
          </p>
        </div>
      </div>
    );
  }

  if (location.pathname === "/") {
    const homeVideoUrl = "https://youtu.be/HsMu7b73O4Y";
    const homeYoutubeId = extractYouTubeId(homeVideoUrl);
    const homeYoutubeEmbedUrl = homeYoutubeId
      ? `https://www.youtube-nocookie.com/embed/${homeYoutubeId}?autoplay=1&rel=0&modestbranding=1&iv_load_policy=3&playsinline=1`
      : homeVideoUrl;

    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 p-6">
        <h1 className={`${doodle.className} text-6xl sm:text-8xl mb-6`}>{doodle.text}</h1>
        <p className="text-xl sm:text-2xl text-gray-600 dark:text-gray-300 mb-10 text-center max-w-2xl">
          Discover Answers with Web Explore – Ask anything, get instant results
        </p>

        {homeYoutubeId && (
          <div className="mb-10 w-full max-w-4xl overflow-hidden rounded-3xl border border-gray-200 bg-black shadow-xl dark:border-gray-700">
            {activeEmbedSlug !== "home-hero" ? (
              <button
                type="button"
                onClick={() => setActiveEmbedSlug("home-hero")}
                className="group relative block w-full text-left bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900"
                aria-label="Play Web Explore AI walkthrough"
              >
                <div className="relative w-full" style={{ paddingTop: "56.25%" }}>
                  <span className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(56,189,248,0.28),transparent_34%),radial-gradient(circle_at_84%_78%,rgba(52,211,153,0.24),transparent_36%)]" aria-hidden="true" />
                  <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-black/15" aria-hidden="true" />
                  <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
                    <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white/95 shadow-xl transition-transform duration-200 group-hover:scale-105">
                      <span className="ml-1 h-0 w-0 border-y-[12px] border-y-transparent border-l-[18px] border-l-gray-900" />
                    </span>
                  </span>
                  <span className="absolute left-5 top-5 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                    Web Explore AI Walkthrough
                  </span>
                  <span className="absolute bottom-5 left-5 rounded-full bg-black/70 px-3 py-1 text-xs font-semibold text-white">
                    Watch walkthrough
                  </span>
                </div>
              </button>
            ) : (
              <div className="relative w-full" style={{ paddingTop: "56.25%" }}>
                <button
                  type="button"
                  onClick={() => setActiveEmbedSlug("")}
                  className="absolute right-3 top-3 z-10 rounded-full bg-black/65 px-3 py-1 text-xs font-semibold text-white backdrop-blur-sm hover:bg-black/80"
                >
                  Close video
                </button>
                <iframe
                  className="absolute inset-0 h-full w-full"
                  src={homeYoutubeEmbedUrl}
                  title="Web Explore AI homepage walkthrough"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
            )}
          </div>
        )}

        <button
          className="bg-gray-700 hover:bg-gray-800 text-white px-10 py-4 rounded-xl text-xl font-medium shadow-lg transition"
          onClick={() => navigate("/search")}
        >
          Start Exploring
        </button>
      </div>
    );
  }

  const queryParam = new URLSearchParams(location.search).get("query");
  const activeSearchQuery = queryParam || prompt;
  const tabImagesRaw = mode === "ai" ? imageResults : (Array.isArray(response?.images) ? response.images : []);
  const isQuerySensitive = isSensitiveValue(activeSearchQuery || "");
  const tabImages = tabImagesRaw.map((item) => normalizeImageItem(item, isQuerySensitive)).filter(Boolean);
  const imageSafeMode = safeSearchByTab.images;
  const visibleTabImages = imageSafeMode === "strict" ? tabImages.filter((item) => !item.isSensitive) : tabImages;
  const hiddenSensitiveCount = imageSafeMode === "strict" ? Math.max(0, tabImages.length - visibleTabImages.length) : 0;

  const videosWithSensitivity = videoResults.map((video) => ({
    ...video,
    isSensitive: isQuerySensitive || isSensitiveValue(`${video.title || ""} ${video.channel || ""} ${video.url || ""}`),
  }));
  const visibleVideos = safeSearchByTab.videos === "strict" ? videosWithSensitivity.filter((video) => !video.isSensitive) : videosWithSensitivity;
  const hiddenVideosCount = safeSearchByTab.videos === "strict" ? Math.max(0, videosWithSensitivity.length - visibleVideos.length) : 0;

  const shortVideosWithSensitivity = shortVideoResults.map((video) => ({
    ...video,
    isSensitive: isQuerySensitive || isSensitiveValue(`${video.title || ""} ${video.channel || ""} ${video.url || ""}`),
  }));
  const visibleShortVideos = safeSearchByTab.shortVideos === "strict" ? shortVideosWithSensitivity.filter((video) => !video.isSensitive) : shortVideosWithSensitivity;
  const hiddenShortVideosCount = safeSearchByTab.shortVideos === "strict" ? Math.max(0, shortVideosWithSensitivity.length - visibleShortVideos.length) : 0;

  const newsWithSensitivity = newsResults.map((item) => ({
    ...item,
    isSensitive: isQuerySensitive || isSensitiveValue(`${item.title || ""} ${item.snippet || ""} ${item.url || ""}`),
  }));
  const visibleNews = safeSearchByTab.news === "strict" ? newsWithSensitivity.filter((item) => !item.isSensitive) : newsWithSensitivity;
  const hiddenNewsCount = safeSearchByTab.news === "strict" ? Math.max(0, newsWithSensitivity.length - visibleNews.length) : 0;

  const handleSafeModeChange = async (tabKey, selectedMode) => {
    const normalized = normalizeSafeMode(selectedMode);
    setSafeSearchByTab((prev) => ({ ...prev, [tabKey]: normalized }));

    if (!activeSearchQuery) return;

    if (tabKey === "images") await fetchImageResults(activeSearchQuery, normalized);
    if (tabKey === "videos") await fetchVideoResults(activeSearchQuery, normalized);
    if (tabKey === "shortVideos") await fetchShortVideoResults(activeSearchQuery, normalized);
    if (tabKey === "news") await fetchNewsResults(activeSearchQuery, normalized);
  };

  const renderSafeSearchToolbar = (tabKey) => (
    <div className="safe-search-toolbar">
      <span className="safe-search-label">Safe Search</span>
      <div className="safe-search-options" role="tablist" aria-label="Safe Search mode">
        {SAFE_SEARCH_OPTIONS.map((option) => (
          <button
            type="button"
            key={option.key}
            className={`safe-search-chip ${safeSearchByTab[tabKey] === option.key ? "active" : ""}`}
            onClick={() => handleSafeModeChange(tabKey, option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );

  const renderImageGrid = (images) => (
    <div className="search-images-section">
      <div className="search-images-grid">
        {images.map((img, i) => {
          const shouldBlur = safeSearchByTab.images === "blur" && img.isSensitive;
          return (
            <a
              key={`${img.url}-${i}`}
              href={img.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`search-image-card ${shouldBlur ? "sensitive-blur" : ""}`}
            >
              <img
                src={img.renderUrl || img.url}
                alt={`Search visual ${i + 1}`}
                loading="lazy"
                onError={(e) => {
                  const renderUrl = img.renderUrl || "";
                  if (renderUrl.includes("/api/instagram/resolve-image") && e.currentTarget.dataset.fallback !== "1") {
                    e.currentTarget.dataset.fallback = "1";
                    e.currentTarget.src = img.url;
                    return;
                  }

                  if ((img.renderUrl || "") !== img.url && e.currentTarget.dataset.fallback !== "2") {
                    e.currentTarget.dataset.fallback = "2";
                    e.currentTarget.src = `/api/image-proxy?url=${encodeURIComponent(img.url)}`;
                    return;
                  }
                  e.currentTarget.style.display = "none";
                }}
              />
              {shouldBlur && <span className="safe-search-badge">Blurred</span>}
            </a>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="searchpage min-h-screen">
      <div className="nav-sidebar">
        <button className="sidebar-btn" onClick={() => setIsProfileSidebarOpen(true)} title="Profile">
          <User size={24} />
        </button>
        <button
          className="sidebar-btn"
          onClick={() => {
            setResponse(null);
            setPrompt("");
            setMode("search");
            setError("");
            navigate("/search");
          }}
          title="New Search"
        >
          <Plus size={24} />
        </button>
        <button className="theme-toggle-btn" onClick={toggleTheme} title="Toggle Theme">
          {theme === "light" ? <Moon size={24} /> : <Sun size={24} />}
        </button>
      </div>

      <div className={`profile-sidebar ${isProfileSidebarOpen ? "open" : ""}`}>
        <button
          className="absolute top-4 right-4 p-2 bg-gray-300 rounded-full hover:bg-gray-400"
          onClick={() => setIsProfileSidebarOpen(false)}
        >
          <X size={24} />
        </button>
        <h2 className="text-2xl font-semibold mb-6 border-b pb-2">Profile</h2>
        {user.name ? (
          <div className="flex flex-col items-center space-y-6">
            <img src={user.picture} alt="Profile" className="w-24 h-24 rounded-full object-cover border-2" />
            <p className="text-xl font-medium">{user.name}</p>
            <p className="text-sm text-gray-600">{user.email}</p>
            <p className="text-sm font-medium text-gray-400">Current Plan: {currentPlanName}</p>

            <button
              onClick={() => {
                navigate("/pricing");
                setIsProfileSidebarOpen(false);
              }}
              className="w-full bg-gray-600 hover:bg-gray-700 text-white py-3 rounded-lg"
            >
              Upgrade Plan
            </button>

            <button
              onClick={handleAutomateWorkflows}
              className="w-full bg-gray-600 hover:bg-gray-700 text-white py-3 rounded-lg font-medium shadow-md transition-all flex items-center justify-center"
            >
              Automate Workflows
            </button>

            <button
              className="w-full bg-gray-600 hover:bg-gray-700 text-white py-3 rounded-lg"
              onClick={() => {
                localStorage.removeItem("user");
                window.location.replace("/");
              }}
            >
              Sign Out
            </button>
          </div>
        ) : (
          <p className="text-center text-gray-600">Not signed in</p>
        )}
      </div>

      <div className="content-area">
        <div className={`full-width-container${response ? " has-response" : ""}`}>
          {location.pathname === "/search" && (
            <>
              <h1 className={doodle.className}>{doodle.text}</h1>
              <form onSubmit={handleSubmit} className="w-full max-w-2xl">
                <div className="input-container">
                  <input
                    type="text"
                    value={prompt}
                    onChange={(e) => debouncedSetPrompt(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSubmit(e)}
                    placeholder="How can I help you?"
                    disabled={loading}
                  />
                  <div className="input-buttons">
                    <div className={`model-dropdown ${isModelDropdownOpen ? "open" : ""}`}>
                      <button className="input-btn" onClick={toggleModelDropdown}>
                        <Bot size={12} />
                      </button>
                      <div className="model-dropdown-content">
                        {models.map((model) => (
                          <button
                            key={model}
                            className={selectedModel === model ? "model-option selected" : "model-option"}
                            onClick={() => selectModel(model)}
                          >
                            {model}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      className="input-btn"
                      onClick={() => setMode(mode === "search" ? "ai" : "search")}
                      title={modes.find((m) => m.key !== mode)?.label}
                    >
                      <Globe size={12} />
                    </button>
                    <button className={`input-btn ${listening ? "bg-red-500" : ""}`} onClick={handleMicClick}>
                      <Mic size={12} />
                    </button>
                  </div>
                </div>
              </form>
            </>
          )}

          {loading && (
            <div className="ai-loading-wrap">
              <div className="ai-orb-ring">
                <span /><span /><span /><span />
              </div>
              <p className="ai-loading-text">Generating response…</p>
            </div>
          )}

          {error && <p className="text-red-500 mt-6 text-center">{error}</p>}

          {response && (mode === "search" || mode === "ai") && (
            <div className="answer-container w-full">
              {queryParam && shouldShowHeading(mode === "ai" ? response.text : response.summary) && (
                <h2 className="text-2xl font-semibold text-center mb-5">
                  {decodeURIComponent(queryParam)}
                </h2>
              )}
              <div className="tabs">
                <button className={`tab ${activeTab === "answer" ? "active" : ""}`} onClick={() => showTab("answer")}>
                  Answer
                </button>
                <button className={`tab ${activeTab === "images" ? "active" : ""}`} onClick={() => showTab("images")}>
                  Images
                </button>
                <button
                  className={`tab ${activeTab === "videos" ? "active" : ""}`}
                  onClick={() => showTab("videos")}
                  disabled={!activeSearchQuery || videosLoading}
                >
                  Videos
                </button>
                <button
                  className={`tab ${activeTab === "short-videos" ? "active" : ""}`}
                  onClick={() => showTab("short-videos")}
                  disabled={!activeSearchQuery || shortVideosLoading}
                >
                  Short Videos
                </button>
                <button
                  className={`tab ${activeTab === "news" ? "active" : ""}`}
                  onClick={() => showTab("news")}
                  disabled={!activeSearchQuery || newsLoading}
                >
                  News
                </button>
                <button className={`tab ${activeTab === "sources" ? "active" : ""}`} onClick={() => showTab("sources")}>
                  Sources
                </button>
              </div>
              <div className="content">
                <div className={`content-section ${activeTab === "answer" ? "block" : "hidden"}`}>
                  {tabImages.length > 0 && (
                    <>
                      {renderSafeSearchToolbar("images")}
                      {hiddenSensitiveCount > 0 && (
                        <p className="safe-search-note">{hiddenSensitiveCount} sensitive image(s) hidden by Filter mode.</p>
                      )}
                      {visibleTabImages.length > 0 ? renderImageGrid(visibleTabImages) : (
                        <p className="sources-empty">No image available after Safe Search filtering.</p>
                      )}
                    </>
                  )}
                  <div
                    className="ai-response-body"
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(
                        makeCitationsClickable(
                          renderMarkdown(mode === "ai" ? (response.text || "No response available") : (response.summary || "No answer available")),
                          response.citations || []
                        ),
                        { ADD_ATTR: ["target", "rel"] }
                      ),
                    }}
                  />
                  {response.suggestions?.length > 0 && (
                    <div className="paa-section">
                      <h3 className="paa-title">People also ask</h3>
                      <div className="paa-list">
                        {response.suggestions.map((s, i) => (
                          <button key={i} className="paa-chip" onClick={() => handleSuggestionClick(s)}>
                            <span className="paa-icon">&#x1F50D;</span>
                            <span>{s}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className={`content-section ${activeTab === "images" ? "block" : "hidden"}`}>
                  {renderSafeSearchToolbar("images")}
                  {hiddenSensitiveCount > 0 && (
                    <p className="safe-search-note">{hiddenSensitiveCount} sensitive image(s) hidden by Filter mode.</p>
                  )}
                  {imagesLoading ? (
                    <div style={{ textAlign: "center", padding: "2rem" }}>
                      <p style={{ color: "var(--text-secondary)" }}>Loading images...</p>
                    </div>
                  ) : visibleTabImages.length > 0 ? (
                    renderImageGrid(visibleTabImages)
                  ) : (
                    <p className="sources-empty">Click the Images tab to load visuals for this response.</p>
                  )}
                </div>
                <div className={`content-section ${activeTab === "videos" ? "block" : "hidden"}`}>
                  {renderSafeSearchToolbar("videos")}
                  {hiddenVideosCount > 0 && (
                    <p className="safe-search-note">{hiddenVideosCount} sensitive video(s) hidden by Filter mode.</p>
                  )}
                  {videosLoading ? (
                    <div style={{ textAlign: "center", padding: "2rem" }}>
                      <p style={{ color: "var(--text-secondary)" }}>Loading videos...</p>
                    </div>
                  ) : visibleVideos.length > 0 ? (
                    <div className="google-videos-container">
                      {visibleVideos.map((video, i) => (
                        <a
                          key={`${video.videoId}-${i}`}
                          href={video.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`google-video-result ${safeSearchByTab.videos === "blur" && video.isSensitive ? "safe-blur-card" : ""}`}
                        >
                          <div className="google-video-thumbnail">
                            <img
                              src={video.thumbnail}
                              alt={video.title}
                              loading="lazy"
                              onError={(e) => {
                                e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 180'%3E%3Crect fill='%23202020' width='320' height='180'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23666' font-size='14'%3EVideo%3C/text%3E%3C/svg%3E";
                              }}
                            />
                            <div className="video-duration">{video.duration}</div>
                            <div className="video-play-icon">▶</div>
                          </div>
                          <div className="google-video-info">
                            <h3 className="google-video-title">{video.title}</h3>
                            <p className="google-video-channel">{video.channel}</p>
                            <p className="google-video-views">{video.views}</p>
                          </div>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="sources-empty">Click the Videos tab to see results.</p>
                  )}
                </div>
                <div className={`content-section ${activeTab === "short-videos" ? "block" : "hidden"}`}>
                  {renderSafeSearchToolbar("shortVideos")}
                  {hiddenShortVideosCount > 0 && (
                    <p className="safe-search-note">{hiddenShortVideosCount} sensitive short video(s) hidden by Filter mode.</p>
                  )}
                  {shortVideosLoading ? (
                    <div style={{ textAlign: "center", padding: "2rem" }}>
                      <p style={{ color: "var(--text-secondary)" }}>Loading short videos...</p>
                    </div>
                  ) : visibleShortVideos.length > 0 ? (
                    <div className="google-videos-container">
                      {visibleShortVideos.map((video, i) => (
                        <a
                          key={`${video.videoId || video.url}-${i}`}
                          href={video.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`google-video-result ${safeSearchByTab.shortVideos === "blur" && video.isSensitive ? "safe-blur-card" : ""}`}
                        >
                          <div className="google-video-thumbnail short-video-thumbnail">
                            <img
                              src={video.thumbnail}
                              alt={video.title}
                              loading="lazy"
                              onError={(e) => {
                                e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 180'%3E%3Crect fill='%23202020' width='320' height='180'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23666' font-size='14'%3EShort%3C/text%3E%3C/svg%3E";
                              }}
                            />
                            <div className="video-duration">{video.duration || "0:30"}</div>
                            <div className="video-play-icon">▶</div>
                          </div>
                          <div className="google-video-info">
                            <h3 className="google-video-title">{video.title}</h3>
                            <p className="google-video-channel">{video.channel || "YouTube Shorts"}</p>
                            <p className="google-video-views">{video.views || "Short video"}</p>
                          </div>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="sources-empty">Click the Short Videos tab to see results.</p>
                  )}
                </div>
                <div className={`content-section ${activeTab === "news" ? "block" : "hidden"}`}>
                  {renderSafeSearchToolbar("news")}
                  {hiddenNewsCount > 0 && (
                    <p className="safe-search-note">{hiddenNewsCount} sensitive news item(s) hidden by Filter mode.</p>
                  )}
                  {newsLoading ? (
                    <div style={{ textAlign: "center", padding: "2rem" }}>
                      <p style={{ color: "var(--text-secondary)" }}>Loading news...</p>
                    </div>
                  ) : visibleNews.length > 0 ? (
                    <div className="news-results-container">
                      {visibleNews.map((item, i) => (
                        <a
                          key={`${item.url}-${i}`}
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`news-result-card ${safeSearchByTab.news === "blur" && item.isSensitive ? "safe-blur-card" : ""}`}
                        >
                          <p className="news-source">{item.source || "News Source"}</p>
                          <h3 className="news-title">{item.title}</h3>
                          <p className="news-snippet">{item.snippet || "Read full story"}</p>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="sources-empty">Click the News tab to see results.</p>
                  )}
                </div>
                <div className={`content-section ${activeTab === "sources" ? "block" : "hidden"}`}>
                  {response.citations?.length > 0 ? (
                    <div className="sources-grid">
                      {response.citations.map((src, i) => {
                        let hostname = "";
                        try { hostname = new URL(src.url).hostname.replace("www.", ""); } catch {}
                        return (
                          <a
                            key={i}
                            href={src.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="source-card"
                          >
                            <div className="source-card-header">
                              <img
                                src={`https://www.google.com/s2/favicons?sz=32&domain=${hostname}`}
                                alt=""
                                className="source-favicon"
                                onError={(e) => { e.target.style.display = "none"; }}
                              />
                              <span className="source-hostname">{hostname || "Source"}</span>
                              <span className="source-num">{i + 1}</span>
                            </div>
                            <p className="source-title">{src.title || src.url}</p>
                          </a>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="sources-empty">No sources available for this response.</p>
                  )}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

export default App;