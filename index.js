import { config } from "dotenv";
config();

import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

async function main() {
  try {
    const { text } = await generateText({
      model: openai("gpt-4o-mini"),
      prompt: "What is love?",
    });
    console.log(text);
  } catch (error) {
    console.error("Error:", error.message);
  }
}

main();
