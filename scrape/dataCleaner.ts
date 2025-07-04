/** @format */

import GeminiClient from './geminiClient.js';
import { createCleaningPrompt, CLEANING_FIELD_CONFIGS } from './cleaningPrompts.js';

export interface ScrapedDataForCleaning {
  productName: string | null;
  url: string;
  scoreValue: number | null;
  descriptionShort: string | null;
  descriptionLong: string | null;
  farmNotes: string | null;
  cost_lb: number | null;
  arrivalDate: string | null;
  region: string | null;
  processing: string | null;
  dryingMethod: string | null;
  lotSize: string | null;
  bagSize: string | null;
  packaging: string | null;
  cultivarDetail: string | null;
  grade: string | null;
  appearance: string | null;
  roastRecs: string | null;
  type: string | null;
  cuppingNotes: string | null;
  aiDescription?: string | null;
  aiTastingNotes?: any; // JSON object for tasting notes
  [key: string]: any;
}

export interface CleaningResult {
  originalData: ScrapedDataForCleaning;
  cleanedData: ScrapedDataForCleaning;
  fieldsProcessed: string[];
  errors: string[];
}

export class DataCleaner {
  private geminiClient: GeminiClient;
  private logger: any;

  constructor(logger?: any) {
    this.geminiClient = new GeminiClient();
    this.logger = logger;
  }

  private log(step: string, source: string, message: string) {
    if (this.logger) {
      this.logger.addLog(step, source, message);
    } else {
      console.log(`[${source}] ${message}`);
    }
  }

  private isNullOrEmpty(value: any): boolean {
    return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
  }

  private hasAvailableDescriptions(data: ScrapedDataForCleaning): boolean {
    return (
      !this.isNullOrEmpty(data.descriptionLong) ||
      !this.isNullOrEmpty(data.descriptionShort) ||
      !this.isNullOrEmpty(data.farmNotes)
    );
  }

  private hasAvailableTastingData(data: ScrapedDataForCleaning): boolean {
    return (
      !this.isNullOrEmpty(data.descriptionLong) ||
      !this.isNullOrEmpty(data.descriptionShort) ||
      !this.isNullOrEmpty(data.cuppingNotes)
    );
  }

