/** @format */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
dotenv.config();

interface CoffeeChunk {
  id: string;
  coffee_id: number;
  chunk_type: 'profile' | 'tasting' | 'origin' | 'commercial' | 'processing';
  content: string;
  metadata: Record<string, any>;
  embedding?: number[];
}

interface CoffeeData {
  id: number;
  name: string;
  score_value?: number;
  arrival_date?: string;
  region?: string;
  processing?: string;
  drying_method?: string;
  roast_recs?: string;
  lot_size?: string;
  bag_size?: string;
  packaging?: string;
  cultivar_detail?: string;
  grade?: string;
  appearance?: string;
  description_short?: string;
  farm_notes?: string;
  type?: string;
  description_long?: string;
  link?: string;
  cost_lb?: number;
  source?: string;
  cupping_notes?: string;
  stocked_date?: string;
  stocked?: boolean;
  ai_description?: string;
  ai_tasting_notes?: any;
}

export class EmbeddingService {
  private openaiApiKey: string;
  private logger: any;
  private supabase: any;

  constructor(logger?: any) {
    this.openaiApiKey = process.env.OPENAI_API_KEY || '';
    this.logger = logger;
    this.supabase = createClient(
      process.env.PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    );

    if (!this.openaiApiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
  }

  private log(step: string, source: string, message: string) {
    if (this.logger) {
      this.logger.addLog(step, source, message);
    } else {
      console.log(`[${step}] ${source}: ${message}`);
    }
  }

  /**
   * Create semantic chunks with metadata for better RAG retrieval
   * Enhanced to include ai_description and ai_tasting_notes
   */
  createSemanticChunks(coffee: CoffeeData): CoffeeChunk[] {
    const chunks: CoffeeChunk[] = [];

    // 1. PROFILE CHUNK - Core identification and quality (SUPPLIER NAME FIRST)
    const profileContent = [
      `${coffee.source} - Coffee: ${coffee.name}`,
      coffee.score_value && `Quality Score: ${coffee.score_value}`,
      coffee.grade && `Grade: ${coffee.grade}`,
      coffee.appearance && `Appearance: ${coffee.appearance}`,
      coffee.type && `Type: ${coffee.type}`,
      coffee.source && `Supplier: ${coffee.source}`,
      coffee.ai_description && `AI Description: ${coffee.ai_description}`,
    ]
      .filter(Boolean)
      .join('. ');

    if (profileContent.length > coffee.name.length + 10) {
      // Only create if has content beyond name
      chunks.push({
        id: `${coffee.id}_profile`,
        coffee_id: coffee.id,
        chunk_type: 'profile',
        content: profileContent,
        metadata: {
          name: coffee.name,
          source: coffee.source,
          score: coffee.score_value,
          grade: coffee.grade,
          stocked: coffee.stocked,
          arrival_date: coffee.arrival_date,
          has_ai_description: !!coffee.ai_description,
        },
      });
    }

    // 2. TASTING CHUNK - Flavor profile and cupping notes (SUPPLIER PROMINENT)
    const tastingContent = [
      coffee.cupping_notes && `Cupping Notes: ${coffee.cupping_notes}`,
      coffee.description_short && `Description: ${coffee.description_short}`,
      coffee.description_long && `Detailed Description: ${coffee.description_long}`,
      coffee.roast_recs && `Roast Recommendations: ${coffee.roast_recs}`,
      coffee.ai_tasting_notes && `AI Tasting Notes: ${this.formatAiTastingNotes(coffee.ai_tasting_notes)}`,
    ]
      .filter(Boolean)
      .join('. ');

    if (tastingContent) {
      chunks.push({
        id: `${coffee.id}_tasting`,
        coffee_id: coffee.id,
        chunk_type: 'tasting',
        content: `${coffee.source} - ${coffee.name} - ${tastingContent}`,
        metadata: {
          name: coffee.name,
          source: coffee.source,
          score: coffee.score_value,
          stocked: coffee.stocked,
          has_cupping_notes: !!coffee.cupping_notes,
          has_roast_recs: !!coffee.roast_recs,
          has_ai_tasting_notes: !!coffee.ai_tasting_notes,
        },
      });
    }

    // 3. ORIGIN CHUNK - Geographic and farm information (SUPPLIER PROMINENT)
    const originContent = [
      coffee.region && `Region: ${coffee.region}`,
      coffee.cultivar_detail && `Variety: ${coffee.cultivar_detail}`,
      coffee.farm_notes && `Farm Notes: ${coffee.farm_notes}`,
      coffee.source && `Source: ${coffee.source}`,
    ]
      .filter(Boolean)
      .join('. ');

    if (originContent) {
      chunks.push({
        id: `${coffee.id}_origin`,
        coffee_id: coffee.id,
        chunk_type: 'origin',
        content: `${coffee.source} - ${coffee.name} - ${originContent}`,
        metadata: {
          name: coffee.name,
          source: coffee.source,
          region: coffee.region,
          cultivar: coffee.cultivar_detail,
          stocked: coffee.stocked,
        },
      });
    }

    // 4. PROCESSING CHUNK - Processing methods and preparation (SUPPLIER PROMINENT)
    const processingContent = [
      coffee.processing && `Processing: ${coffee.processing}`,
      coffee.drying_method && `Drying Method: ${coffee.drying_method}`,
      coffee.packaging && `Packaging: ${coffee.packaging}`,
    ]
      .filter(Boolean)
      .join('. ');

    if (processingContent) {
      chunks.push({
        id: `${coffee.id}_processing`,
        coffee_id: coffee.id,
        chunk_type: 'processing',
        content: `${coffee.source} - ${coffee.name} - ${processingContent}`,
        metadata: {
          name: coffee.name,
          source: coffee.source,
          processing: coffee.processing,
          drying_method: coffee.drying_method,
          stocked: coffee.stocked,
        },
      });
    }

    // 5. COMMERCIAL CHUNK - Pricing and availability (SUPPLIER MOST PROMINENT)
    const commercialContent = [
      coffee.cost_lb && `Cost per lb: $${coffee.cost_lb}`,
      coffee.lot_size && `Lot Size: ${coffee.lot_size}`,
      coffee.bag_size && `Bag Size: ${coffee.bag_size}`,
      coffee.arrival_date && `Arrival Date: ${coffee.arrival_date}`,
      coffee.stocked_date && `Stocked Date: ${coffee.stocked_date}`,
    ]
      .filter(Boolean)
      .join('. ');

    if (commercialContent) {
      chunks.push({
        id: `${coffee.id}_commercial`,
        coffee_id: coffee.id,
        chunk_type: 'commercial',
        content: `${coffee.source} - ${coffee.name} - Supplier: ${coffee.source} - ${commercialContent}`,
        metadata: {
          name: coffee.name,
          source: coffee.source,
          cost_lb: coffee.cost_lb,
          lot_size: coffee.lot_size,
          stocked: coffee.stocked,
          arrival_date: coffee.arrival_date,
        },
      });
    }

    return chunks;
  }

  /**
   * Format AI tasting notes for inclusion in chunk content
   * Each property is an object like: {"tag": "black tea cacao", "color": "#3e2723", "score": 4}
   */
  private formatAiTastingNotes(aiTastingNotes: any): string {
    if (!aiTastingNotes) {
      return '';
    }

    // Parse JSON string if needed
    let parsed = aiTastingNotes;
    if (typeof aiTastingNotes === 'string') {
      try {
        parsed = JSON.parse(aiTastingNotes);
      } catch (error) {
        this.log('Warning', 'EmbeddingService', `Failed to parse ai_tasting_notes JSON: ${error}`);
        return '';
      }
    }

    if (typeof parsed !== 'object' || parsed === null) {
      return '';
    }

    const parts: string[] = [];
    
    // Extract the 'tag' value from each property object
    if (parsed.fragrance_aroma && parsed.fragrance_aroma.tag) {
      parts.push(`Fragrance/Aroma: ${parsed.fragrance_aroma.tag}`);
    }
    if (parsed.flavor && parsed.flavor.tag) {
      parts.push(`Flavor: ${parsed.flavor.tag}`);
    }
    if (parsed.acidity && parsed.acidity.tag) {
      parts.push(`Acidity: ${parsed.acidity.tag}`);
    }
    if (parsed.body && parsed.body.tag) {
      parts.push(`Body: ${parsed.body.tag}`);
    }
    if (parsed.sweetness && parsed.sweetness.tag) {
      parts.push(`Sweetness: ${parsed.sweetness.tag}`);
    }

    return parts.join(', ');
  }

  /**
   * Generate embeddings for all chunks with rate limiting
   */
  async generateChunkEmbeddings(chunks: CoffeeChunk[]): Promise<CoffeeChunk[]> {
    const chunksWithEmbeddings: CoffeeChunk[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      try {
        const embedding = await this.generateEmbedding(chunk.content);
        chunksWithEmbeddings.push({
          ...chunk,
          embedding,
        });

        // Rate limiting - wait 500ms between requests to avoid API limits
        if (i < chunks.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (error) {
        this.log('Error', 'EmbeddingService', `Failed to generate embedding for chunk ${chunk.id}: ${error}`);
        // Continue with other chunks even if one fails
      }
    }

    return chunksWithEmbeddings;
  }

  /**
   * Generate embedding for text using OpenAI API with retry logic
   */
  private async generateEmbedding(text: string, retryCount: number = 0): Promise<number[]> {
    const maxRetries = 3;
    const baseDelay = 1000; // 1 second base delay
    
    try {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: text,
          model: 'text-embedding-3-small',
        }),
      });

      if (!response.ok) {
        // Check if it's a retryable error
        if ((response.status === 502 || response.status === 503 || response.status === 429) && retryCount < maxRetries) {
          const delay = baseDelay * Math.pow(2, retryCount); // Exponential backoff
          this.log('Warning', 'EmbeddingService', `API error ${response.status}, retrying in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.generateEmbedding(text, retryCount + 1);
        }
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.data[0].embedding;
    } catch (error) {
      if (retryCount < maxRetries && (error instanceof Error && error.message.includes('fetch'))) {
        const delay = baseDelay * Math.pow(2, retryCount);
        this.log('Warning', 'EmbeddingService', `Network error, retrying in ${delay}ms (attempt ${retryCount + 1}/${maxRetries}): ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.generateEmbedding(text, retryCount + 1);
      }
      throw error;
    }
  }

  /**
   * Process a single coffee and store its embeddings
   */
  async processCoffeeEmbeddings(coffee: CoffeeData): Promise<{ success: boolean; chunksProcessed: number }> {
    try {
      // Create semantic chunks
      const chunks = this.createSemanticChunks(coffee);

      if (chunks.length === 0) {
        this.log('Warning', 'EmbeddingService', `No meaningful chunks created for ${coffee.name}`);
        return { success: false, chunksProcessed: 0 };
      }

      // Generate embeddings for chunks
      const chunksWithEmbeddings = await this.generateChunkEmbeddings(chunks);

      if (chunksWithEmbeddings.length === 0) {
        this.log('Error', 'EmbeddingService', `Failed to generate embeddings for ${coffee.name}`);
        return { success: false, chunksProcessed: 0 };
      }

      // Insert chunks into database
      const { error: insertError } = await this.supabase.from('coffee_chunks').insert(
        chunksWithEmbeddings.map((chunk) => ({
          id: chunk.id,
          coffee_id: chunk.coffee_id,
          chunk_type: chunk.chunk_type,
          content: chunk.content,
          metadata: chunk.metadata,
          embedding: chunk.embedding,
        }))
      );

      if (insertError) {
        this.log('Error', 'EmbeddingService', `Failed to insert chunks for ${coffee.name}: ${insertError.message}`);
        return { success: false, chunksProcessed: 0 };
      }

      this.log('Step 7: Embedding Generation', coffee.source || 'unknown', `✓ Processed ${coffee.name}: ${chunksWithEmbeddings.length} chunks`);
      return { success: true, chunksProcessed: chunksWithEmbeddings.length };
    } catch (error) {
      this.log('Error', 'EmbeddingService', `Error processing ${coffee.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { success: false, chunksProcessed: 0 };
    }
  }

  /**
   * Bulk process multiple coffees for embeddings
   */
  async processBulkEmbeddings(coffees: CoffeeData[], forceRegenerate: boolean = false): Promise<{
    success: boolean;
    processed: number;
    totalChunks: number;
    errors: string[];
  }> {
    let processedCoffees = 0;
    let totalChunks = 0;
    const errors: string[] = [];

    for (const coffee of coffees) {
      try {
        // Check if chunks already exist (unless force regenerating)
        if (!forceRegenerate) {
          const { data: existingChunks } = await this.supabase
            .from('coffee_chunks')
            .select('id')
            .eq('coffee_id', coffee.id)
            .limit(1);

          if (existingChunks && existingChunks.length > 0) {
            this.log('Info', 'EmbeddingService', `Skipping ${coffee.name} - chunks already exist`);
            continue;
          }
        } else {
          // Delete existing chunks if force regenerating
          await this.supabase.from('coffee_chunks').delete().eq('coffee_id', coffee.id);
        }

        const result = await this.processCoffeeEmbeddings(coffee);
        
        if (result.success) {
          processedCoffees++;
          totalChunks += result.chunksProcessed;
        } else {
          errors.push(`Failed to process ${coffee.name}`);
        }
      } catch (error) {
        const errorMsg = `Error processing ${coffee.name}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        errors.push(errorMsg);
        this.log('Error', 'EmbeddingService', errorMsg);
      }
    }

    return {
      success: true,
      processed: processedCoffees,
      totalChunks,
      errors,
    };
  }
}