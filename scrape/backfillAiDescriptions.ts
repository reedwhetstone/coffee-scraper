/** @format */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import GeminiClient from './geminiClient.js';

dotenv.config();

const supabase = createClient(
  process.env.PUBLIC_SUPABASE_URL || '', 
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface CoffeeRecord {
  id: number;
  name: string;
  description_long: string | null;
  description_short: string | null;
  farm_notes: string | null;
  source: string;
}

class AiDescriptionBackfill {
  private geminiClient: GeminiClient;
  private processedCount = 0;
  private successCount = 0;
  private errorCount = 0;
  private startTime = Date.now();

  constructor() {
    this.geminiClient = new GeminiClient();
  }

  private log(message: string) {
    const elapsed = Math.round((Date.now() - this.startTime) / 1000);
    console.log(`[${elapsed}s] ${message}`);
  }

  private logProgress() {
    const elapsed = Math.round((Date.now() - this.startTime) / 1000);
    const rate = this.processedCount > 0 ? Math.round((this.processedCount / elapsed) * 60) : 0;
    const modelStatus = this.geminiClient.getModelStatus();
    console.log(`Progress: ${this.processedCount} processed, ${this.successCount} success, ${this.errorCount} errors (${rate}/min) - Model: ${modelStatus.currentModel}`);
  }

  async fetchRecordsNeedingAiDescription(): Promise<CoffeeRecord[]> {
    this.log('Fetching records where stocked=true and ai_description is null...');
    
    const { data, error } = await supabase
      .from('coffee_catalog')
      .select('id, name, description_long, description_short, farm_notes, source')
      .eq('stocked', true)
      .is('ai_description', null)
      .order('id');

    if (error) {
      throw new Error(`Failed to fetch records: ${error.message}`);
    }

    this.log(`Found ${data?.length || 0} records needing AI descriptions`);
    return data || [];
  }

  async processRecord(record: CoffeeRecord): Promise<boolean> {
    this.processedCount++;
    
    try {
      this.log(`Processing [${this.processedCount}] ${record.name} (${record.source})`);
      
      // Check if we have description data to work with
      if (!record.description_long && !record.description_short && !record.farm_notes) {
        this.log(`  Skipping - no description data available`);
        this.errorCount++;
        return false;
      }

      // Generate AI description
      const response = await this.geminiClient.generateAiDescription(
        record.description_long,
        record.description_short,
        record.farm_notes
      );

      if (!response.success) {
        this.log(`  Error generating AI description: ${response.error}`);
        this.errorCount++;
        return false;
      }

      const aiDescription = response.data;
      const wordCount = aiDescription.split(/\s+/).length;

      // Update the database
      const { error: updateError } = await supabase
        .from('coffee_catalog')
        .update({ 
          ai_description: aiDescription,
          last_updated: new Date().toISOString()
        })
        .eq('id', record.id);

      if (updateError) {
        this.log(`  Database update error: ${updateError.message}`);
        this.errorCount++;
        return false;
      }

      this.log(`  Success - Generated ${wordCount} word description: ${aiDescription.substring(0, 80)}...`);
      this.successCount++;
      return true;

    } catch (error) {
      this.log(`  Unexpected error: ${error}`);
      this.errorCount++;
      return false;
    }
  }

  async run(): Promise<void> {
    try {
      this.log('Starting AI description backfill process...');
      
      const records = await this.fetchRecordsNeedingAiDescription();
      
      if (records.length === 0) {
        this.log('No records need AI descriptions. Exiting.');
        return;
      }

      this.log(`Starting processing of ${records.length} records...`);
      this.log('Rate limiting: 10 calls/minute with 6+ second delays between calls');
      
      // Process records one by one with rate limiting
      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        
        await this.processRecord(record);
        
        // Log progress every 5 records
        if (this.processedCount % 5 === 0) {
          this.logProgress();
        }

        // Rate limiting is handled by the GeminiClient
        // No additional delays needed here
      }

      // Final summary
      const totalTime = Math.round((Date.now() - this.startTime) / 1000);
      const avgTimePerRecord = totalTime / this.processedCount;
      
      this.log('\n=== BACKFILL COMPLETE ===');
      this.log(`Total time: ${totalTime} seconds`);
      this.log(`Records processed: ${this.processedCount}`);
      this.log(`Successful: ${this.successCount}`);
      this.log(`Errors: ${this.errorCount}`);
      this.log(`Success rate: ${((this.successCount / this.processedCount) * 100).toFixed(1)}%`);
      this.log(`Average time per record: ${avgTimePerRecord.toFixed(1)} seconds`);

    } catch (error) {
      this.log(`Fatal error: ${error}`);
      throw error;
    }
  }
}

// Run the backfill if this script is executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  const backfill = new AiDescriptionBackfill();
  
  backfill.run()
    .then(() => {
      console.log('Backfill completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Backfill failed:', error);
      process.exit(1);
    });
}

export default AiDescriptionBackfill;