  async cleanData(data: ScrapedDataForCleaning, sourceName: string): Promise<CleaningResult> {
    const result: CleaningResult = {
      originalData: { ...data },
      cleanedData: { ...data },
      fieldsProcessed: [],
      errors: [],
    };

    // Check if we have any description text to work with
    if (!this.hasAvailableDescriptions(data)) {
      this.log('Data Cleaning', sourceName, 'No description text available for cleaning');
      return result;
    }

    // Find NULL fields that can be cleaned
    const nullFields = CLEANING_FIELD_CONFIGS.map((config) => config.field).filter((field) =>
      this.isNullOrEmpty(data[field])
    );

    if (nullFields.length === 0) {
      this.log('Data Cleaning', sourceName, 'No NULL fields found that can be cleaned');
      return result;
    }

    this.log(
      'Data Cleaning',
      sourceName,
      `Found ${nullFields.length} NULL fields to process: ${nullFields.join(', ')}`
    );

    // Process each NULL field
    for (const fieldName of nullFields) {
      try {
        const cleanedValue = await this.cleanField(
          fieldName,
          data.descriptionLong,
          data.descriptionShort,
          data.farmNotes,
          sourceName
        );

        if (cleanedValue !== null) {
          result.cleanedData[fieldName] = cleanedValue;
          result.fieldsProcessed.push(fieldName);
          this.log('Data Cleaning', sourceName, `Successfully cleaned field "${fieldName}": ${cleanedValue}`);
        } else {
          this.log('Data Cleaning', sourceName, `No data found for field "${fieldName}"`);
        }
      } catch (error) {
        const errorMsg = `Failed to clean field "${fieldName}": ${error}`;
        result.errors.push(errorMsg);
        this.log('Error', sourceName, errorMsg);
      }

      // Add a small delay between API calls to be respectful
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    this.log(
      'Data Cleaning',
      sourceName,
      `Cleaning complete. Processed ${result.fieldsProcessed.length} fields, ${result.errors.length} errors`
    );
    return result;
  }

  private async cleanField(
    fieldName: string,
    descriptionLong: string | null,
    descriptionShort: string | null,
    farmNotes: string | null,
    sourceName: string
  ): Promise<string | null> {
    try {
      const prompt = createCleaningPrompt(fieldName, descriptionLong, descriptionShort, farmNotes);

      this.log('Data Cleaning', sourceName, `Processing field "${fieldName}" with Gemini API`);

      const response = await this.geminiClient.extractCoffeeData(prompt);

      if (!response.success) {
        throw new Error(response.error || 'Unknown API error');
      }

      const extractedData = response.data;
      const value = extractedData[fieldName];

      // Validate the extracted value
      if (this.isNullOrEmpty(value)) {
        return null;
      }

      // Apply field-specific validation if available
      const config = CLEANING_FIELD_CONFIGS.find((c) => c.field === fieldName);
      if (config?.validation && !config.validation(value)) {
        this.log('Warning', sourceName, `Validation failed for field "${fieldName}" with value: ${value}`);
        return null;
      }

      return String(value).trim();
    } catch (error) {
      throw new Error(`Field cleaning failed: ${error}`);
    }
  }

  // Batch cleaning method for multiple fields at once (more efficient for API calls)
  async batchCleanFields(
    data: ScrapedDataForCleaning,
    sourceName: string,
    fieldsToClean?: string[]
  ): Promise<CleaningResult> {
    const result: CleaningResult = {
      originalData: { ...data },
      cleanedData: { ...data },
      fieldsProcessed: [],
      errors: [],
    };

    if (!this.hasAvailableDescriptions(data)) {
      this.log('Data Cleaning', sourceName, 'No description text available for batch cleaning');
      return result;
    }

    const targetFields = fieldsToClean || CLEANING_FIELD_CONFIGS.map((config) => config.field);
    const nullFields = targetFields.filter((field) => this.isNullOrEmpty(data[field]));

    if (nullFields.length === 0) {
      this.log('Data Cleaning', sourceName, 'No NULL fields found for batch cleaning');
      // Skip cleaning API call but continue to AI generation
    } else {
      try {
        const batchPrompt = this.createBatchPrompt(
          nullFields,
          data.descriptionLong,
          data.descriptionShort,
          data.farmNotes
        );

        this.log('Data Cleaning', sourceName, `Batch processing ${nullFields.length} fields: ${nullFields.join(', ')}`);

        const response = await this.geminiClient.extractCoffeeData(batchPrompt);

        if (!response.success) {
          throw new Error(response.error || 'Batch processing failed');
        }

        const extractedData = response.data;

        // Process each field from the batch response
        for (const fieldName of nullFields) {
          const value = extractedData[fieldName];

          if (!this.isNullOrEmpty(value)) {
            // Apply field-specific validation
            const config = CLEANING_FIELD_CONFIGS.find((c) => c.field === fieldName);
            if (!config?.validation || config.validation(value)) {
              result.cleanedData[fieldName] = String(value).trim();
              result.fieldsProcessed.push(fieldName);
              this.log('Data Cleaning', sourceName, `Batch cleaned field "${fieldName}": ${value}`);
            } else {
              this.log('Warning', sourceName, `Batch validation failed for field "${fieldName}": ${value}`);
            }
          }
        }

        this.log(
          'Data Cleaning',
          sourceName,
          `Batch cleaning complete. Processed ${result.fieldsProcessed.length} fields`
        );
      } catch (error) {
        const errorMsg = `Batch cleaning failed: ${error}`;
        result.errors.push(errorMsg);
        this.log('Error', sourceName, errorMsg);
      }
    }

    // Generate AI description after field cleaning (runs regardless of NULL fields)
    try {
      const aiDescription = await this.generateAiDescription(result.cleanedData, sourceName);
      if (aiDescription) {
        result.cleanedData.aiDescription = aiDescription;
        result.fieldsProcessed.push('aiDescription');
      }
    } catch (error) {
      const errorMsg = `AI description generation failed: ${error}`;
      result.errors.push(errorMsg);
      this.log('Error', sourceName, errorMsg);
    }

    // Generate AI tasting notes after field cleaning (runs regardless of NULL fields)
    try {
      const aiTastingNotes = await this.generateAiTastingNotes(result.cleanedData, sourceName);
      if (aiTastingNotes) {
        result.cleanedData.aiTastingNotes = aiTastingNotes;
        result.fieldsProcessed.push('aiTastingNotes');
      }
    } catch (error) {
      const errorMsg = `AI tasting notes generation failed: ${error}`;
      result.errors.push(errorMsg);
      this.log('Error', sourceName, errorMsg);
    }

    return result;
  }
  private createBatchPrompt(
    fields: string[],
    descriptionLong: string | null,
    descriptionShort: string | null,
    farmNotes: string | null
  ): string {
    const availableDescriptions = [
      descriptionLong && `Long Description: ${descriptionLong}`,
      descriptionShort && `Short Description: ${descriptionShort}`,
      farmNotes && `Farm Notes: ${farmNotes}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const fieldDescriptions = fields
      .map((field) => {
        const config = CLEANING_FIELD_CONFIGS.find((c) => c.field === field);
        return `- ${field}: ${config?.prompt || 'Extract relevant information'}`;
      })
      .join('\n');

    return `Extract the following coffee information fields from the provided descriptions:

${fieldDescriptions}

Available coffee information:
${availableDescriptions}

Return a JSON object with the requested fields. Use null for any field where information is not clearly available.`;
  }

  async generateAiDescription(data: ScrapedDataForCleaning, sourceName: string): Promise<string | null> {
    if (!this.hasAvailableDescriptions(data)) {
      this.log('AI Description', sourceName, 'No description text available for AI description generation');
      return null;
    }

    try {
      this.log('AI Description', sourceName, 'Generating AI description with Gemini API');

      const response = await this.geminiClient.generateAiDescription(
        data.descriptionLong,
        data.descriptionShort,
        data.farmNotes
      );

      if (!response.success) {
        this.log('Warning', sourceName, `AI description generation failed: ${response.error}`);
        return null;
      }

      const description = response.data;
      const wordCount = description.split(/\s+/).length;

      this.log(
        'AI Description',
        sourceName,
        `Successfully generated AI description (${wordCount} words): ${description.substring(0, 100)}${
          description.length > 100 ? '...' : ''
        }`
      );

      return description;
    } catch (error) {
      this.log('Error', sourceName, `AI description generation error: ${error}`);
      return null;
    }
  }

  async generateAiTastingNotes(data: ScrapedDataForCleaning, sourceName: string): Promise<any | null> {
    if (!this.hasAvailableTastingData(data)) {
      this.log('AI Tasting Notes', sourceName, 'No tasting data available for AI tasting notes generation');
      return null;
    }

    try {
      this.log('AI Tasting Notes', sourceName, 'Generating AI tasting notes with Gemini API');

      const response = await this.geminiClient.generateAiTastingNotes(
        data.descriptionLong,
        data.descriptionShort,
        data.cuppingNotes
      );

      if (!response.success) {
        this.log('Warning', sourceName, `AI tasting notes generation failed: ${response.error}`);
        return null;
      }

      const tastingNotes = response.data;

      this.log(
        'AI Tasting Notes',
        sourceName,
        `Successfully generated AI tasting notes: ${JSON.stringify(tastingNotes).substring(0, 150)}...`
      );

      return tastingNotes;
    } catch (error) {
      this.log('Error', sourceName, `AI tasting notes generation error: ${error}`);
      return null;
    }
  }
}

export default DataCleaner;
