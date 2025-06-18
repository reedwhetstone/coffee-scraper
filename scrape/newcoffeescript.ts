/** @format */

//npm run scrape all
// npm run scrape sweet_maria
// npm run scrape captain_coffee
// npm run scrape bodhi_leaf

import { chromium, Page } from 'playwright';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

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

  // Add a log entry for a specific step and source
  addLog(step: string, source: string, message: string) {
    if (!this.logs[step]) {
      this.logs[step] = {};
    }
    if (!this.logs[step][source]) {
      this.logs[step][source] = [];
    }

    this.logs[step][source].push(message);

    // Also print to console for real-time debugging if needed
    console.log(`[${source}] ${message}`);
  }

  // Print all collected logs in a consolidated format
  printConsolidatedLogs() {
    console.log('\n===== COFFEE SCRAPER EXECUTION SUMMARY =====\n');

    // Get all steps in order
    const steps = Object.keys(this.logs).sort();

    for (const step of steps) {
      console.log(`${step}:`);

      // Get all sources for this step
      const sources = Object.keys(this.logs[step]);

      // Print each source's logs for this step
      for (const source of sources) {
        for (const message of this.logs[step][source]) {
          console.log(`  [${source}] ${message}`);
        }
      }
      console.log(''); // Add blank line between steps
    }

    console.log('===== END OF SUMMARY =====\n');
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

// Refactor Sweet Maria's specific code into a class
class SweetMariasSource implements CoffeeSource {
  name = 'sweet_maria';
  baseUrl = 'https://www.sweetmarias.com/green-coffee.html?product_list_limit=all&sm_status=1';

  async collectInitUrlsData(): Promise<ProductData[]> {
    const browser = await chromium.launch();
    const context = await browser.newContext({
      // Add a desktop user agent to avoid headless detection
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    try {
      logger.addLog('Debug', this.name, `Navigating to ${this.baseUrl}`);
      await page.goto(this.baseUrl, {
        timeout: 90000, // Increased timeout
        waitUntil: 'networkidle', // Wait for network to be idle to handle challenges
      });

      const pageTitle = await page.title();
      logger.addLog('Debug', this.name, `Page title after goto: "${pageTitle}"`);

      // The "Just a moment..." page is a sign of Cloudflare bot detection.
      // We'll wait for a specific element on the real page to appear.
      logger.addLog('Debug', this.name, 'Waiting for product list selector "tr.item" to appear...');
      try {
        await page.waitForSelector('tr.item', { timeout: 45000 }); // Wait up to 45 seconds
        logger.addLog('Debug', this.name, 'Product list selector found. Scraping page.');
      } catch (e) {
        logger.addLog(
          'Error',
          this.name,
          'Timed out waiting for product list. The bot detection page was likely not bypassed.'
        );
        const finalTitle = await page.title();
        const pageContent = await page.content();
        logger.addLog('Debug', this.name, `Final page title: "${finalTitle}"`);
        logger.addLog('Debug', this.name, `Page content (first 500 chars): ${pageContent.substring(0, 500)}`);
        await browser.close();
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
        logger.addLog('Debug', this.name, 'Product selector was found, but evaluation returned 0 products.');
        const pageContent = await page.content();
        logger.addLog('Debug', this.name, `Current page URL: ${page.url()}`);
        logger.addLog('Debug', this.name, `Page content (first 500 chars): ${pageContent.substring(0, 500)}`);
      }

      await browser.close();
      const filteredResults = urlsAndPrices.filter(
        (item): item is ProductData => item.url !== null && typeof item.url === 'string' && item.price !== null // Only include items with valid prices
      );
      return filteredResults;
    } catch (error) {
      const e = error as Error;
      logger.addLog('Error', this.name, `Error collecting URLs and prices: ${e.message}`);
      logger.addLog('Error', this.name, `Stack trace: ${e.stack}`);

      if (page) {
        try {
          const pageContent = await page.content();
          logger.addLog(
            'Debug',
            this.name,
            `Page content on error (first 500 chars): ${pageContent.substring(0, 500)}`
          );
        } catch (contentError) {
          const ce = contentError as Error;
          logger.addLog('Error', this.name, `Could not get page content on error: ${ce.message}`);
        }
      }

      if (browser) {
        await browser.close();
      }
      return [];
    }
  }

  async scrapeUrl(url: string, price: number | null): Promise<ScrapedData | null> {
    const browser = await chromium.launch();
    const context = await browser.newContext({
      // Add a desktop user agent to avoid headless detection
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    try {
      await page.goto(url, { timeout: 60000 });
      await page.waitForTimeout(200);

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
        console.log('Farm notes tab not found or not clickable');
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
        console.log('Specs tab not found or not clickable');
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

      await browser.close();

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
      console.error(`Error scraping ${url}:`, error);
      await browser.close();
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
        console.log('Starting page evaluation...');
        const products = document.querySelectorAll('.product-collection.products-grid.row > div');
        console.log('Found products:', products.length);

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

                console.log('Found 1 lb variant:', {
                  url,
                  price,
                  available: oneLbVariant.available,
                });

                // Only return price if the variant is available
                return {
                  url,
                  price: oneLbVariant.available ? price : null,
                };
              }
            }
          } catch (e) {
            console.error('Failed to parse product JSON:', e);
          }

          return { url: null, price: null };
        });
      });

      //console.log('All collected data:', initPageData);
      await browser.close();

      const filteredResults = initPageData.filter(
        (item): item is ProductData => item.url !== null && typeof item.url === 'string' && item.price !== null
      );
      //console.log('Filtered results:', filteredResults);

      return filteredResults;
    } catch (error) {
      console.error('Error collecting initial page data:', error);
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
          if (text.match(/Varieties?:?\s/i)) details.cultivar = text;
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
        cultivarDetail: detailsFromPage.details.cultivar?.replace('Varieties:', '').trim() || null,
        grade: detailsFromPage.details.grade?.replace('Grade:', '').trim() || null,
        appearance: null,
        roastRecs,
        cuppingNotes: detailsFromPage.cuppingNotes,
        region: detailsFromPage.details.region?.replace('Region:', '').trim() || null,
        processing: detailsFromPage.details.processing?.replace('Processing:', '').trim() || null,
      };
    } catch (error) {
      console.error(`Error scraping ${url}:`, error);
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
      console.error('Error collecting URLs and prices:', error);
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
      console.error(`Error scraping ${url}:`, error);
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
      console.error('Error collecting URLs and prices:', error);
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
      console.error(`Error scraping ${url}:`, error);
      await browser.close();
      return null;
    }
  }
}

