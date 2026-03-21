import React, { useState, useCallback, useEffect } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import debounce from "lodash/debounce";
import DOMPurify from "dompurify";
import { Plus, User, X, Bot, Globe, Mic, Sun, Moon, Check, Zap, ArrowLeft } from "lucide-react";
import { v4 as uuidv4 } from "uuid";

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;
if (recognition) {
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = "en-US";
}

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
    e.stopPropagation();
    navigate("/pricing");
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
    const shortMatch = trimmedUrl.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/);
    if (shortMatch?.[1]) return shortMatch[1];

    const embedMatch = trimmedUrl.match(/youtube(?:-nocookie)?\.com\/embed\/([a-zA-Z0-9_-]{6,})/);
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

  const showTab = (tab) => setActiveTab(tab);

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
          body: JSON.stringify({ query }),
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
          body: JSON.stringify({ query }),
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
      "pitch-emails",
      "send-doc-emails",
      "study-plan"
    ]);
    const isIntegrationWorkflow = integrationWorkflowSlugs.has(workflow.slug);

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


      let finalPrompt = workflow.promptTemplate;
      Object.entries(values).forEach(([k, v]) => {
        finalPrompt = finalPrompt.replace(`{{${k}}}`, (v || "").trim());
      });

      navigate("/search", { state: { prefillPrompt: finalPrompt } });
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
                  <input
                    type="text"
                    value={values[field.key] || ""}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className="w-full px-5 py-4 text-lg border border-gray-300 dark:border-gray-600 rounded-2xl focus:outline-none focus:border-gray-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    onKeyDown={(e) => e.key === "Enter" && isValid && handleGenerate()}
                  />

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
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  {hasPitchLocalFile
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
              ) : isIntegrationWorkflow ? "Execute Task" : "Generate Query & Go to Search →"}
            </button>

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
                  onClick={() => navigate(`/workflow-input/${card.slug}`)}
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

          {response && mode === "search" && (
            <div className="answer-container w-full">
              {queryParam && shouldShowHeading(response.text) && (
                <h2 className="text-2xl font-semibold text-center mb-5">
                  {decodeURIComponent(queryParam)}
                </h2>
              )}
              <div className="tabs">
                <button className={`tab ${activeTab === "answer" ? "active" : ""}`} onClick={() => showTab("answer")}>
                  Answer
                </button>
                <button className={`tab ${activeTab === "sources" ? "active" : ""}`} onClick={() => showTab("sources")}>
                  Sources
                </button>
              </div>
              <div className="content">
                <div className={`content-section ${activeTab === "answer" ? "block" : "hidden"}`}>
                  <div
                    className="ai-response-body"
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(
                        makeCitationsClickable(renderMarkdown(response.summary || "No answer available"), response.citations || []),
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

          {response && mode === "ai" && (
            <div className="response-container w-full">
              {queryParam && shouldShowHeading(response.summary) && (
                <h2 className="text-2xl font-semibold text-center mb-5">
                  {decodeURIComponent(queryParam)}
                </h2>
              )}
              <div
                className="ai-response-body"
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(
                    makeCitationsClickable(renderMarkdown(response.text || "No response available"), []),
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
          )}
        </div>
      </div>
    </div>
  );
}

export default App;