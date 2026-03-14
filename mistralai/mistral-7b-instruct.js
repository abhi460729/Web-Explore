import { config } from "dotenv";
config();

const API_URL = "https://openrouter.ai/api/v1/chat/completions";

async function main() {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost", // optional but good for attribution
      "X-Title": "CLI Bot",               // optional app name
    },
    body: JSON.stringify({
      model: "mistralai/mistral-7b-instruct", // ✅ correct model ID
      messages: [
        { role: "user", content: "Kiara Advani birthdate?" }
      ]
    }),
  });

  const data = await response.json();
  console.log("Full API response:", JSON.stringify(data, null, 2));
  console.log("Response:", data.choices?.[0]?.message?.content);
}

main().catch(console.error);
