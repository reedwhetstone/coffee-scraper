/** @format */

import path from 'path';

//npm run scrape all
// npm run scrape sweet_maria
// npm run scrape captain_coffee
// npm run scrape bodhi_leaf

import { chromium } from 'playwright-extra';
import { Page } from 'playwright';
import stealth from 'puppeteer-extra-plugin-stealth';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import DataCleaner from './dataCleaner.js';
import { EmbeddingService } from './embeddingService.js';

// Use the stealth plugin
chromium.use(stealth());

// Load environment variables
dotenv.config();

const supabase = createClient(process.env.PUBLIC_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

interface ScrapedData {
  productName: string | null;
  url: string;
  scoreValue: number | null;
  [key: string]: any; // This allows for dynamic string keys
}

interface ProductData {
  url: string;
  price: number | null;
  available?: boolean; // Add this optional field
}

// Add new interfaces for source-specific implementations
interface CoffeeSource {
  name: string;
  collectInitUrlsData(): Promise<ProductData[]>;
  scrapeUrl(url: string, price: number | null): Promise<ScrapedData | null>;
  baseUrl: string;
}

// Add this after the interface definitions
// Logger to collect logs during execution
class LogCollector {
  private logs: Record<string, Record<string, string[]>> = {};
  private summaryData: Record<string, { 
    productsFound: number; 
    newProducts: number; 
    updatedProducts: number; 
    errors: string[]; 
    warnings: string[];
    success: boolean;
    embeddingGenerated: number;
    embeddingChunks: number;
    embeddingsCleaned: number;
    chunksRemoved: number;
    aiDescriptionsGenerated: number;
    aiTastingNotesGenerated: number;
  }> = {};
  
  // Global summary stats across all sources
  private globalSummary = {
    totalEmbeddingGenerated: 0,
    totalEmbeddingChunks: 0,
    totalEmbeddingsCleaned: 0,
    totalChunksRemoved: 0,
    totalAiDescriptionsGenerated: 0,
    totalAiTastingNotesGenerated: 0,
    sourcesProcessed: 0,
    sourcesSuccessful: 0,
  };

  // Add a log entry for a specific step and source
  addLog(step: string, source: string, message: string) {
    if (!this.logs[step]) {
      this.logs[step] = {};
    }
    if (!this.logs[step][source]) {
      this.logs[step][source] = [];
    }

    this.logs[step][source].push(message);

    // Initialize summary data if not exists
    if (!this.summaryData[source]) {
      this.summaryData[source] = {
        productsFound: 0,
        newProducts: 0,
        updatedProducts: 0,
        errors: [],
        warnings: [],
        success: false,
        embeddingGenerated: 0,
        embeddingChunks: 0,
        embeddingsCleaned: 0,
        chunksRemoved: 0,
        aiDescriptionsGenerated: 0,
        aiTastingNotesGenerated: 0,
      };
    }

    // Extract key metrics from messages
    if (message.includes('Found') && message.includes('total products')) {
      const match = message.match(/Found (\d+) total products/);
      if (match) this.summaryData[source].productsFound = parseInt(match[1]);
    }
    
    if (message.includes('Added') && message.includes('new products')) {
      const match = message.match(/Added (\d+) new products/);
      if (match) this.summaryData[source].newProducts = parseInt(match[1]);
    }

    if (message.includes('Updating prices for') && message.includes('in-stock items')) {
      const match = message.match(/Updating prices for (\d+) in-stock items/);
      if (match) this.summaryData[source].updatedProducts = parseInt(match[1]);
    }

    if (step === 'Error' || message.toLowerCase().includes('error')) {
      this.summaryData[source].errors.push(message);
    }
    
    if (step === 'Warning' || message.toLowerCase().includes('warning')) {
      this.summaryData[source].warnings.push(message);
    }

    if (message.includes('completed successfully') || message.includes('Completed successfully')) {
      this.summaryData[source].success = true;
    }

    // Track embedding generation
    if (message.includes('Successfully generated embeddings for') && message.includes('products')) {
      const match = message.match(/Successfully generated embeddings for (\d+) products \((\d+) chunks\)/);
      if (match) {
        this.summaryData[source].embeddingGenerated = parseInt(match[1]);
        this.summaryData[source].embeddingChunks = parseInt(match[2]);
      }
    }

    // Track embedding cleanup
    if (message.includes('Cleaned up') && message.includes('chunks for') && message.includes('unstocked coffees')) {
      const match = message.match(/Cleaned up (\d+) chunks for (\d+) unstocked coffees/);
      if (match) {
        this.summaryData[source].chunksRemoved = parseInt(match[1]);
        this.summaryData[source].embeddingsCleaned = parseInt(match[2]);
      }
    }

    // Track AI descriptions
    if (message.includes('AI descriptions generated for') && message.includes('products')) {
      const match = message.match(/AI descriptions generated for (\d+) products/);
      if (match) {
        this.summaryData[source].aiDescriptionsGenerated = parseInt(match[1]);
      }
    }

    // Track AI tasting notes
    if (message.includes('AI tasting notes generated for') && message.includes('products')) {
      const match = message.match(/AI tasting notes generated for (\d+) products/);
      if (match) {
        this.summaryData[source].aiTastingNotesGenerated = parseInt(match[1]);
      }
    }

    // Only print errors and warnings to console during execution
    if (step === 'Error' || step === 'Warning') {
      console.log(`[${source}] ${step}: ${message}`);
    }
  }

  // Print simplified summary
  printConsolidatedLogs() {
    console.log('\n===== COFFEE SCRAPER EXECUTION SUMMARY =====\n');

    const sources = Object.keys(this.summaryData);
    
    // Calculate global totals
    this.globalSummary.sourcesProcessed = sources.length;
    this.globalSummary.sourcesSuccessful = sources.filter(s => this.summaryData[s].success).length;
    
    for (const source of sources) {
      const data = this.summaryData[source];
      const status = data.success ? '✓' : '✗';
      
      console.log(`${status} ${source.toUpperCase()}:`);
      console.log(`  Products found: ${data.productsFound}`);
      console.log(`  New products added: ${data.newProducts}`);
      console.log(`  Products updated: ${data.updatedProducts}`);
      
      // Add embedding information if any
      if (data.embeddingGenerated > 0) {
        console.log(`  Embeddings generated: ${data.embeddingGenerated} products (${data.embeddingChunks} chunks)`);
      }
      
      if (data.embeddingsCleaned > 0) {
        console.log(`  Embeddings cleaned: ${data.embeddingsCleaned} unstocked coffees (${data.chunksRemoved} chunks removed)`);
      }
      
      if (data.aiDescriptionsGenerated > 0) {
        console.log(`  AI descriptions generated: ${data.aiDescriptionsGenerated} products`);
      }
      
      if (data.aiTastingNotesGenerated > 0) {
        console.log(`  AI tasting notes generated: ${data.aiTastingNotesGenerated} products`);
      }
      
      if (data.errors.length > 0) {
        console.log(`  Errors (${data.errors.length}):`);
        data.errors.forEach(error => console.log(`    - ${error}`));
      }
      
      if (data.warnings.length > 0) {
        console.log(`  Warnings (${data.warnings.length}):`);
        data.warnings.forEach(warning => console.log(`    - ${warning}`));
      }
      
      console.log('');
      
      // Add to global totals
      this.globalSummary.totalEmbeddingGenerated += data.embeddingGenerated;
      this.globalSummary.totalEmbeddingChunks += data.embeddingChunks;
      this.globalSummary.totalEmbeddingsCleaned += data.embeddingsCleaned;
      this.globalSummary.totalChunksRemoved += data.chunksRemoved;
      this.globalSummary.totalAiDescriptionsGenerated += data.aiDescriptionsGenerated;
      this.globalSummary.totalAiTastingNotesGenerated += data.aiTastingNotesGenerated;
    }

    console.log('===== END OF SUMMARY =====\n');
    
    // Print function summary
    this.printFunctionSummary();
  }

  // Print comprehensive function summary
  printFunctionSummary() {
    console.log('===== FUNCTION EXECUTION SUMMARY =====\n');
    
    console.log('🔧 SCRAPER OPERATIONS:');
    console.log(`  Sources processed: ${this.globalSummary.sourcesProcessed}`);
    console.log(`  Sources successful: ${this.globalSummary.sourcesSuccessful}/${this.globalSummary.sourcesProcessed}`);
    
    const totalProducts = Object.values(this.summaryData).reduce((sum, data) => sum + data.productsFound, 0);
    const totalNewProducts = Object.values(this.summaryData).reduce((sum, data) => sum + data.newProducts, 0);
    const totalUpdatedProducts = Object.values(this.summaryData).reduce((sum, data) => sum + data.updatedProducts, 0);
    
    console.log(`  Total products found: ${totalProducts}`);
    console.log(`  Total new products added: ${totalNewProducts}`);
    console.log(`  Total products updated: ${totalUpdatedProducts}`);
    
    console.log('\n🤖 AI SERVICES:');
    if (this.globalSummary.totalAiDescriptionsGenerated > 0) {
      console.log(`  AI descriptions generated: ${this.globalSummary.totalAiDescriptionsGenerated} products`);
    } else {
      console.log(`  AI descriptions generated: 0 products`);
    }
    
    if (this.globalSummary.totalAiTastingNotesGenerated > 0) {
      console.log(`  AI tasting notes generated: ${this.globalSummary.totalAiTastingNotesGenerated} products`);
    } else {
      console.log(`  AI tasting notes generated: 0 products`);
    }
    
    console.log('\n🔍 EMBEDDING SERVICES:');
    if (this.globalSummary.totalEmbeddingGenerated > 0) {
      console.log(`  Embeddings generated: ${this.globalSummary.totalEmbeddingGenerated} products (${this.globalSummary.totalEmbeddingChunks} chunks)`);
    } else {
      console.log(`  Embeddings generated: 0 products (0 chunks)`);
    }
    
    if (this.globalSummary.totalEmbeddingsCleaned > 0) {
      console.log(`  Embeddings cleaned: ${this.globalSummary.totalEmbeddingsCleaned} unstocked coffees (${this.globalSummary.totalChunksRemoved} chunks removed)`);
    } else {
      console.log(`  Embeddings cleaned: 0 unstocked coffees (0 chunks removed)`);
    }
    
    console.log('\n🧹 MAINTENANCE OPERATIONS:');
    console.log(`  Database cleanup: ${this.globalSummary.totalEmbeddingsCleaned > 0 ? 'Performed' : 'No cleanup needed'}`);
    
    const totalErrors = Object.values(this.summaryData).reduce((sum, data) => sum + data.errors.length, 0);
    const totalWarnings = Object.values(this.summaryData).reduce((sum, data) => sum + data.warnings.length, 0);
    
    console.log(`  Total errors: ${totalErrors}`);
    console.log(`  Total warnings: ${totalWarnings}`);
    
    console.log('\n===== END OF FUNCTION SUMMARY =====\n');
  }
}

// Create a global logger instance
const logger = new LogCollector();

/**
 * Scrolls down the page until no more content is loaded.
 * @param {Page} page - The Playwright page object
 */
async function scrollDownUntilNoMoreContent(page: Page) {
  // Press End key to get initial scroll height
  //await page.keyboard.press('End');
  await page.waitForTimeout(1000);

  // Scroll down gradually
  await page.evaluate(() => {
    return new Promise<void>((resolve) => {
      const distance = 100;
      const delay = 100;
      let extraScrolls = 0;
      const maxExtraScrolls = 5;

      const timer = setInterval(() => {
        const scrollHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
        const scrollTop = Math.max(document.documentElement.scrollTop, document.body.scrollTop);
        const clientHeight = window.innerHeight;

        // More reliable bottom detection
        const isAtBottom = Math.abs(scrollHeight - (scrollTop + clientHeight)) < 10;

        if (isAtBottom) {
          extraScrolls++;
          console.log(`At bottom, extra scroll ${extraScrolls}/${maxExtraScrolls}`);
          if (extraScrolls >= maxExtraScrolls) {
            clearInterval(timer);
            resolve();
            return;
          }
        }

        window.scrollBy(0, distance);
      }, delay);
    });
  });

  // Final wait to ensure content is loaded
  await page.waitForTimeout(2000);
}

//Enhanced stealth configuration for bypassing Cloudflare
function getAdvancedStealthArgs(): string[] {
  return [
    '--start-maximized',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=VizDisplayCompositor',
    '--disable-web-security',
    '--disable-features=TranslateUI',
    '--disable-ipc-flooding-protection',
    '--no-first-run',
    '--no-service-autorun',
    '--no-default-browser-check',
    '--password-store=basic',
    '--use-mock-keychain',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-client-side-phishing-detection',
    '--disable-sync',
    '--metrics-recording-only',
    '--no-report-upload',
    '--disable-dev-shm-usage',
    '--ignore-ssl-errors',
    '--ignore-certificate-errors',
    '--allow-running-insecure-content',
    '--disable-component-extensions-with-background-pages',
    '--disable-default-apps',
    '--mute-audio',
    '--no-zygote',
    '--disable-extensions',
    '--disable-component-update',
    '--disable-background-mode',
    '--disable-plugins-discovery',
    '--disable-prerender-local-predictor',
  ];
}

function getRandomUserAgent(): string {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  ];
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// Enhanced human behavior simulation functions
async function simulateHumanBehavior(page: Page): Promise<void> {
  // Random mouse movements in realistic patterns
  const startX = Math.floor(Math.random() * 400) + 100;
  const startY = Math.floor(Math.random() * 400) + 100;

  // Move mouse in a curved path
  for (let i = 0; i < 5; i++) {
    const endX = startX + Math.floor(Math.random() * 200) - 100;
    const endY = startY + Math.floor(Math.random() * 200) - 100;
    await page.mouse.move(endX, endY);
    await page.waitForTimeout(Math.floor(Math.random() * 200) + 50);
  }

  // Simulate realistic scrolling behavior
  const scrollActions = Math.floor(Math.random() * 3) + 2;
  for (let i = 0; i < scrollActions; i++) {
    const scrollDistance = Math.floor(Math.random() * 500) + 200;
    await page.evaluate((distance) => {
      window.scrollBy(0, distance);
    }, scrollDistance);
    await page.waitForTimeout(Math.floor(Math.random() * 1500) + 800);
  }

  // Simulate reading pause
  await page.waitForTimeout(Math.floor(Math.random() * 3000) + 2000);

  // Random viewport resize to mimic window adjustments
  const viewportWidth = 1920 + Math.floor(Math.random() * 200);
  const viewportHeight = 1080 + Math.floor(Math.random() * 200);
  await page.setViewportSize({ width: viewportWidth, height: viewportHeight });
}

// Enhanced session pre-warming with realistic browsing patterns
async function preWarmSession(page: Page): Promise<void> {
  try {
    // Visit a neutral site first to establish browsing history
    logger.addLog('Debug', 'session_warming', 'Visiting Google to establish browsing pattern...');
    await page.goto('https://www.google.com', { timeout: 30000 });
    await page.waitForTimeout(Math.floor(Math.random() * 2000) + 1000);

    // Simulate search activity
    const searchBox = await page.$('input[name="q"]');
    if (searchBox) {
      await searchBox.type('coffee beans', { delay: Math.floor(Math.random() * 100) + 50 });
      await page.waitForTimeout(Math.floor(Math.random() * 1000) + 500);
    }

    // Navigate to Sweet Maria's main page first
    logger.addLog('Debug', 'session_warming', 'Visiting Sweet Marias main page...');
    await page.goto('https://www.sweetmarias.com/', { timeout: 60000 });
    await simulateHumanBehavior(page);

    logger.addLog('Debug', 'session_warming', 'Session pre-warming completed');
  } catch (error) {
    logger.addLog('Warning', 'session_warming', `Session pre-warming failed: ${error}`);
  }
}

// Enhanced monitoring for bypass success rates
class BypassMonitor {
  private static attempts = 0;
  private static successes = 0;
  private static failures = 0;

  static recordAttempt(): void {
    this.attempts++;
    logger.addLog('Debug', 'bypass_monitor', `Total bypass attempts: ${this.attempts}`);
  }

  static recordSuccess(): void {
    this.successes++;
    const successRate = ((this.successes / this.attempts) * 100).toFixed(1);
    logger.addLog(
      'Info',
      'bypass_monitor',
      `Bypass successful! Success rate: ${successRate}% (${this.successes}/${this.attempts})`
    );
  }

  static recordFailure(): void {
    this.failures++;
    const failureRate = ((this.failures / this.attempts) * 100).toFixed(1);
    logger.addLog(
      'Warning',
      'bypass_monitor',
      `Bypass failed! Failure rate: ${failureRate}% (${this.failures}/${this.attempts})`
    );
  }

  static getStats(): { attempts: number; successes: number; failures: number; successRate: number } {
    return {
      attempts: this.attempts,
      successes: this.successes,
      failures: this.failures,
      successRate: this.attempts > 0 ? (this.successes / this.attempts) * 100 : 0,
    };
  }
}

// Session management for rotation
class SessionManager {
  private sessions: string[] = [];
  private currentSessionIndex = 0;

  constructor() {
    // Create multiple session profiles for rotation
    for (let i = 0; i < 3; i++) {
      this.sessions.push(path.join(process.cwd(), `session-profile-sm-${i}`));
    }
  }

  getCurrentSession(): string {
    return this.sessions[this.currentSessionIndex];
  }

  rotateSession(): string {
    this.currentSessionIndex = (this.currentSessionIndex + 1) % this.sessions.length;
    logger.addLog('Debug', 'session_manager', `Rotated to session ${this.currentSessionIndex}`);
    return this.getCurrentSession();
  }
}

// Refactor Sweet Maria's specific code into a class
class SweetMariasSource implements CoffeeSource {
  name = 'sweet_maria';
  baseUrl = 'https://www.sweetmarias.com/green-coffee.html?product_list_limit=all&sm_status=1';
  private sessionManager = new SessionManager();

  async collectInitUrlsData(): Promise<ProductData[]> {
    // Use session rotation for better stealth
    const currentSession = this.sessionManager.getCurrentSession();
    logger.addLog('Debug', this.name, `Using session: ${currentSession}`);

    // Enhanced stealth configuration for bypassing Cloudflare
    const context = await chromium.launchPersistentContext(currentSession, {
      headless: false, // Headed mode is strongly recommended for bypassing bot detection.
      args: getAdvancedStealthArgs(),
      // Add a more realistic, slightly randomized context to avoid fingerprinting.
      viewport: {
        width: 1920 + Math.floor(Math.random() * 200),
        height: 1080 + Math.floor(Math.random() * 200),
      },
      userAgent: getRandomUserAgent(),
      locale: 'en-US',
      timezoneId: 'America/New_York', // Match timezone for consistency, a common fingerprinting check.
      ignoreHTTPSErrors: true,
      permissions: ['geolocation'],
      geolocation: { latitude: 40.7128, longitude: -74.006 }, // New York coordinates
      deviceScaleFactor: 1 + Math.random() * 0.5, // Random device scale factor
      hasTouch: Math.random() > 0.5, // Randomly enable touch
      javaScriptEnabled: true,
      acceptDownloads: false,
      colorScheme: 'light',
      reducedMotion: 'no-preference',
      extraHTTPHeaders: {
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        DNT: '1',
        Connection: 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
      },
    });

    const page = await context.newPage();

    // Inject additional stealth scripts to avoid detection
    await page.addInitScript(() => {
      // Override the navigator.webdriver property
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // Mock languages and plugins
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });

      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });

      // Override the permissions query
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) =>
        parameters.name === 'notifications'
          ? Promise.resolve({
              name: 'notifications',
              state: Notification.permission,
              onchange: null,
            } as unknown as PermissionStatus)
          : originalQuery(parameters);

      // Add noise to canvas fingerprinting
      const getContext = HTMLCanvasElement.prototype.getContext;

      HTMLCanvasElement.prototype.getContext = function (type, attributes) {
        const context = getContext.call(this, type, attributes);
        if (type === '2d') {
          const originalFillText = context.fillText;
          context.fillText = function (...args) {
            // Add tiny noise to prevent canvas fingerprinting
            args[1] += Math.random() * 0.01;
            args[2] += Math.random() * 0.01;
            return originalFillText.apply(this, args);
          };
        }
        return context;
      };
    });

    try {
      // Record bypass attempt for monitoring
      BypassMonitor.recordAttempt();

      // Enhanced session pre-warming with realistic browsing patterns
      await preWarmSession(page);

      logger.addLog('Debug', this.name, `Navigating to target URL: ${this.baseUrl}`);
      await page.goto(this.baseUrl, {
        timeout: 120000, // Increased timeout for Cloudflare challenges
        waitUntil: 'networkidle', // Wait for network to be idle to handle challenges
      });

      // Additional human behavior after page load
      await simulateHumanBehavior(page);

      const pageTitle = await page.title();
      // logger.addLog('Debug', this.name, `Page title after goto: "${pageTitle}"`);

      // Enhanced Cloudflare challenge detection and recovery
      const challengePatterns = [
        'Just a moment...',
        'Please wait...',
        'Checking your browser',
        'DDoS protection by Cloudflare',
        'Browser check',
        'cf-browser-verification',
      ];

      let retryCount = 0;
      const maxRetries = 3;
      let challengeDetected = false;

      while (retryCount < maxRetries) {
        const currentTitle = await page.title();
        const currentUrl = page.url();
        const pageContent = await page.content();

        // Check for Cloudflare challenge patterns
        challengeDetected = challengePatterns.some(
          (pattern) => currentTitle.includes(pattern) || pageContent.includes(pattern)
        );

        if (challengeDetected) {
          logger.addLog(
            'Warning',
            this.name,
            `Cloudflare challenge detected (attempt ${retryCount + 1}/${maxRetries})`
          );
          logger.addLog('Debug', this.name, `Page title: "${currentTitle}"`);
          logger.addLog('Debug', this.name, `Current URL: ${currentUrl}`);

          // Wait longer for challenge to complete
          await page.waitForTimeout(Math.floor(Math.random() * 10000) + 15000); // 15-25 seconds

          // Try to interact with the page to help bypass
          try {
            await page.mouse.move(500, 300);
            await page.waitForTimeout(1000);
            await page.mouse.click(500, 300);
            await page.waitForTimeout(2000);
          } catch (interactionError) {
            logger.addLog('Debug', this.name, 'Could not interact with challenge page');
          }

          retryCount++;

          // If still on challenge page, try refreshing
          if (retryCount < maxRetries) {
            logger.addLog('Debug', this.name, 'Refreshing page to retry challenge...');
            await page.reload({ waitUntil: 'networkidle', timeout: 90000 });
            await simulateHumanBehavior(page);
          }
        } else {
          break; // No challenge detected, proceed
        }
      }

      if (challengeDetected && retryCount >= maxRetries) {
        logger.addLog('Error', this.name, 'Failed to bypass Cloudflare challenge after maximum retries');
        logger.addLog('Debug', this.name, 'Rotating session for next attempt...');
        this.sessionManager.rotateSession();
        BypassMonitor.recordFailure();
        await context.close();
        return [];
      }

      // Wait for product list to appear
      logger.addLog('Debug', this.name, 'Waiting for product list selector "tr.item" to appear...');
      try {
        await page.waitForSelector('tr.item', { timeout: 60000 }); // Increased timeout
        logger.addLog('Debug', this.name, 'Product list selector found. Scraping page.');
        BypassMonitor.recordSuccess();
      } catch (e) {
        logger.addLog(
          'Error',
          this.name,
          'Timed out waiting for product list. The bot detection page was likely not bypassed.'
        );

        // Enhanced error debugging - only log to internal logs, not console
        const finalTitle = await page.title();
        const finalUrl = page.url();
        logger.addLog('Error', this.name, `Final page title: "${finalTitle}"`);
        logger.addLog('Error', this.name, `Final URL: ${finalUrl}`);

        BypassMonitor.recordFailure();
        await context.close();
        return [];
      }

      const urlsAndPrices = await page.evaluate(() => {
        const products = document.querySelectorAll('tr.item');
        return Array.from(products).map((product) => {
          const link = product.querySelector('.product-item-link') as HTMLAnchorElement;
          const priceElement = product.querySelector('.price-wrapper .price') as HTMLElement;

          const url = link ? link.href : null;
          const priceText = priceElement ? priceElement.innerText.trim() : null;
          const price = priceText ? parseFloat(priceText.replace('$', '')) : null;

          return { url, price };
        });
      });

      if (urlsAndPrices.length === 0) {
        // Product selector was found, but evaluation returned 0 products - suppress verbose logging
        const pageContent = await page.content();
      }

      await context.close();
      const filteredResults = urlsAndPrices.filter(
        (item): item is ProductData => item.url !== null && typeof item.url === 'string' && item.price !== null // Only include items with valid prices
      );

      // Log final statistics
      const stats = BypassMonitor.getStats();
      logger.addLog(
        'Info',
        this.name,
        `Collection complete. Found ${filteredResults.length} products. Bypass stats: ${stats.successRate.toFixed(
          1
        )}% success rate`
      );

      return filteredResults;
    } catch (error) {
      const e = error as Error;
      logger.addLog('Error', this.name, `Error collecting URLs and prices: ${e.message}`);
      logger.addLog('Error', this.name, `Stack trace: ${e.stack}`);

      if (page) {
        try {
          const pageContent = await page.content();
          // Page content captured for debugging (suppress verbose logging)
        } catch (contentError) {
          const ce = contentError as Error;
          logger.addLog('Error', this.name, `Could not get page content on error: ${ce.message}`);
        }
      }

      if (context) {
        await context.close();
      }
      return [];
    }
  }

  async scrapeUrl(url: string, price: number | null): Promise<ScrapedData | null> {
    // Use same session as collectInitUrlsData for consistency
    const currentSession = this.sessionManager.getCurrentSession();

    // Use same enhanced stealth configuration as collectInitUrlsData
    const context = await chromium.launchPersistentContext(currentSession, {
      headless: false, // Headed mode is strongly recommended for bypassing bot detection.
      args: getAdvancedStealthArgs(),
      viewport: {
        width: 1920 + Math.floor(Math.random() * 200),
        height: 1080 + Math.floor(Math.random() * 200),
      },
      userAgent: getRandomUserAgent(),
      locale: 'en-US',
      timezoneId: 'America/New_York',
      ignoreHTTPSErrors: true,
      permissions: ['geolocation'],
      geolocation: { latitude: 40.7128, longitude: -74.006 },
      deviceScaleFactor: 1 + Math.random() * 0.5,
      hasTouch: Math.random() > 0.5,
      javaScriptEnabled: true,
      acceptDownloads: false,
      colorScheme: 'light',
      reducedMotion: 'no-preference',
      extraHTTPHeaders: {
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        DNT: '1',
        Connection: 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
      },
    });
    const page = await context.newPage();

    // Apply same stealth scripts
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
    });

    try {
      await page.goto(url, { timeout: 90000, waitUntil: 'networkidle' });
      await simulateHumanBehavior(page);

      // Add product name extraction
      const productName = await page.evaluate(() => {
        const nameElement = document.querySelector(
          '#maincontent > div > div.column.main > div.product-main-container > div > div.page-title-wrapper.product > h1 > span'
        );
        return nameElement ? (nameElement as HTMLElement).innerText.trim() : null;
      });

      // Add description_short extraction
      const descriptionShort = await page.evaluate(() => {
        const descElement = document.querySelector(
          '#maincontent > div > div > div.product-main-container > div > div.product.attribute.overview > div > p'
        );
        return descElement ? (descElement as HTMLElement).innerText.trim() : null;
      });

      // Add score value extraction
      const scoreValue = await page.evaluate(() => {
        const scoreElement = document.querySelector('div.score-value');
        return scoreElement ? parseInt((scoreElement as HTMLElement).innerText, 10) : null;
      });

      // Add description_long extraction
      const descriptionLong = await page.evaluate(() => {
        const descElement = document.querySelector(
          '#product\\.info\\.description > div > div > div > div.column-right > div.product.attribute.cupping-notes > div.value > p'
        );
        return descElement ? (descElement as HTMLElement).innerText.trim() : null;
      });

      // Click farm notes tab and extract farm_notes
      try {
        await page.waitForSelector('#tab-label-product-info-origin-notes-title', { timeout: 5000 });
        await page.click('#tab-label-product-info-origin-notes-title');
        // Wait for content to be visible
        await page.waitForSelector('#product-info-origin-notes', {
          state: 'visible',
          timeout: 5000,
        });
      } catch (error) {
        // Farm notes tab not found or not clickable - suppress verbose logging
      }

      const farmNotes = await page.evaluate(() => {
        const notesElement = document.querySelector('#product-info-origin-notes > div > div > div.column-right > p');
        return notesElement ? (notesElement as HTMLElement).innerText.trim() : null;
      });

      // Click specs tab and extract specs
      try {
        await page.waitForSelector('#tab-label-product\\.info\\.specs-title', { timeout: 5000 });
        await page.click('#tab-label-product\\.info\\.specs-title');
        // Wait for content to be visible
        await page.waitForSelector('#product-attribute-specs-table', {
          state: 'visible',
          timeout: 5000,
        });
      } catch (error) {
        // Specs tab not found or not clickable - suppress verbose logging
      }

      const specs = await page.evaluate(() => {
        const rows = document.querySelectorAll('#product-attribute-specs-table tbody tr');
        const data: { [key: string]: string } = {};

        rows.forEach((row) => {
          const header = row.querySelector('th')?.innerText.trim();
          const value = row.querySelector('td')?.innerText.trim();
          if (header && value) {
            data[header] = value;
          }
        });

        return data;
      });

      await context.close();

      // Transform the raw specs data into a structured object
      return {
        productName,
        url,
        scoreValue,
        descriptionShort,
        descriptionLong,
        farmNotes,
        cost_lb: price,
        arrivalDate: specs['Arrival date'] || null,
        region: specs['Region'] || null,
        processing: specs['Processing'] || null,
        dryingMethod: specs['Drying Method'] || null,
        lotSize: specs['Lot size'] || null,
        bagSize: specs['Bag size'] || null,
        packaging: specs['Packaging'] || null,
        cultivarDetail: specs['Cultivar Detail'] || null,
        grade: specs['Grade'] || null,
        appearance: specs['Appearance'] || null,
        roastRecs: specs['Roast Recommendations'] || null,
        type: specs['Type'] || null,
      };
    } catch (error) {
      logger.addLog('Error', this.name, `Error scraping ${url}: ${error}`);
      await context.close();
      return null;
    }
  }
}

