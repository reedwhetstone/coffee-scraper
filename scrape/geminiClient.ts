/** @format */

import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

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

      console.log(`Rate limit reached. Waiting ${Math.ceil(waitTime / 1000)} seconds...`);
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
        console.log(`Enforcing minimum delay. Waiting ${Math.ceil(delayTime / 1000)} seconds...`);
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
    console.log('Rate limit error detected. Waiting 60 seconds before retry...');
    await new Promise((resolve) => setTimeout(resolve, 60000));
    // Clear timestamps to reset tracking
    this.callTimestamps = [];
  }
}

export class GeminiClient {
  private genAI: GoogleGenerativeAI;
  private model: any;
  private readonly maxRetries = 2;
  private readonly retryDelay = 1000; // 1 second
  private rateLimiter = new RateLimiter();

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }

    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash-preview-04-17' });
  }

  async generateContent(prompt: string): Promise<GeminiResponse> {
    // Wait for rate limiting before making the call
    await this.rateLimiter.waitForRateLimit();

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        return {
          success: true,
          data: text,
        };
      } catch (error) {
        console.error(`Gemini API attempt ${attempt} failed:`, error);

        // Check if it's a rate limit error
        if (this.rateLimiter.isRateLimitError(error)) {
          await this.rateLimiter.handleRateLimitError();
          // Don't count rate limit errors against retry attempts
          attempt--;
          continue;
        }

        if (attempt === this.maxRetries) {
          return {
            success: false,
            error: `Failed after ${this.maxRetries} attempts: ${error}`,
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
Create a fair-use compliant, factual coffee description of approximately 50 words.

STRICT FAIR-USE REQUIREMENTS:
- Quote NO MORE than 6 consecutive words from the source text
- Use factual, informative tone - NO marketing language or superlatives
- Focus on objective information: processing, origin, varietals, elevation, flavor notes
- Preserve unique origin stories and farm details when present
- Create transformative content that expresses facts in new language

SOURCE MATERIAL:
""${availableDescriptions}""

Generate a 50-word description that captures the essential factual information while respecting fair-use guidelines. Focus on coffee characteristics, processing methods, origin details, and technical specifications.

Respond with only the description text, no additional formatting or explanation.
`;

    const response = await this.generateContent(aiDescriptionPrompt);

    if (!response.success) {
      return response;
    }

    const description = response.data.trim();

    // Validate word count (target ~50 words, allow 40-60 range)
    const wordCount = description.split(/\s+/).length;
    if (wordCount < 30 || wordCount > 70) {
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
}

export default GeminiClient;
