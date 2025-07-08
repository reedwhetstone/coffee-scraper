/** @format */

import { EmbeddingService } from './embeddingService.js';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabase = createClient(process.env.PUBLIC_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

interface GenerateEmbeddingsOptions {
  source?: string;
  forceRegenerate?: boolean;
  limit?: number;
  coffeeId?: number;
}

class EmbeddingGenerator {
  private embeddingService: EmbeddingService;

  constructor() {
    this.embeddingService = new EmbeddingService();
  }

  async generateEmbeddings(options: GenerateEmbeddingsOptions = {}) {
    const { source, forceRegenerate = false, limit, coffeeId } = options;

    console.log('🚀 Starting embedding generation...');
    console.log('Options:', { source, forceRegenerate, limit, coffeeId });

    try {
      // Build query
      let query = supabase.from('coffee_catalog').select('*');

      // Filter by source if specified
      if (source) {
        query = query.eq('source', source);
      }

      // Filter by specific coffee ID if specified
      if (coffeeId) {
        query = query.eq('id', coffeeId);
      }

      // Limit results if specified
      if (limit) {
        query = query.limit(limit);
      }

      const { data: coffees, error: fetchError } = await query;

      if (fetchError) {
        throw new Error(`Failed to fetch coffees: ${fetchError.message}`);
      }

      if (!coffees || coffees.length === 0) {
        console.log('❌ No coffees found matching criteria');
        return;
      }

      console.log(`📊 Found ${coffees.length} coffees to process`);

      // Process embeddings - let the embedding service handle existing check
      console.log(`🔄 Processing ${coffees.length} coffees...`);
      const startTime = Date.now();

      const result = await this.embeddingService.processBulkEmbeddings(coffees, forceRegenerate);

      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);

      // Results
      console.log('\n📈 Results:');
      console.log(`✅ Successfully processed: ${result.processed} coffees`);
      console.log(`📦 Total chunks created: ${result.totalChunks}`);
      console.log(`⏱️  Duration: ${duration} seconds`);

      if (result.errors.length > 0) {
        console.log(`❌ Errors: ${result.errors.length}`);
        result.errors.forEach((error, index) => {
          console.log(`   ${index + 1}. ${error}`);
        });
      }

      // Calculate stats
      const avgChunksPerCoffee = result.processed > 0 ? (result.totalChunks / result.processed).toFixed(1) : '0';
      const coffeesPerSecond = result.processed > 0 ? (result.processed / parseFloat(duration)).toFixed(2) : '0';
      
      console.log(`\n📊 Stats:`);
      console.log(`   Average chunks per coffee: ${avgChunksPerCoffee}`);
      console.log(`   Processing rate: ${coffeesPerSecond} coffees/second`);

      if (result.totalChunks > 0) {
        console.log(`\n🎯 Successfully generated embeddings for ${result.processed} coffees!`);
      } else {
        console.log(`\n⚠️  No embeddings were generated. Check the logs for errors.`);
      }

    } catch (error) {
      console.error('💥 Fatal error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  }

  async checkEmbeddingStatus() {
    console.log('🔍 Checking embedding status...');

    try {
      // Get total coffee count
      const { data: allCoffees, error: coffeeError } = await supabase
        .from('coffee_catalog')
        .select('id, name, source, stocked');

      if (coffeeError) {
        throw new Error(`Failed to fetch coffees: ${coffeeError.message}`);
      }

      // Get embedding count
      const { data: chunks, error: chunkError } = await supabase
        .from('coffee_chunks')
        .select('coffee_id, chunk_type');

      if (chunkError) {
        throw new Error(`Failed to fetch chunks: ${chunkError.message}`);
      }

      const totalCoffees = allCoffees?.length || 0;
      const stockedCoffees = allCoffees?.filter(c => c.stocked).length || 0;
      const coffeesWithEmbeddings = new Set(chunks?.map(c => c.coffee_id) || []).size;
      const totalChunks = chunks?.length || 0;

      console.log('\n📊 Embedding Status:');
      console.log(`   Total coffees: ${totalCoffees}`);
      console.log(`   Stocked coffees: ${stockedCoffees}`);
      console.log(`   Coffees with embeddings: ${coffeesWithEmbeddings}`);
      console.log(`   Total chunks: ${totalChunks}`);
      console.log(`   Coverage: ${totalCoffees > 0 ? ((coffeesWithEmbeddings / totalCoffees) * 100).toFixed(1) : 0}%`);

      // Break down by source
      const sourceBreakdown: Record<string, { total: number; withEmbeddings: number }> = {};
      const coffeesWithEmbeddingIds = new Set(chunks?.map(c => c.coffee_id) || []);

      allCoffees?.forEach(coffee => {
        if (!sourceBreakdown[coffee.source]) {
          sourceBreakdown[coffee.source] = { total: 0, withEmbeddings: 0 };
        }
        sourceBreakdown[coffee.source].total++;
        if (coffeesWithEmbeddingIds.has(coffee.id)) {
          sourceBreakdown[coffee.source].withEmbeddings++;
        }
      });

      console.log('\n📋 By Source:');
      Object.entries(sourceBreakdown).forEach(([source, stats]) => {
        const percentage = stats.total > 0 ? ((stats.withEmbeddings / stats.total) * 100).toFixed(1) : '0';
        console.log(`   ${source}: ${stats.withEmbeddings}/${stats.total} (${percentage}%)`);
      });

    } catch (error) {
      console.error('💥 Error checking status:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  }
}

// Command line interface
async function main() {
  const args = process.argv.slice(2);
  const generator = new EmbeddingGenerator();

  if (args.length === 0) {
    console.log('📖 Usage:');
    console.log('  tsx generateEmbeddings.ts [command] [options]');
    console.log('');
    console.log('Commands:');
    console.log('  status                          - Check embedding status');
    console.log('  generate [options]              - Generate embeddings');
    console.log('');
    console.log('Generate Options:');
    console.log('  --source <name>                 - Filter by source (e.g., Sweet Marias)');
    console.log('  --force                         - Force regenerate existing embeddings');
    console.log('  --limit <number>                - Limit number of coffees to process');
    console.log('  --coffee-id <id>                - Process specific coffee by ID');
    console.log('');
    console.log('Examples:');
    console.log('  tsx generateEmbeddings.ts status');
    console.log('  tsx generateEmbeddings.ts generate');
    console.log('  tsx generateEmbeddings.ts generate --source "Sweet Marias"');
    console.log('  tsx generateEmbeddings.ts generate --force --limit 10');
    console.log('  tsx generateEmbeddings.ts generate --coffee-id 123');
    process.exit(0);
  }

  const command = args[0];

  if (command === 'status') {
    await generator.checkEmbeddingStatus();
  } else if (command === 'generate') {
    const options: GenerateEmbeddingsOptions = {};

    // Parse options
    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      
      if (arg === '--source' && i + 1 < args.length) {
        options.source = args[i + 1];
        i++;
      } else if (arg === '--force') {
        options.forceRegenerate = true;
      } else if (arg === '--limit' && i + 1 < args.length) {
        options.limit = parseInt(args[i + 1]);
        i++;
      } else if (arg === '--coffee-id' && i + 1 < args.length) {
        options.coffeeId = parseInt(args[i + 1]);
        i++;
      }
    }

    await generator.generateEmbeddings(options);
  } else {
    console.error(`❌ Unknown command: ${command}`);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
}