// Example structure for a new coffee source
class CaptainCoffeeSource implements CoffeeSource {
  name = 'captain_coffee';
  baseUrl = 'https://thecaptainscoffee.com/collections/green-coffee';

  async collectInitUrlsData(): Promise<ProductData[]> {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(this.baseUrl, { timeout: 60000 });

      // Replace the old scrolling logic with the new method
      await scrollDownUntilNoMoreContent(page);

      const initPageData = await page.evaluate(() => {
        const products = document.querySelectorAll('.product-collection.products-grid.row > div');

        return Array.from(products).map((product) => {
          const linkElement = product.querySelector('.product-image > a') as HTMLAnchorElement;
          let productData: {
            variants?: Array<{ price: number; available: boolean; title: string }>;
          } = {};

          try {
            const jsonElement = product.querySelector('[data-json-product]');
            const jsonString = jsonElement?.getAttribute('data-json-product');

            if (jsonString) {
              const cleanedJson = jsonString.replace(/[\n\r\t]/g, '').replace(/\\/g, '\\\\');
              productData = JSON.parse(cleanedJson);

              // Find the 1 lb variant
              const oneLbVariant = productData.variants?.find((v) => v.title.includes('1 lb'));
              if (oneLbVariant) {
                const url = linkElement ? linkElement.href : null;
                const price = oneLbVariant.available ? oneLbVariant.price / 100 : null;

                // Found 1 lb variant - suppress verbose logging

                // Only return price if the variant is available
                return {
                  url,
                  price: oneLbVariant.available ? price : null,
                };
              }
            }
          } catch (e) {
            // Failed to parse product JSON - suppress verbose logging
          }

          return { url: null, price: null };
        });
      });

      await browser.close();

      const filteredResults = initPageData.filter(
        (item): item is ProductData => item.url !== null && typeof item.url === 'string' && item.price !== null
      );

      return filteredResults;
    } catch (error) {
      logger.addLog('Error', this.name, `Error collecting initial page data: ${error}`);
      await browser.close();
      return [];
    }
  }

  async scrapeUrl(url: string, price: number | null): Promise<ScrapedData | null> {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(url, { timeout: 60000 });
      await page.waitForTimeout(2000);

      // Product Name
      const productName = await page.evaluate(() => {
        const nameElement = document.querySelector(
          'div.row.product_top.horizontal-tabs > div.col-md-6.product-shop > h1 > span'
        );
        return nameElement ? nameElement.textContent?.trim() : null;
      });

      // Importer (type)
      const importer = await page.evaluate(() => {
        const importerElement = document.querySelector('div.vendor-product > span > a');
        return importerElement ? importerElement.textContent?.trim() : null;
      });

      // Score Value and Short Description combined
      const { descriptionShort, scoreValue } = await page.evaluate(() => {
        const descElement = document.querySelector('div.short-description > p > em');
        const descriptionShort = descElement ? descElement.textContent?.trim() : null;

        let scoreValue = 85; // default score
        if (descriptionShort) {
          const lowerDescription = descriptionShort.toLowerCase();
          if (lowerDescription.includes('top 3')) {
            scoreValue = 91.5;
          } else if (lowerDescription.includes('top 6')) {
            scoreValue = 87.5;
          }
        }

        return { descriptionShort, scoreValue };
      });

      // Long Description (Tab 3)
      const descriptionLong = await page.evaluate(() => {
        const container = document.querySelector('#collapse-tab3 > div');
        if (!container) return null;

        const paragraphs = Array.from(container.querySelectorAll('p'))
          .filter((p) => !p.textContent?.includes('Reminder! This coffee is raw'))
          .map((p) => p.textContent?.trim())
          .filter(Boolean);

        return paragraphs.join('\n\n');
      });

      // Details (Tab 4)
      const detailsFromPage = await page.evaluate(() => {
        const details: Record<string, any> = {};
        const dateElement = document.querySelector('#collapse-tab4 > div > p:nth-child(1)');
        const fullText = dateElement?.textContent?.trim() || '';

        // Extract packaging first - everything after "Packed in"
        const packagingMatch = fullText.match(/Packed in\s+([^\.]+)/i);
        const packaging = packagingMatch ? packagingMatch[1].trim() : null;

        // Get arrival date - everything before "Packed in" or end of string
        let arrivalDate = fullText
          .split(/Packed in/i)[0] // Split at "Packed in" and take first part
          .replace(/Arrival Date:/i, ''); // Remove "Arrival Date:" text

        // Clean up any trailing punctuation
        arrivalDate = arrivalDate.replace(/[,\.]$/, '').trim();

        // Extract cupping notes
        const cuppingRows = ['Acidity & Brightness', 'Balance & Finish', 'Body & Texture', 'Flavors']
          .map((header) => {
            const row = Array.from(document.querySelectorAll('p')).find((p) => p.textContent?.includes(header));
            return row ? row.textContent?.trim() : null;
          })
          .filter(Boolean);

        // Extract other details
        const rows = Array.from(document.querySelectorAll('p'));

        rows.forEach((row) => {
          const text = row.textContent?.trim() || '';
          if (text.includes('Grade:')) details.grade = text;
          if (text.includes('Processing:')) details.processing = text;
          if (text.includes('Grower:')) details.grower = text;
          if (text.match(/Region:?\s/i)) details.region = text;
          if (text.match(/Variet(y|ies|al|als):?\s/)) details.cultivar = text;
        });

        return {
          arrivalDate,
          packaging,
          cuppingNotes: cuppingRows.join('\n'),
          details,
        };
      });

      // Roast Recommendations (Tab 5)
      const roastRecs = await page.evaluate(() => {
        const container = document.querySelector('#collapse-tab5 > div');
        return container ? container.textContent?.trim() : null;
      });

      // Farm Notes (Tab 6)
      const farmNotes = await page.evaluate(() => {
        const container = document.querySelector('#collapse-tab6 > div');
        return container ? container.textContent?.trim() : null;
      });

      await browser.close();

      return {
        productName: productName ?? null,
        url,
        scoreValue,
        descriptionShort,
        descriptionLong,
        farmNotes: `${detailsFromPage.details.grower}\n${farmNotes}`.trim(),
        cost_lb: price,
        arrivalDate: detailsFromPage.arrivalDate?.replace('Arrival Date:', '').trim() || null,
        packaging: detailsFromPage.packaging,
        type: importer || null,
        cultivarDetail: detailsFromPage.details.cultivar?.replace(/^[^:]*:\s*/, '').trim() || null,
        grade: detailsFromPage.details.grade?.replace(/^[^:]*:\s*/, '').trim() || null,
        appearance: null,
        roastRecs,
        cuppingNotes: detailsFromPage.cuppingNotes,
        region: detailsFromPage.details.region?.replace(/^[^:]*:\s*/, '').trim() || null,
        processing: detailsFromPage.details.processing?.replace(/^[^:]*:\s*/, '').trim() || null,
      };
    } catch (error) {
      logger.addLog('Error', this.name, `Error scraping ${url}: ${error}`);
      await browser.close();
      return null;
    }
  }
}

