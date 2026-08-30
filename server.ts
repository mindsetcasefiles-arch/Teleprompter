import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.post("/api/format-script", async (req, res) => {
    try {
      const { text } = req.body;
      
      if (!text) {
        return res.status(400).json({ error: "Text is required" });
      }

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: "GEMINI_API_KEY is missing" });
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      let response;
      let retries = 3;
      let delay = 1000;

      while (retries > 0) {
        try {
          response = await ai.interactions.create({
            model: "gemini-3.7-flash",
            input: `You are an expert teleprompter script formatter. 
Your job is to read the provided script and add subtle, professional HTML formatting to make it easy for a speaker to read.

Follow these strict rules:
1. Emphasize the most important spoken words using bold (<b>).
2. Add italic (<i>) for vocal direction, pauses, or parentheticals (e.g., <i>[Pause for applause]</i>).
3. Do NOT rewrite the text. Keep the exact words. Only add HTML tags.
4. Keep the output clean. Do not wrap in markdown \`\`\`html blocks, just return the raw text.
5. You may use <br><br> to break up extremely long paragraphs to give the speaker natural pause points.

Script to format:
${text}`
          });
          break; // Success, exit retry loop
        } catch (error: any) {
          if (error?.status === 503 || error?.message?.includes("503") || error?.status === "UNAVAILABLE") {
            retries--;
            if (retries === 0) throw error;
            console.log(`Gemini API 503 error, retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2; // Exponential backoff
          } else {
            throw error; // Rethrow non-503 errors immediately
          }
        }
      }

      let formattedText = response?.output_text || text;
      // Strip markdown code block if present
      if (formattedText.startsWith('\`\`\`html')) {
        formattedText = formattedText.replace(/^\`\`\`html\n?/, '').replace(/\n?\`\`\`$/, '');
      } else if (formattedText.startsWith('\`\`\`')) {
        formattedText = formattedText.replace(/^\`\`\`\n?/, '').replace(/\n?\`\`\`$/, '');
      }

      res.json({ formattedText });
    } catch (error) {
      console.error("Gemini API Error:", error);
      res.status(500).json({ error: "Failed to format script" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // Express 5.x requires '*all' but we'll use standard '*' if it's express 4.x
    // I see express 4.21.2 in package.json, so '*' is correct.
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