// Modified database update function to handle multiple sources
async function updateDatabase(source: CoffeeSource) {
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
          const { error } = await supabase.from('coffee_catalog').insert({
            name: scrapedData.productName,
            score_value: scrapedData.scoreValue,
            arrival_date: scrapedData.arrivalDate,
            region: scrapedData.region,
            processing: scrapedData.processing,
            drying_method: scrapedData.dryingMethod,
            lot_size: scrapedData.lotSize,
            bag_size: scrapedData.bagSize,
            packaging: scrapedData.packaging,
            cultivar_detail: scrapedData.cultivarDetail,
            grade: scrapedData.grade,
            appearance: scrapedData.appearance,
            roast_recs: scrapedData.roastRecs,
            type: scrapedData.type,
            link: scrapedData.url,
            description_long: scrapedData.descriptionLong,
            description_short: scrapedData.descriptionShort,
            cupping_notes: scrapedData.cuppingNotes,
            farm_notes: scrapedData.farmNotes,
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
            `Successfully inserted product: ${scrapedData.productName}`
          );
        }
      }

      logger.addLog(
        'Step 5: Processing new products',
        source.name,
        `Added ${newProductsAdded} new products to the database`
      );
    }

    logger.addLog('Step 6: Completion', source.name, 'Database update complete');
    return { success: true };
  } catch (error) {
    logger.addLog('Error', source.name, `Error updating database: ${error}`);
    console.error(`[${source.name}] Error updating database:`, error);
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
            console.error(`${source.name} Error:`, error);
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
        console.error('Fatal error:', error);
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
        console.error('Error:', error);
        logger.printConsolidatedLogs();
        process.exit(1);
      });
  }
}
