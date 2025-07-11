/** @format */

import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { validateTastingNotes, sanitizeTastingNotes, type TastingNotes } from './tastingNotesValidator.js';

dotenv.config();

export interface GeminiResponse {
  success: boolean;
  data?: any;
  error?: string;
}

class RateLimiter {
  private callTimestamps: number[] = [];
  private readonly maxCalls = 10;
  private readonly timeWindowMs = 60000; // 1 minute
  private readonly minDelayMs = 6000; // 6 seconds minimum between calls

  async waitForRateLimit(): Promise<void> {
    const now = Date.now();

    // Remove timestamps older than the time window
    this.callTimestamps = this.callTimestamps.filter((timestamp) => now - timestamp < this.timeWindowMs);

    // Check if we're at the rate limit
    if (this.callTimestamps.length >= this.maxCalls) {
      const oldestCall = Math.min(...this.callTimestamps);
      const waitTime = this.timeWindowMs - (now - oldestCall) + 1000; // Add 1 second buffer

      // Rate limit reached - waiting (suppress verbose logging)
      await new Promise((resolve) => setTimeout(resolve, waitTime));

      // Re-check after waiting
      return this.waitForRateLimit();
    }

    // Ensure minimum delay between calls
    if (this.callTimestamps.length > 0) {
      const lastCall = Math.max(...this.callTimestamps);
      const timeSinceLastCall = now - lastCall;

      if (timeSinceLastCall < this.minDelayMs) {
        const delayTime = this.minDelayMs - timeSinceLastCall;
        // Enforcing minimum delay (suppress verbose logging)
        await new Promise((resolve) => setTimeout(resolve, delayTime));
      }
    }

    // Record this call
    this.callTimestamps.push(Date.now());
  }

  isRateLimitError(error: any): boolean {
    return (
      error &&
      (error.status === 429 ||
        error.message?.includes('rate limit') ||
        error.message?.includes('quota') ||
        error.message?.includes('429'))
    );
  }

  async handleRateLimitError(): Promise<void> {
    // Rate limit error detected - waiting 60 seconds before retry (suppress verbose logging)
    await new Promise((resolve) => setTimeout(resolve, 60000));
    // Clear timestamps to reset tracking
    this.callTimestamps = [];
  }
}

interface ModelConfig {
  name: string;
  failureCount: number;
  lastFailureTime: number;
}

export class GeminiClient {
  private genAI: GoogleGenerativeAI;
  private model: any;
  private readonly maxRetries = 2;
  private readonly retryDelay = 1000; // 1 second
  private rateLimiter = new RateLimiter();