class BodhiLeafSource implements CoffeeSource {
  name = 'bodhi_leaf';
  baseUrl = 'https://www.bodhileafcoffee.com/collections/green-coffee';

  async collectInitUrlsData(): Promise<ProductData[]> {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(this.baseUrl, { timeout: 60000 });
      await scrollDownUntilNoMoreContent(page);

      const urlsAndPrices = await page.evaluate(() => {
        const products = document.querySelectorAll('.product-list.collection-matrix div.product-wrap');
        return Array.from(products).map((product) => {
          const link = product.querySelector('a[href*="/collections/green-coffee/products/"]');
          const priceElement = product.querySelector('span.money');

          const url = link ? 'https://www.bodhileafcoffee.com' + link.getAttribute('href') : null;
          const priceText = priceElement ? priceElement.textContent?.trim() : null;
          const price = priceText ? parseFloat(priceText.replace('$', '')) : null;

          return { url, price };
        });
      });

      await browser.close();
      const filteredResults = urlsAndPrices.filter(
        (item): item is ProductData => item.url !== null && typeof item.url === 'string' && item.price !== null
      );
      return filteredResults;
    } catch (error) {
      logger.addLog('Error', this.name, `Error collecting URLs and prices: ${error}`);
      await browser.close();
      return [];
    }
  }

  async scrapeUrl(url: string, price: number | null): Promise<ScrapedData | null> {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(url, { timeout: 60000 });
      await page.waitForTimeout(2000);

      const productData = await page.evaluate(() => {
        // Product Name
        const productName = document.querySelector('h1.product_name')?.textContent?.trim() || null;

        // Score Value
        const scoreElement = document.querySelector('span.jdgm-prev-badge__stars');
        const dataScore = scoreElement?.getAttribute('data-score');
        const scoreValue = dataScore ? Math.max(85, 4.3 * parseFloat(dataScore) + 70) : null;

        // Process description div content
        const descDiv = document.querySelector('div.description.bottom');
        const details: {
          grower?: string;
          arrivalDate?: string;
          region?: string;
          processing?: string;
          packaging?: string;
          cultivar?: string;
          grade?: string;
          cuppingNotes?: string;
          country?: string;
          cultivarDetail?: string;
          farmNotes?: string;
          roastRecs?: string;
        } = {};
        let descriptionShort = '';
        let descriptionLong = '';

        if (descDiv) {
          // Handle the first paragraph with all the details
          const firstParagraph = descDiv.querySelector('p:first-child');
          if (firstParagraph) {
            const content = firstParagraph.innerHTML;
            // Split by <br> and process each line
            const lines = content.split('<br>');

            lines.forEach((line) => {
              // Remove HTML tags, &nbsp; entities, and trim
              const text = line
                .replace(/<[^>]*>/g, ' ')
                .replace(/&nbsp;/g, '')
                .trim();

              // More specific matching patterns - match field names and clean colons/spaces
              if (text.match(/^Country/i)) {
                details.country = text
                  .replace(/^Country/i, '')
                  .replace(/^[:\s]+/, '')
                  .trim();
              } else if (text.match(/^Region/i)) {
                details.region = text
                  .replace(/^Region/i, '')
                  .replace(/^[:\s]+/, '')
                  .trim();
              } else if (text.match(/^Varietal/i)) {
                details.cultivarDetail = text
                  .replace(/^Varietal/i, '')
                  .replace(/^[:\s]+/, '')
                  .trim();
              } else if (text.match(/^Process/i)) {
                details.processing = text
                  .replace(/^Process/i, '')
                  .replace(/^[:\s]+/, '')
                  .trim();
              } else if (text.match(/^Altitude/i)) {
                details.grade = text
                  .replace(/^Altitude/i, '')
                  .replace(/^[:\s]+/, '')
                  .trim();
              } else if (text.match(/^Cupping Notes/i)) {
                details.cuppingNotes = text
                  .replace(/^Cupping Notes/i, '')
                  .replace(/^[:\s]+/, '')
                  .trim();
              } else if (text.match(/^Recommended Roast/i)) {
                details.roastRecs = text
                  .replace(/^Recommended Roast/i, '')
                  .replace(/^[:\s]+/, '')
                  .trim();
              } else if (text.match(/^Good For/i)) {
                descriptionShort = text
                  .replace(/^Good For/i, '')
                  .replace(/^[:\s]+/, '')
                  .trim();
              }
            });
          }

          // Handle description paragraphs
          const paragraphs = Array.from(descDiv.querySelectorAll('p'));
          let isFirstRelevantParagraph = true;
          let goodForText = descriptionShort; // Store the "Good For" text

          paragraphs.forEach((p) => {
            const text = p.textContent?.trim() || '';

            if (text.includes('Description:')) {
              // Add the text after "Description:" to descriptionShort, preserving goodFor
              const descriptionPart = text.split('Description:')[1]?.trim();
              if (descriptionPart) {
                descriptionShort = goodForText ? `${goodForText}\n\n${descriptionPart}` : descriptionPart;
                isFirstRelevantParagraph = false;
              }
            } else if (text && isFirstRelevantParagraph) {
              descriptionShort = goodForText ? `${goodForText}\n\n${text}` : text;
              isFirstRelevantParagraph = false;
            } else if (text) {
              // Add all subsequent paragraphs to descriptionLong
              descriptionLong += (descriptionLong ? '\n\n' : '') + text;
            }
          });
        }

        // Combine region and country
        const region =
          details.region && details.country
            ? `${details.region}, ${details.country}`
            : details.region || details.country || null;

        return {
          productName,
          scoreValue,
          region,
          cultivarDetail: details.cultivarDetail,
          farmNotes: details.farmNotes,
          cuppingNotes: details.cuppingNotes,
          processing: details.processing,
          grade: details.grade,
          roastRecs: details.roastRecs,
          descriptionShort: descriptionShort.trim(),
          descriptionLong: descriptionLong.trim(),
        };
      });

      await browser.close();

      return {
        productName: productData.productName ?? null,
        url,
        scoreValue: productData.scoreValue,
        descriptionShort: productData.descriptionShort,
        descriptionLong: productData.descriptionLong,
        farmNotes: productData.farmNotes,
        cost_lb: price,
        arrivalDate: null,
        packaging: null,
        type: null,
        cultivarDetail: productData.cultivarDetail,
        grade: productData.grade,
        appearance: null,
        roastRecs: productData.roastRecs,
        cuppingNotes: productData.cuppingNotes,
        region: productData.region,
        processing: productData.processing,
      };
    } catch (error) {
      logger.addLog('Error', this.name, `Error scraping ${url}: ${error}`);
      await browser.close();
      return null;
    }
  }
}

