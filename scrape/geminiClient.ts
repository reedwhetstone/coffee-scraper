/** @format */

import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

export interface GeminiResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export class GeminiClient {
  private genAI: GoogleGenerativeAI;
  private model: any;
  private readonly maxRetries = 2;
  private readonly retryDelay = 1000; // 1 second

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }

    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  }

  async generateContent(prompt: string): Promise<GeminiResponse> {
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
}

export default GeminiClient;
