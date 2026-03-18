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
  const [integrations, setIntegrations] = useState({
    gmail: false,
    calendar: false,
    docs: false,
    sheets: false
  });

  const user = JSON.parse(localStorage.getItem("user") || "{}");

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
      promptTemplate: "help me find 10 people who went to {{school}} in the last few years who now work at {{company}}",
      fields: [
        { key: "school", label: "School / University", placeholder: "e.g. IIT Bombay, Stanford", required: true },
        { key: "company", label: "Target Company", placeholder: "e.g. Google, Cred", required: true }
      ]
    },
    {
      title: "YC Company Founders Details",
      slug: "yc-company-founders",
      promptTemplate: "do a deep dive on founders of YC company: {{company}}",
      fields: [
        { key: "company", label: "Company Name", placeholder: "e.g. Stripe, Brex, OpenAI", required: true }
      ]
    },
    {
      title: "Antler Company Founder Details",
      slug: "antler-company-founder",
      promptTemplate: "do a deep dive on founders of Antler company: {{company}}",
      fields: [
        { key: "company", label: "Company Name", placeholder: "e.g. Xalts, Razorpay", required: true }
      ]
    },
    {
      title: "YC Company Details",
      slug: "yc-company-details",
      promptTemplate: "Tell me about what this YC company called {{company}} does",
      fields: [
        { key: "company", label: "Company Name", placeholder: "e.g. Stripe, Airbnb, Cred", required: true }
      ]
    },
    {
      title: "Antler Company Details",
      slug: "antler-company-details",
      promptTemplate: "Tell me about what this Antler company called {{company}} does",
      fields: [
        { key: "company", label: "Company Name", placeholder: "e.g. Razorpay, Cred", required: true }
      ]
    },
    {
      title: "LinkedIn Viral Post Research",
      slug: "linkedin-viral-post",
      promptTemplate: "Tell a viral post by {{person name}} on LinkedIn",
      fields: [
        { key: "person name", label: "Person Name", placeholder: "e.g. Ankur Warikoo, Shradha Sharma", required: true }
      ]
    },
    {
      title: "Reddit Viral Post Research",
      slug: "reddit-viral-post",
      promptTemplate: "Tell me about a viral post on Reddit about {{person name}}",
      fields: [
        { key: "person name", label: "Person Name", placeholder: "e.g. Naval Ravikant, Lex Fridman", required: true }
      ]
    },
    {
      title: "Email Draft",
      slug: "email-draft",
      promptTemplate: "Draft me a email for {{subject}}",
      fields: [
        { key: "subject", label: "Email Subject / Purpose", placeholder: "e.g. job application follow-up, meeting request", required: true }
      ]
    },
    {
      title: "College Comparison",
      slug: "college-comparison",
      promptTemplate: "Compare colleges {{college 1}} and {{college 2}} and tell me which is overall better",
      fields: [
        { key: "college 1", label: "College 1", placeholder: "e.g. IIT Bombay, NIT Trichy", required: true },
        { key: "college 2", label: "College 2", placeholder: "e.g. IIIT Hyderabad, VIT Vellore", required: true }
      ]
    },
    {
      title: "Country Comparison to Settle",
      slug: "country-comparison",
      promptTemplate: "Country comparison to settle between {{country 1}} and {{country 2}}",
      fields: [
        { key: "country 1", label: "Country 1", placeholder: "e.g. Canada, Australia", required: true },
        { key: "country 2", label: "Country 2", placeholder: "e.g. Germany, Singapore", required: true }
      ]
    },
    {
      title: "University Comparison Abroad",
      slug: "university-comparison",
      promptTemplate: "Comparison between universities abroad: Compare university {{university 1}} and {{university 2}} and tell me which is overall better",
      fields: [
        { key: "university 1", label: "University 1", placeholder: "e.g. MIT, Stanford", required: true },
        { key: "university 2", label: "University 2", placeholder: "e.g. Oxford, Harvard", required: true }
      ]
    },
    {
      title: "Best Faculties at College",
      slug: "best-faculties-college",
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
      promptTemplate: "Best coaching institutes to prepare for {{exam}}",
      fields: [
        { key: "exam", label: "Exam Name", placeholder: "e.g. JEE Advanced, NEET, UPSC", required: true }
      ]
    },
    {
      title: "Best Restaurant in City",
      slug: "best-restaurant",
      promptTemplate: "Best restaurant in city {{city}}",
      fields: [
        { key: "city", label: "City Name", placeholder: "e.g. Mumbai, Bangalore, Ahmedabad", required: true }
      ]
    },
    {
      title: "Email Follow-Up Automation",
      slug: "email-followup",
      promptTemplate: "When I get a customer reply to my outbound email in Gmail, automatically analyze it and handle the follow-up: if positive interest send calendar invite, if question answer it, if no interest mark as closed - Gmail",
      fields: [
        { key: "gmail_label", label: "Gmail Label to Monitor (optional)", placeholder: "e.g. Outbound Leads", required: false }
      ]
    },
    {
      title: "Project Reminders",
      slug: "project-reminders",
      promptTemplate: "From the latest email about {{task subject}}, create project tasks, deadlines and reminders in Google Calendar for the team",
      fields: [
        { key: "task subject", label: "Task / Project Subject", placeholder: "e.g. Website Redesign, Client Onboarding", required: true }
      ]
    },
    {
      title: "Research Competitors",
      slug: "research-competitors",
      promptTemplate: "Research my main competitors {{competitor names}} and create a detailed Google Doc report with their strengths, weaknesses, pricing, recent news and possible future plans",
      fields: [
        { key: "competitor names", label: "Competitor Names (comma separated)", placeholder: "e.g. Canva, Figma, Notion", required: true }
      ]
    },
    {
      title: "Personalized Pitch Emails",
      slug: "pitch-emails",
      promptTemplate: "I have a Google Sheet with potential investors (columns: Name, Email, Focus Areas). Draft personalized cold pitch emails for each one highlighting why my startup fits their investment thesis - Gmail + Google Sheets",
      fields: [
        { key: "sheet_url", label: "Google Sheet URL", placeholder: "https://docs.google.com/spreadsheets/d/...", required: true },
        { key: "startup_name", label: "Your Startup Name", placeholder: "e.g. Taskify AI", required: true }
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

        setIntegrations(data);

      } catch (err) {
        console.error("Failed to fetch integrations", err);
      }

    };

    fetchIntegrations();

  }, []);

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

    if (id && query) {
      handleUrlSearch(query, id);
    } else if (prefillFromState && location.pathname === "/search") {
      setPrompt(prefillFromState);
      setResponse(null);
      setMode("search");
      setError("");
    } else if (location.pathname === "/search") {
      setResponse(null);
      setPrompt("");
      setMode("search");
      setError("");
    }
  }, [id, location.search, location.pathname, location.state?.prefillPrompt]);

  const toggleTheme = () => setTheme(theme === "light" ? "dark" : "light");

  const toggleModelDropdown = () => setIsModelDropdownOpen(!isModelDropdownOpen);

  const selectModel = (model) => {
    setSelectedModel(model);
    setIsModelDropdownOpen(false);
  };

  const generateQuerySlug = (query) =>
    query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);

  const debouncedSetPrompt = useCallback(debounce((value) => setPrompt(value), 300), []);

  const connectGoogleTool = async (tool) => {

    try {

      const user = JSON.parse(localStorage.getItem("user") || "{}");

      if (!user?.id) {
        alert("Please login first");
        return;
      }

      const res = await fetch(`/api/google/auth?tool=${tool}`, {
        headers: {
          "x-user-id": user.id
        }
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Failed to connect");
        return;
      }

      if (data.authUrl) {
        window.open(data.authUrl, "_blank", "width=500,height=600");
      }

    } catch (err) {
      console.error(err);
      alert("Connection failed");
    }

  };

  const fetchTodayMeetings = async () => {

  try {

    const user = JSON.parse(localStorage.getItem("user") || "{}");

    if (!user?.id) {
      alert("Please login first");
      return;
    }

    const res = await fetch("/api/calendar/today-meetings", {
      headers: {
        "x-user-id": user.id
      }
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || "Failed to fetch meetings");
      return;
    }

    // auto fill prompt in chat
    setPrompt(data.message);

    // automatically run AI search
    handleSubmit(null, data.message, "ai");

  } catch (err) {

    console.error(err);
    alert("Failed to fetch calendar meetings");

  }

};

  const handleMicClick = () => {
    if (!recognition) {
      alert("Speech recognition is not supported in this browser.");
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

    const isValid = workflow.fields.every(
      (f) => !f.required || (values[f.key]?.trim?.() || "").length > 0
    );

    const handleGenerate = async () => {
        if (!isValid) return;

      if (workflow.slug === "email-followup") {

      try {

        const res = await fetch("/api/workflows/email-followup/start", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": user?.id || ""
          },
          body: JSON.stringify({
            gmail_label: values.gmail_label || null
          })
        });

        const data = await res.json();

        if (!res.ok) {
          alert(data.error || "Automation failed");
          return;
        }

        alert("Email Follow-Up automation started successfully!");

        navigate("/search");

        } catch (err) {
          alert("Failed to start automation");
        }

        return;
      }


      let finalPrompt = workflow.promptTemplate;
      Object.entries(values).forEach(([k, v]) => {
        finalPrompt = finalPrompt.replace(`{{${k}}}`, (v || "").trim());
      });

      navigate("/search", { state: { prefillPrompt: finalPrompt } });
    };

    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
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
                  <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                    {field.label}
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  <input
                    type="text"
                    value={values[field.key] || ""}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className="w-full px-5 py-4 text-lg border border-gray-300 dark:border-gray-600 rounded-2xl focus:outline-none focus:border-gray-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    onKeyDown={(e) => e.key === "Enter" && isValid && handleGenerate()}
                  />
                </div>
              ))}
            </div>

            <button
              onClick={handleGenerate}
              disabled={!isValid}
              className={`mt-8 w-full py-4 rounded-2xl font-semibold text-lg transition-all ${
                isValid
                  ? "bg-gray-700 hover:bg-gray-800 text-white"
                  : "bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed"
              }`}
            >
              Generate Query & Go to Search →
            </button>
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

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
            {workflowCards.map((card, index) => (
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

                  {card.slug === "email-followup" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        connectGoogleTool("gmail");
                      }}
                      className="mt-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm"
                    >
                      Connect Gmail
                    </button>
                  )}

                  {card.slug === "project-reminders" && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();

                        if (!integrations.calendar) {
                          connectGoogleTool("calendar");
                        } else {
                          await fetchTodayMeetings();
                        }
                      }}
                      className="mt-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm"
                    >
                      Connect Calendar
                    </button>
                  )}

                  {card.slug === "research-competitors" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        connectGoogleTool("docs");
                      }}
                      className="mt-2 px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg text-sm"
                    >
                      Connect Docs
                    </button>
                  )}

                  {card.slug === "pitch-emails" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        connectGoogleTool("sheets");
                      }}
                      className="mt-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm"
                    >
                      Connect Sheets
                    </button>
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
          "Dedicated support",
        ],
        buttonText: "Upgrade to ULTRA",
        popular: false,
      },
    ];

    const handleUpgrade = async (plan) => {
      if (plan.disabled) return;

      if (!user || !user.id) {
        alert("Please sign in first to upgrade your plan");
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
                alert(`Successfully upgraded to ${plan.name} plan!`);
                window.location.reload();
              } else {
                const error = await verifyResponse.json();
                alert(`Payment verification failed: ${error.error}`);
              }
            } catch (err) {
              console.error("Payment verification error:", err);
              alert("Payment verification failed. Please contact support.");
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
        alert(`Payment failed: ${err.message}`);
      }
    };

    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-12 px-4 sm:px-6 lg:px-8">
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
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 p-6">
        <h1 className={`${doodle.className} text-6xl sm:text-8xl mb-6`}>{doodle.text}</h1>
        <p className="text-xl sm:text-2xl text-gray-600 dark:text-gray-300 mb-10 text-center max-w-2xl">
          Discover Answers with Web Explore – Ask anything, get instant results
        </p>
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
            <p className="text-sm font-medium text-gray-400">Current Plan: FREE</p>

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
        <div className="full-width-container">
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
                          <button key={model} onClick={() => selectModel(model)}>
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
            <div className="mt-8 flex justify-center">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-gray-600"></div>
            </div>
          )}

          {error && <p className="text-red-500 mt-6 text-center">{error}</p>}

          {response && mode === "search" && (
            <div className="mt-8 p-4 answer-container w-full">
              {queryParam && shouldShowHeading(response.text) && (
                <h1 className="text-4xl font-handwritten text-center mb-6">
                  {decodeURIComponent(queryParam)}
                </h1>
              )}
              <div className="tabs flex gap-3 mb-6">
                <button className={`tab ${activeTab === "answer" ? "active" : ""}`} onClick={() => showTab("answer")}>
                  Answer
                </button>
                <button className={`tab ${activeTab === "sources" ? "active" : ""}`} onClick={() => showTab("sources")}>
                  Sources
                </button>
              </div>
              <div className="content">
                <div className={`content-section ${activeTab === "answer" ? "block" : "hidden"}`}>
                  <p
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(
                        makeCitationsClickable(response.summary || "No answer available", response.citations || []),
                        { ADD_ATTR: ["target", "rel"] }
                      ),
                    }}
                  />
                  {response.suggestions?.length > 0 && (
                    <div className="follow-up mt-6">
                      <h3>People also ask</h3>
                      {response.suggestions.map((s, i) => (
                        <button key={i} onClick={() => handleSuggestionClick(s)}>
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className={`content-section ${activeTab === "sources" ? "block" : "hidden"}`}>
                  <ul>
                    {response.citations?.map((src, i) => (
                      <li key={i} className="source-item">
                        <a href={src.url} target="_blank" rel="noopener noreferrer">
                          {src.title || src.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {response && mode === "ai" && (
            <div className="mt-8 p-4 response-container w-full">
              {queryParam && shouldShowHeading(response.summary) && (
                <h1 className="text-4xl font-handwritten text-center mb-6">
                  {decodeURIComponent(queryParam)}
                </h1>
              )}
              <p
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(
                    makeCitationsClickable(response.text || "No response available", []),
                    { ADD_ATTR: ["target", "rel"] }
                  ),
                }}
              />
              {response.suggestions?.length > 0 && (
                <div className="follow-up mt-6">
                  <h3>People also ask</h3>
                  {response.suggestions.map((s, i) => (
                    <button key={i} onClick={() => handleSuggestionClick(s)}>
                      {s}
                    </button>
                  ))}
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