  // Model fallback configuration
  private models: ModelConfig[] = [
    { name: 'gemini-2.5-flash-preview-04-17', failureCount: 0, lastFailureTime: 0 },
    { name: 'gemini-2.5-flash', failureCount: 0, lastFailureTime: 0 },
    { name: 'gemini-2.5-flash-lite-preview-06-17', failureCount: 0, lastFailureTime: 0 },
    { name: 'gemini-2.0-flash-exp', failureCount: 0, lastFailureTime: 0 },
  ];
  private currentModelIndex = 0;
  private readonly modelFailureThreshold = 2;
  private readonly cooldownPeriodMs = 600000; // 10 minutes

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }

    this.genAI = new GoogleGenerativeAI(apiKey);
    this.updateModel();
  }

  private updateModel(): void {
    const currentModel = this.models[this.currentModelIndex];
    this.model = this.genAI.getGenerativeModel({ model: currentModel.name });
    // Using model (suppress verbose logging)
  }

  private isModelBlocked(error: any): boolean {
    return (
      error &&
      (error.status === 429 ||
        error.status === 403 ||
        error.message?.includes('quota') ||
        error.message?.includes('limit') ||
        error.message?.includes('blocked') ||
        error.message?.includes('429') ||
        error.message?.includes('403') ||
        error.message?.includes('rate limit') ||
        error.message?.includes('Too Many Requests'))
    );
  }

  private switchToNextModel(): boolean {
    const currentModel = this.models[this.currentModelIndex];
    currentModel.failureCount++;
    currentModel.lastFailureTime = Date.now();

    // Model failed multiple times (suppress verbose logging)

    // Check if current model has exceeded failure threshold
    if (currentModel.failureCount >= this.modelFailureThreshold) {
      // Try to find next available model
      for (let i = 1; i < this.models.length; i++) {
        const nextIndex = (this.currentModelIndex + i) % this.models.length;
        const nextModel = this.models[nextIndex];

        // Check if it's the primary model and if cooldown period has passed
        if (nextIndex === 0) {
          const timeSinceLastFailure = Date.now() - nextModel.lastFailureTime;
          if (timeSinceLastFailure < this.cooldownPeriodMs) {
            // Primary model still in cooldown (suppress verbose logging)
            continue;
          } else {
            // Reset primary model failure count after cooldown
            nextModel.failureCount = 0;
            // Primary model cooldown complete - resetting to primary model
          }
        }

        // Check if this model is available (not over failure threshold)
        if (nextModel.failureCount < this.modelFailureThreshold) {
          this.currentModelIndex = nextIndex;
          this.updateModel();
          // Switched to model (suppress verbose logging)
          return true;
        }
      }

      // All models are blocked, wait for cooldown
      // All models are blocked - waiting for primary model cooldown
      return false;
    }

    return true; // Current model can still be used
  }

  private async handleModelFailure(): Promise<boolean> {
    const switched = this.switchToNextModel();

    if (!switched) {
      // All models blocked, wait for primary model cooldown
      const primaryModel = this.models[0];
      const timeSinceLastFailure = Date.now() - primaryModel.lastFailureTime;
      const waitTime = this.cooldownPeriodMs - timeSinceLastFailure;

      if (waitTime > 0) {
        console.log(`All models blocked. Waiting ${Math.ceil(waitTime / 60000)} minutes for primary model cooldown...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));

        // Reset to primary model after cooldown
        this.models[0].failureCount = 0;
        this.currentModelIndex = 0;
        this.updateModel();
        // Cooldown complete - reset to primary model
      }
    }

    return true;
  }

  getModelStatus(): { currentModel: string; models: ModelConfig[] } {
    return {
      currentModel: this.models[this.currentModelIndex].name,
      models: [...this.models],
    };
  }

  async generateContent(prompt: string): Promise<GeminiResponse> {
    // Wait for rate limiting before making the call
    await this.rateLimiter.waitForRateLimit();

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // Success - reset failure count for current model
        this.models[this.currentModelIndex].failureCount = 0;

        return {
          success: true,
          data: text,
        };
      } catch (error) {
        // Gemini API attempt failed (suppress verbose logging)

        // Check if it's a model blocking error (quota/403/rate limit/etc)
        if (this.isModelBlocked(error)) {
          // Model blocking error detected (suppress verbose logging)

          // Try to switch to next model
          const switched = await this.handleModelFailure();
          if (switched) {
            // Don't count model switch against retry attempts
            attempt--;
            continue;
          } else {
            // All models are blocked, return error
            return {
              success: false,
              error: `All models blocked. Error: ${error}`,
            };
          }
        }

        if (attempt === this.maxRetries) {
          return {
            success: false,
            error: `Failed after ${this.maxRetries} attempts with model ${
              this.models[this.currentModelIndex].name
            }: ${error}`,
          };
        }

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, this.retryDelay * attempt));
      }
    }

    return {
      success: false,
      error: 'Unexpected error in generateContent',
    };
  }

  async extractCoffeeData(prompt: string): Promise<GeminiResponse> {
    const structuredPrompt = `
${prompt}

IMPORTANT INSTRUCTIONS:
1. Only extract information that is explicitly mentioned in the provided text
2. Return your response as a JSON object with the requested fields
3. If information is not available or unclear, use null for that field
4. Be conservative - only fill fields when you are confident about the information
5. For varietals, use common coffee variety names (e.g., "Typica", "Bourbon", "Caturra")
6. For processing methods, use standard terms (e.g., "Washed", "Natural", "Honey", "Semi-washed")
7. For regions, include both country and region when available

Example response format:
{
  "cultivar_detail": "Typica, Bourbon",
  "processing": "Washed",
  "region": "Huila, Colombia",
  "grade": "1,500-1,800 masl",
  "roast_recs": "Medium to medium-dark"
}

Respond only with the JSON object, no additional text.
`;

    const response = await this.generateContent(structuredPrompt);

    if (!response.success) {
      return response;
    }

    try {
      // Clean the response text and parse JSON
      const cleanedResponse = response.data.replace(/```json\n?|\n?```/g, '').trim();
      const parsedData = JSON.parse(cleanedResponse);

      return {
        success: true,
        data: parsedData,
      };
    } catch (parseError) {
      return {
        success: false,
        error: `Failed to parse JSON response: ${parseError}. Raw response: ${response.data}`,
      };
    }
  }

  async generateAiDescription(
    descriptionLong: string | null,
    descriptionShort: string | null,
    farmNotes: string | null
  ): Promise<GeminiResponse> {
    const availableDescriptions = [
      descriptionLong && `Long Description: ${descriptionLong}`,
      descriptionShort && `Short Description: ${descriptionShort}`,
      farmNotes && `Farm Notes: ${farmNotes}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    if (!availableDescriptions) {
      return {
        success: false,
        error: 'No description text available for AI description generation',
      };
    }

    const aiDescriptionPrompt = `
Create a fair-use compliant, factual coffee description of approximately 75 words.

STRICT FAIR-USE REQUIREMENTS:
- Quote NO MORE than 6 consecutive words from the source text
- Use factual, informative data - If using marketing language or superlatives, they MUST be unique from the source text
- Focus on objective information: processing, origin, varietals, elevation, farm history, etc.
- Preserve unique origin stories and farm details when present
- Create transformative content that expresses facts in new language

SOURCE MATERIAL:
""${availableDescriptions}""

Generate a description 75-word or less that captures the essential factual information while respecting fair-use guidelines. Focus on coffee characteristics, processing methods, origin details, and technical specifications.

Respond with only the description text, no additional formatting or explanation.
`;

    const response = await this.generateContent(aiDescriptionPrompt);

    if (!response.success) {
      return response;
    }

    const description = response.data.trim();

    // Validate word count (target ~75 words, allow 20 to 100 range)
    const wordCount = description.split(/\s+/).length;
    if (wordCount < 20 || wordCount > 100) {
      return {
        success: false,
        error: `Generated description has ${wordCount} words, outside acceptable range (30-70 words)`,
      };
    }

    return {
      success: true,
      data: description,
    };
  }

  async generateAiTastingNotes(
    descriptionLong: string | null,
    descriptionShort: string | null,
    cuppingNotes: string | null
  ): Promise<GeminiResponse> {
    const availableDescriptions = [
      descriptionLong && `Long Description: ${descriptionLong}`,
      descriptionShort && `Short Description: ${descriptionShort}`,
      cuppingNotes && `Cupping Notes: ${cuppingNotes}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    if (!availableDescriptions) {
      return {
        success: false,
        error: 'No description text available for AI tasting notes generation',
      };
    }

    const tastingNotesPrompt = `
You are a certified Q-grader.
Read a free-form coffee descriptions and return a tasting profile as _strict_ JSON.
✱ Use **only** the schema below.
✱ Do **not** wrap the JSON in markdown.
✱ Each attribute must have:
• score — integer 1-5
• tag — 1-3 words, lower-case, separated by spaces; can be independent descriptors or phrase descriptors; tags should be creative and unique
• color — hex code (e.g. "#7f4a94") that visually represents the tag; colors should be **vibrant**; you **CANNOT** use bland colors such as gray, brown, tan unless *highly* relevant to the coffee tags

SCALE GUIDE
1 = very weak / defective 2 = weak 3 = moderate 4 = strong 5 = exceptional

ATTRIBUTE EXAMPLES
fragrance_aroma – jasmine (#e5e4e2), cocoa (#4b3621)
flavor – berry (#b3164b), caramel (#c68f53)
acidity – bright (#f4d35e), mellow (#a3c1ad)
body – light (#d7ccc8), syrupy (#5d4037)
sweetness – honey like (#e4b169), brown sugar (#6f4e37)

OUTPUT SCHEMA
{
"fragrance_aroma": { "score": <1-5>, "tag": "<1 to 3 words>", "color": "<#RRGGBB>" },
"flavor": { "score": <1-5>, "tag": "<1 to 3 words>", "color": "<#RRGGBB>" },
"acidity": { "score": <1-5>, "tag": "<1 to 3 words>", "color": "<#RRGGBB>" },
"body": { "score": <1-5>, "tag": "<1 to 3 words>", "color": "<#RRGGBB>" },
"sweetness": { "score": <1-5>, "tag": "<1 to 3 words>", "color": "<#RRGGBB>" }
}

Default rule: if unsure of an output, infer from context or assign score 3 and tag "balanced" with color "#8b5a2b".

FEW-SHOT EXAMPLES:

Example 1:
{
"fragrance_aroma": { "score": 5, "tag": "blueberry jam", "color": "#4f2a57" },
"flavor": { "score": 5, "tag": "cola cherry raspberry", "color": "#b3164b" },
"acidity": { "score": 4, "tag": "lemon lime citrus", "color": "#d0e36c" },
"body": { "score": 3, "tag": "medium", "color": "#d7ccc8" },
"sweetness": { "score": 4, "tag": "honey like syrup", "color": "#e4b169" }
}

Example 2:
{
"fragrance_aroma": { "score": 3, "tag": "peanutty", "color": "#c69c6d" },
"flavor": { "score": 3, "tag": "milk chocolate nougat", "color": "#7b4b2a" },
"acidity": { "score": 2, "tag": "soft short", "color": "#a3c1ad" },
"body": { "score": 4, "tag": "creamy", "color": "#bfa58f" },
"sweetness": { "score": 3, "tag": "brown sugar", "color": "#6f4e37" }
}

SOURCE MATERIAL:
""${availableDescriptions}""

Generate tasting notes following the exact schema above. Return only the JSON object, no additional text.
`;

    const response = await this.generateContent(tastingNotesPrompt);

    if (!response.success) {
      return response;
    }

    try {
      // Clean the response text and parse JSON
      const cleanedResponse = response.data.replace(/```json\n?|\n?```/g, '').trim();
      const parsedData = JSON.parse(cleanedResponse);

      // Sanitize the data to fix common formatting issues
      const sanitizedData = sanitizeTastingNotes(parsedData);

      // Validate the tasting notes structure
      const validationResult = validateTastingNotes(sanitizedData);

      if (!validationResult.success) {
        return {
          success: false,
          error: `Tasting notes validation failed: ${validationResult.errors?.join(', ')}. Raw response: ${
            response.data
          }`,
        };
      }

      return {
        success: true,
        data: validationResult.data,
      };
    } catch (parseError) {
      return {
        success: false,
        error: `Failed to parse tasting notes JSON: ${parseError}. Raw response: ${response.data}`,
      };
    }
  }
}

export default GeminiClient;
