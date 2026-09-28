/**
 * The ONLY file that talks to an AI provider. Swap this implementation to
 * change models/providers; the rest of the system only sees `VisionProvider`.
 */
export interface VisionProvider {
  name: string;
  /** Returns the raw text response for one image + prompt. Throws ProviderError. */
  complete(prompt: string, imageBase64: string, mime: string): Promise<string>;
}

export type ProviderErrorKind = "rate_limit" | "credits" | "denied" | "unavailable" | "config" | "bad_request";

export class ProviderError extends Error {
  constructor(public kind: ProviderErrorKind, message: string, public status?: number) {
    super(message);
    this.name = "ProviderError";
  }
}

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

export function createLovableGeminiProvider(apiKey: string | undefined): VisionProvider {
  return {
    name: `lovable-gateway:${MODEL}`,
    async complete(prompt, imageBase64, mime) {
      if (!apiKey) throw new ProviderError("config", "AI service is not configured.");
      const res = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:${mime};base64,${imageBase64}` } },
            ],
          }],
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error("AI provider error", res.status, text.slice(0, 500));
        if (res.status === 429) throw new ProviderError("rate_limit", "AI service is busy. Please try again shortly.", 429);
        if (res.status === 402) throw new ProviderError("credits", "AI credits are exhausted. Please contact your administrator.", 402);
        if (res.status === 403) throw new ProviderError("denied", "AI service denied the request.", 403);
        if (res.status === 400) throw new ProviderError("bad_request", "AI service rejected the image.", 400);
        throw new ProviderError("unavailable", `AI service unavailable (${res.status}).`, res.status);
      }
      const data = await res.json();
      return data?.choices?.[0]?.message?.content ?? "";
    },
  };
}