class ShowroomCoffeeSource implements CoffeeSource {
  name = 'showroom_coffee';
  baseUrl = 'https://showroomcoffee.com/category/green-coffee/';
  async collectInitUrlsData(): Promise<ProductData[]> {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(this.baseUrl, { timeout: 60000 });
      await scrollDownUntilNoMoreContent(page);

      const urlsAndPrices = await page.evaluate(() => {
        const figures = document.querySelectorAll(
          'figure.product-thumbnail, figure.product_thumbnail, .product-thumbnail'
        );

        return Array.from(figures).map((figure) => {
          const link = figure.querySelector('a');
          // Get the price from the last bdi element in the price span (highest price in range)
          const priceContainer = figure
            .closest('.product.type-product')
            ?.querySelector('.wc-measurement-price-calculator-price');
          const allPrices = priceContainer?.querySelectorAll('bdi');
          const lastPrice = allPrices?.length ? allPrices[allPrices.length - 1] : null;

          const url = link ? link.getAttribute('href') : null;
          const priceText = lastPrice ? lastPrice.textContent?.trim().replace('$', '') : null;
          const price = priceText ? parseFloat(priceText) : null;

          return { url, price };
        });
      });

      await browser.close();
      const filteredResults = urlsAndPrices.filter(
        (item): item is ProductData => item.url !== null && typeof item.url === 'string' && item.price !== null
      );
      return filteredResults;
    } catch (error) {
      logger.addLog('Error', this.name, `Error collecting URLs and prices: ${error}`);
      await browser.close();
      return [];
    }
  }

  async scrapeUrl(url: string, price: number | null): Promise<ScrapedData | null> {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(url, { timeout: 60000 });
      await page.waitForTimeout(2000);

      //close showroom_coffee klayvio popup
      await page.click('[aria-label="Close dialog"]');
      // Get product name
      const productName = await page.evaluate((): string | null => {
        const nameElement = document.querySelector('.product-information h1');
        const text = nameElement?.textContent?.trim();
        return typeof text === 'string' ? text : null;
      });

      // Get table data
      const tableData = await page.evaluate(() => {
        const data: Record<string, string> = {};
        const rows = document.querySelectorAll('#tab-additional_information table tr');

        rows.forEach((row) => {
          const label = row.querySelector('th')?.textContent?.trim().toLowerCase();
          const value = row.querySelector('td p')?.textContent?.trim();

          if (label && value) {
            data[label] = value;
          }
        });

        return data;
      });

      // Click description tab and get farm notes
      await page.click('#tab-title-description');
      await page.waitForTimeout(1000);

      const descriptionData = await page.evaluate((): string | null => {
        const descElement = document.querySelector('#tab-description');
        if (!descElement) return null;
        const text = descElement.textContent?.trim();
        return typeof text === 'string' ? text : null;
      });

      // Process cupping notes to extract score
      let scoreValue: number | null = null;
      let cuppingNotes = tableData['cupping notes upon arrival'] || null;
      if (cuppingNotes) {
        const match = cuppingNotes.match(/^(\d+(\.\d+)?)/);
        if (match) {
          scoreValue = parseFloat(match[1]);
        }
      }

      // Combine country and region for region field
      const region = [tableData['country'], tableData['region']].filter(Boolean).join(', ');

      await browser.close();

      return {
        productName,
        url,
        scoreValue,
        descriptionShort: tableData['fresh filter'] || null,
        descriptionLong: null,
        farmNotes: descriptionData,
        cost_lb: price,
        arrivalDate: tableData['arrival date'] || null,
        packaging: null,
        type: tableData['community name'] || null,
        cultivarDetail: tableData['varietals'] || null,
        grade: tableData['elevation'] || null,
        appearance: null,
        roastRecs: null,
        cuppingNotes,
        region: region || null,
        processing: tableData['processing method'] || null,
      };
    } catch (error) {
      logger.addLog('Error', this.name, `Error scraping ${url}: ${error}`);
      await browser.close();
      return null;
    }
  }
}

