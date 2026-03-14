import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: "Who is Leo Messi?",
        search_depth: "basic",
        max_results: 10,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(data.results);
  } catch (error) {
    console.error("Error:", error);
  }
}

main();