import React, { useState, useCallback, useEffect } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import debounce from "lodash/debounce";
import DOMPurify from "dompurify";
import { Plus, User, X, Bot, Globe, Mic, Sun, Moon, Check } from "lucide-react";
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

  // ── Consistent Title for all pages ───────────────────────────────────────
  useEffect(() => {
    const isDev = import.meta.env.DEV; // Vite mein true rahega local mein

    if (location.pathname.startsWith("/search")) {
      document.title = isDev ? "Explore - Local" : "Explore";
    } else if (location.pathname === "/pricing") {
      document.title = isDev ? "Pricing - Explore Local" : "Pricing - Explore";
    } else if (location.pathname === "/" || location.pathname === "") {
      document.title = isDev ? "Explore - Local" : "Explore";
    } else {
      document.title = isDev ? "Explore - Local" : "Explore";
    }
  }, [location.pathname]);

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

  const generateQuerySlug = (query) =>
    query
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);

  const debouncedSetPrompt = useCallback(
    debounce((value) => setPrompt(value), 300),
    []
  );

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

  const handleSubmit = async (e, customPrompt = null, customMode = null) => {
    if (e?.preventDefault) e.preventDefault();
    const query = customPrompt || prompt;
    const activeMode = customMode || mode;

    if (!query.trim() || query.length < 3) {
      setError("Please enter a valid query (minimum 3 characters)");
      return;
    }

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
          setError((data.error || "Plan limit reached") + " → Redirecting to pricing page...");
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
        navigate(`/search/${data.querySlug}-${data.finalId}?query=${encodeURIComponent(query)}`);
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
          setError((data.error || "Plan limit reached") + " → Redirecting to pricing page...");
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
      setMode(searchId.startsWith("ai/") ? "ai" : "search");
      setResponse(data);

      const querySlug = generateQuerySlug(query);
      const finalId = searchId.includes("new/") ? data.finalId || uuidv4() : searchId.split("-").pop();

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

  useEffect(() => {
    const query = new URLSearchParams(location.search).get("query");
    if (id && query) {
      handleUrlSearch(query, id);
    } else if (location.pathname === "/search") {
      setResponse(null);
      setPrompt("");
      setMode("search");
      setError("");
    }
  }, [id, location.search, location.pathname]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(theme === "light" ? "dark" : "light");
  };

  const handleSuggestionClick = (suggestion) => {
    setPrompt(suggestion);
    handleSubmit(null, suggestion, mode);
  };

  const makeCitationsClickable = (text, citations) => {
    if (!text) return "No content available";
    if (!citations?.length) return text;
    return text.replace(/\[(\d+)\]/g, (match, p1) => {
      const citation = citations.find((c) => c.id.toString() === p1);
      return citation
        ? `<a href="${citation.url}" target="_blank" rel="noopener noreferrer"><sup className="citation">[${p1}]</sup></a>`
        : `<sup className="citation">${match}</sup>`;
    });
  };

  const toggleModelDropdown = () => setIsModelDropdownOpen(!isModelDropdownOpen);
  const selectModel = (model) => {
    setSelectedModel(model);
    setIsModelDropdownOpen(false);
  };

  const showTab = (tabId) => {
    setActiveTab(tabId);
  };

  const queryParam = new URLSearchParams(location.search).get("query");

  // ── PRICING PAGE ─────────────────────────────────────────────────────────
  if (location.pathname === "/pricing") {
    const plans = [
      {
        name: "FREE",
        price: 0,
        period: "Lifetime",
        features: [
          "100 AI Credits",
          "1 Credit = 1,000 tokens",
          "Basic support",
        ],
        popular: false,
        buttonText: "Current Plan",
        disabled: true,
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
        popular: true,
        buttonText: "Upgrade to PRO",
        disabled: false,
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
        popular: false,
        buttonText: "Upgrade to ULTRA",
        disabled: false,
      },
    ];

    const loadRazorpay = () => {
      return new Promise((resolve) => {
        if (window.Razorpay) return resolve();
        const script = document.createElement("script");
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.onload = resolve;
        document.body.appendChild(script);
      });
    };

    const handleUpgrade = async (plan) => {
      if (plan.name === "FREE") return;

      try {
        const res = await fetch("/api/create-razorpay-order", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": user?.id || "",
          },
          body: JSON.stringify({ planName: plan.name }),
        });

        const { order } = await res.json();

        if (!order?.id) {
          alert("Failed to start payment");
          return;
        }

        await loadRazorpay();

        const options = {
          key: process.env.RAZORPAY_KEY_ID,
          amount: order.amount,
          currency: order.currency,
          name: "Explore",
          description: `Upgrade to ${plan.name} Plan`,
          order_id: order.id,
          handler: async function (response) {
            const verifyRes = await fetch("/api/verify-razorpay-payment", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-user-id": user?.id || "",
              },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                planName: plan.name,
              }),
            });

            const verifyData = await verifyRes.json();

            if (verifyData.success) {
              alert(`Payment successful! Upgraded to ${plan.name}`);
              navigate("/search");
              window.location.reload();
            } else {
              alert("Payment verification failed");
            }
          },
          prefill: {
            name: user.name || "",
            email: user.email || "",
          },
          theme: {
            color: "#6b7280",
          },
        };

        const rzp = new window.Razorpay(options);
        rzp.open();
      } catch (err) {
        console.error(err);
        alert("Something went wrong while starting payment");
      }
    };

    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 dark:text-white mb-4">
              Choose Your Plan
            </h1>
            <p className="text-lg sm:text-xl text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
              Unlock more tokens, advanced models and priority access
            </p>
          </div>

          <div className="text-center mb-8">
            <button
              onClick={() => navigate("/search")}
              className="inline-flex items-center gap-2 px-6 py-3 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-medium rounded-lg transition shadow-sm"
            >
              ← Back to Search
            </button>
          </div>

          <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`relative bg-white dark:bg-gray-800 rounded-3xl p-6 sm:p-8 shadow-xl transition-all hover:shadow-2xl ${
                  plan.popular ? "ring-4 ring-gray-400 scale-105 md:scale-110" : "border border-gray-200 dark:border-gray-700"
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gray-700 text-white text-xs sm:text-sm font-bold px-5 py-1 rounded-full">
                    MOST POPULAR
                  </div>
                )}

                <h2 className="text-2xl sm:text-3xl font-bold text-center mb-3 text-gray-800 dark:text-white">
                  {plan.name}
                </h2>

                <div className="text-center mb-6 sm:mb-8">
                  <span className="text-4xl sm:text-6xl font-bold text-gray-800 dark:text-gray-200">
                    {plan.price === 0 ? "Free" : `₹${plan.price}`}
                  </span>
                  <span className="text-base sm:text-lg text-gray-500 dark:text-gray-400 block">
                    {plan.period}
                  </span>
                </div>

                <ul className="space-y-3 sm:space-y-4 mb-8 sm:mb-10 text-gray-700 dark:text-gray-300">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <Check className="w-5 h-5 sm:w-6 sm:h-6 text-gray-500 mt-0.5 flex-shrink-0" />
                      <span className="text-sm sm:text-base">{feature}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handleUpgrade(plan)}
                  disabled={plan.disabled}
                  className={`w-full py-3 sm:py-4 rounded-2xl font-bold text-base sm:text-lg transition-all ${
                    plan.disabled
                      ? "bg-gray-300 dark:bg-gray-700 text-gray-700 cursor-not-allowed"
                      : "bg-gray-700 hover:bg-gray-800 text-white"
                  }`}
                >
                  {plan.buttonText}
                </button>
              </div>
            ))}
          </div>

          <p className="text-center mt-10 sm:mt-16 text-sm sm:text-base text-gray-500 dark:text-gray-400">
            Cancel anytime • Secure payment • Questions? Contact support
          </p>
        </div>
      </div>
    );
  }

  // ── HOME / LANDING PAGE ──────────────────────────────────────────────────
  if (location.pathname === "/") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 p-6">
        <h1 className="explore-doodle text-6xl sm:text-8xl mb-6">Explore</h1>
        <p className="text-xl sm:text-2xl text-gray-600 dark:text-gray-300 mb-10 text-center max-w-2xl">
          Discover Answers with Explore – Ask anything, get instant results
        </p>
        <button
          className="bg-blue-600 hover:bg-blue-700 text-white px-10 py-4 rounded-xl text-xl font-medium shadow-lg transition"
          onClick={() => navigate("/search")}
        >
          Start Exploring
        </button>
      </div>
    );
  }

  // ── MAIN SEARCH UI ───────────────────────────────────────────────────────
  return (
    <div className="searchpage min-h-screen">
      {/* Sidebar */}
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

      {/* Profile Sidebar */}
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
            <p className="text-sm font-medium text-blue-600">Current Plan: FREE</p>

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
              className="w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded-lg"
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

      {/* Main Content */}
      <div className="content-area">
        <div className="full-width-container">
          {location.pathname === "/search" && (
            <>
              <h1 className="explore-doodle">Explore</h1>

              <form onSubmit={handleSubmit} className="w-full max-w-2xl">
                <div className="input-container">
                  <input
                    type="text"
                    value={prompt}
                    onChange={(e) => debouncedSetPrompt(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSubmit(e)}
                    placeholder="Curious? Just ask."
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

                    <button
                      className={`input-btn ${listening ? "bg-red-500" : ""}`}
                      onClick={handleMicClick}
                    >
                      <Mic size={12} />
                    </button>
                  </div>
                </div>
              </form>
            </>
          )}

          {loading && (
            <div className="mt-8 flex justify-center">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500"></div>
            </div>
          )}

          {error && <p className="text-red-500 mt-6 text-center">{error}</p>}

          {/* Response sections - same as before */}
          {response && mode === "search" && (
            <div className="mt-8 p-4 answer-container w-full">
              {queryParam && (
                <h1 className="text-4xl font-handwritten text-center mb-6">
                  {decodeURIComponent(queryParam)}
                </h1>
              )}
              <div className="tabs flex gap-3 mb-6">
                <button
                  className={`tab ${activeTab === "answer" ? "active" : ""}`}
                  onClick={() => showTab("answer")}
                >
                  Answer
                </button>
                <button
                  className={`tab ${activeTab === "sources" ? "active" : ""}`}
                  onClick={() => showTab("sources")}
                >
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
              {queryParam && (
                <h1 className="text-4xl font-handwritten text-center mb-6">
                  {decodeURIComponent(queryParam)}
                </h1>
              )}
              <p
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(
                    makeCitationsClickable(response.text || "No response available", response.citations || []),
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