// Modified database update function to handle multiple sources
async function updateDatabase(source: CoffeeSource) {
  const dataCleaner = new DataCleaner(logger);

  try {
    logger.addLog('Step 1: Collecting product URLs', source.name, 'Starting collection of product URLs');
    const productsData = await source.collectInitUrlsData();
    const unfilteredUrls = productsData.map((item) => item.url);
    const inStockUrls = unfilteredUrls.filter((url) => {
      return (
        // list of patterns to filter out
        !url.includes('roasted') &&
        !url.includes('subscription') &&
        !url.includes('rstd-subs-') &&
        !url.includes('-set-') &&
        !url.includes('-set.html') &&
        !url.includes('-blend') &&
        !url.includes('-sampler') &&
        !url.includes('steves-favorites') &&
        !url.includes('bag-ends') &&
        !url.includes('fruit-basket-combo-pack')
      );
    });
    logger.addLog(
      'Step 1: Collecting product URLs',
      source.name,
      `Found ${inStockUrls.length} total products on the site`
    );

    // Issue #1: Handle empty URL collection - abort if no URLs found
    if (inStockUrls.length === 0) {
      logger.addLog(
        'Step 1: Collecting product URLs',
        source.name,
        'WARNING: No URLs collected. This appears to be a failed run.'
      );
      logger.addLog(
        'Step 1: Collecting product URLs',
        source.name,
        'Aborting update to preserve current stocked status in database.'
      );
      return { success: false, reason: 'No URLs collected' };
    }

    // Get existing stocked products for this source
    const { data: stockedDbProducts, error: fetchStockedError } = await supabase
      .from('coffee_catalog')
      .select('link')
      .eq('source', source.name)
      .eq('stocked', true);

    if (fetchStockedError) throw fetchStockedError;
    logger.addLog(
      'Step 1: Collecting product URLs',
      source.name,
      `Found ${stockedDbProducts?.length || 0} stocked products in database`
    );

    // Create a set of URLs that are currently in stock
    const inStockUrlSet = new Set(inStockUrls);

    // Identify URLs that are no longer stocked (in DB as stocked but not found on site)
    const noLongerStockedUrls =
      stockedDbProducts?.filter((product) => !inStockUrlSet.has(product.link)).map((product) => product.link) || [];

    logger.addLog(
      'Step 2: Updating stocked status',
      source.name,
      `Marking ${noLongerStockedUrls.length} products as no longer stocked`
    );

    // Update only the products that are no longer stocked
    if (noLongerStockedUrls.length > 0) {
      const { error: updateError } = await supabase
        .from('coffee_catalog')
        .update({
          stocked: false,
          unstocked_date: new Date().toISOString(), // Set unstocked_date when marking as no longer stocked
          last_updated: new Date().toISOString(), // Update last_updated when changing stocked status
        })
        .in('link', noLongerStockedUrls)
        .eq('source', source.name);

      if (updateError) throw updateError;
    }

    // Create a map of URL to price for updates
    const priceMap = new Map(productsData.map((item) => [item.url, item.price]));

    // Update prices for in-stock items (don't need to update stocked status for existing items)
    logger.addLog('Step 3: Updating prices', source.name, `Updating prices for ${inStockUrls.length} in-stock items`);
    for (const url of inStockUrls) {
      const price = priceMap.get(url);
      const { error: priceUpdateError } = await supabase
        .from('coffee_catalog')
        .update({
          stocked: true, // Ensure it's marked as stocked
          cost_lb: price,
        })
        .eq('link', url)
        .eq('source', source.name);

      if (priceUpdateError) throw priceUpdateError;
    }

    // Get new URLs to process (URLs not already in the database)
    const newUrls = await checkExistingUrls(inStockUrls);

    // Add debugging to verify the updates
    const { data: stillStocked, error: checkError } = await supabase
      .from('coffee_catalog')
      .select('link')
      .eq('source', source.name)
      .eq('stocked', true);

    if (checkError) throw checkError;
    logger.addLog(
      'Step 4: Final status',
      source.name,
      `Products now marked as stocked in DB: ${stillStocked?.length || 0}`
    );
    logger.addLog('Step 4: Final status', source.name, `Number of new URLs to process: ${newUrls.length}`);

    // Process new products
    if (newUrls.length > 0) {
      logger.addLog('Step 5: Processing new products', source.name, `Processing ${newUrls.length} new URLs`);
      let newProductsAdded = 0;

      for (const url of newUrls) {
        logger.addLog('Step 5: Processing new products', source.name, `Processing URL: ${url}`);
        const price = priceMap.get(url) ?? null;
        const scrapedData = await source.scrapeUrl(url, price);

        if (scrapedData) {
          // Apply data cleaning to fill NULL values
          logger.addLog(
            'Step 5: Processing new products',
            source.name,
            `Applying data cleaning for: ${scrapedData.productName}`
          );
          const cleaningResult = await dataCleaner.batchCleanFields(scrapedData as any, source.name);

          if (cleaningResult.fieldsProcessed.length > 0) {
            logger.addLog(
              'Step 5: Processing new products',
              source.name,
              `Data cleaning enhanced ${
                cleaningResult.fieldsProcessed.length
              } fields: ${cleaningResult.fieldsProcessed.join(', ')}`
            );
          }

          if (cleaningResult.errors.length > 0) {
            logger.addLog('Warning', source.name, `Data cleaning errors: ${cleaningResult.errors.join('; ')}`);
          }

          // Use the cleaned data for database insertion
          const finalData = cleaningResult.cleanedData;

          const { error } = await supabase.from('coffee_catalog').insert({
            name: scrapedData.productName,
            score_value: scrapedData.scoreValue,
            arrival_date: finalData.arrivalDate,
            region: finalData.region,
            processing: finalData.processing,
            drying_method: finalData.dryingMethod,
            lot_size: finalData.lotSize,
            bag_size: finalData.bagSize,
            packaging: finalData.packaging,
            cultivar_detail: finalData.cultivarDetail,
            grade: finalData.grade,
            appearance: finalData.appearance,
            roast_recs: finalData.roastRecs,
            type: finalData.type,
            link: scrapedData.url,
            description_long: finalData.descriptionLong,
            description_short: finalData.descriptionShort,
            cupping_notes: finalData.cuppingNotes,
            farm_notes: finalData.farmNotes,
            ai_description: finalData.aiDescription,
            ai_tasting_notes: finalData.aiTastingNotes,
            last_updated: new Date().toISOString(), // Initial creation is an update
            stocked_date: new Date().toISOString(), // Set stocked_date when first adding to inventory
            source: source.name,
            cost_lb: scrapedData.cost_lb,
            stocked: true,
          });

          if (error) throw error;
          newProductsAdded++;
          logger.addLog(
            'Step 5: Processing new products',
            source.name,
            `Successfully inserted product: ${finalData.productName}`
          );
        }
      }

      logger.addLog(
        'Step 5: Processing new products',
        source.name,
        `Added ${newProductsAdded} new products to the database`
      );

      // Step 7: Generate embeddings for newly added products and clean up unstocked embeddings
      try {
        const embeddingService = new EmbeddingService(logger);
        
        // First, clean up embeddings for unstocked coffees
        logger.addLog('Step 7: Embedding Cleanup', source.name, 'Cleaning up embeddings for unstocked coffees');
        const cleanupResult = await embeddingService.cleanupUnstockedEmbeddings();
        
        if (cleanupResult.success && cleanupResult.removedCoffees > 0) {
          logger.addLog(
            'Step 7: Embedding Cleanup',
            source.name,
            `Cleaned up ${cleanupResult.removedChunks} chunks for ${cleanupResult.removedCoffees} unstocked coffees`
          );
        }

        if (cleanupResult.errors.length > 0) {
          logger.addLog('Warning', source.name, `Cleanup errors: ${cleanupResult.errors.join('; ')}`);
        }

        // Then, generate embeddings for newly added products
        if (newProductsAdded > 0) {
          logger.addLog('Step 7: Embedding Generation', source.name, `Generating embeddings for ${newProductsAdded} new products`);
          
          // Get the newly added products for embedding generation (only stocked ones)
          const { data: newProducts, error: fetchError } = await supabase
            .from('coffee_catalog')
            .select('*')
            .eq('source', source.name)
            .eq('stocked', true)
            .gte('stocked_date', new Date(Date.now() - 60000).toISOString()); // Products added in the last minute

          if (fetchError) {
            logger.addLog('Error', source.name, `Error fetching new products for embedding generation: ${fetchError.message}`);
          } else if (newProducts && newProducts.length > 0) {
            const embeddingResult = await embeddingService.processBulkEmbeddings(newProducts, false);
            
            if (embeddingResult.success) {
              logger.addLog(
                'Step 7: Embedding Generation',
                source.name,
                `Successfully generated embeddings for ${embeddingResult.processed} products (${embeddingResult.totalChunks} chunks)`
              );
            } else {
              logger.addLog('Warning', source.name, 'Some embedding generation failed');
            }

            if (embeddingResult.errors.length > 0) {
              logger.addLog('Warning', source.name, `Embedding errors: ${embeddingResult.errors.join('; ')}`);
            }
          }
        }
      } catch (error) {
        logger.addLog('Error', source.name, `Error in embedding operations: ${error instanceof Error ? error.message : 'Unknown error'}`);
        // Don't fail the entire scrape if embedding operations fail
      }
    }

    logger.addLog('Step 6: Completion', source.name, 'Database update complete');
    return { success: true };
  } catch (error) {
    logger.addLog('Error', source.name, `Error updating database: ${error}`);
    throw error;
  }
}

async function checkExistingUrls(urls: string[]): Promise<string[]> {
  // Filter out URLs containing unwanted patterns
  const filteredUrls = urls.filter((url) => {
    return (
      // list of patterns to filter out
      !url.includes('roasted') &&
      !url.includes('subscription') &&
      !url.includes('rstd-subs-') &&
      !url.includes('-set-') &&
      !url.includes('-set.html') &&
      !url.includes('-blend') &&
      !url.includes('-sampler') &&
      !url.includes('steves-favorites')
    );
  });

  const { data: existingUrls, error } = await supabase.from('coffee_catalog').select('link').in('link', filteredUrls);

  if (error) throw error;

  const existingUrlSet = new Set(existingUrls.map((row) => row.link));
  return filteredUrls.filter((url) => !existingUrlSet.has(url));
}

// Helper function to confirm steps & debug
async function confirmStep(message: string): Promise<boolean> {
  console.log('\n' + message);
  process.stdout.write('Continue? (y/n): ');

  const response = await new Promise<string>((resolve) => {
    process.stdin.once('data', (data) => {
      resolve(data.toString().trim().toLowerCase());
    });
  });

  if (response !== 'y') {
    console.log('Operation aborted by user');
    return false;
  }
  return true;
}

// Main execution
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  const sourceMap = {
    sweet_maria: new SweetMariasSource(),
    captain_coffee: new CaptainCoffeeSource(),
    bodhi_leaf: new BodhiLeafSource(),
    showroom_coffee: new ShowroomCoffeeSource(),
  };

  const sourceName = process.argv[2];
  if (!sourceName) {
    console.error(`Error: No source specified. Please use "${Object.keys(sourceMap).join('" or "')}"`);
    process.exit(1);
  }

  // Check if "all" is specified
  if (sourceName === 'all') {
    // Run all sources in parallel
    Promise.all(
      Object.values(sourceMap).map((source) =>
        updateDatabase(source)
          .then((result) => {
            if (!result.success) {
              if (result.reason === 'No URLs collected') {
                logger.addLog('Result', source.name, 'No URLs collected, database unchanged.');
              } else {
                logger.addLog('Result', source.name, 'Failed to update database.');
              }
            } else {
              logger.addLog('Result', source.name, 'Completed successfully');
            }
            return result;
          })
          .catch((error) => {
            logger.addLog('Error', source.name, `Error: ${error.message}`);
            return { success: false, source: source.name };
          })
      )
    )
      .then(() => {
        // After all sources are complete, print the consolidated logs
        logger.printConsolidatedLogs();
        console.log('All sources completed');
        process.exit(0);
      })
      .catch((error) => {
        logger.addLog('Error', 'system', `Fatal error: ${error}`);
        logger.printConsolidatedLogs();
        process.exit(1);
      });
  } else {
    const source = sourceMap[sourceName as keyof typeof sourceMap];
    if (!source) {
      console.error(
        `Error: Invalid source specified. Valid options are: "all" or "${Object.keys(sourceMap).join('" or "')}"`
      );
      process.exit(1);
    }

    updateDatabase(source)
      .then((result) => {
        if (!result.success) {
          if (result.reason === 'No URLs collected') {
            logger.addLog('Result', source.name, 'No URLs collected, database unchanged.');
          } else {
            logger.addLog('Result', source.name, 'Failed to update database.');
          }
        } else {
          logger.addLog('Result', source.name, 'Update completed successfully');
        }
        // Print consolidated logs after single source completes
        logger.printConsolidatedLogs();
        process.exit(0);
      })
      .catch((error) => {
        logger.addLog('Error', source.name, `Error: ${error}`);
        logger.printConsolidatedLogs();
        process.exit(1);
      });
  }
}
