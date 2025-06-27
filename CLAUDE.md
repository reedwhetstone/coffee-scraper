# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a coffee scraper that collects green coffee bean data from multiple retailers and stores it in a Supabase database. The scraper uses Playwright for web automation and tracks product availability, pricing, and detailed coffee information.

## Common Commands

- `npm run scrape all` - Run scraper for all sources (headless, server deployment)
- `npm run scrape-local all` - Run scraper for all sources (local development, not headless)
- `npm run scrape sweet_maria` - Run scraper for Sweet Maria's only
- `npm run scrape captain_coffee` - Run scraper for Captain's Coffee only
- `npm run scrape bodhi_leaf` - Run scraper for Bodhi Leaf only
- `npm run update-prices` - Update prices only (separate script)

## Architecture

### Core Components

1. **Main Script (`scrape/newcoffeescript.ts`)**
   - Entry point that handles command-line arguments
   - Implements source-specific scraping strategies
   - Manages database operations via Supabase

2. **Coffee Source Interface**
   - Standardized interface for different coffee retailers
   - Each source implements `collectInitUrlsData()` and `scrapeUrl()` methods
   - Supports sources: Sweet Maria's, Captain's Coffee, Bodhi Leaf, Showroom Coffee

3. **Database Integration**
   - Uses Supabase for data storage
   - Tracks product availability with `stocked` field
   - Updates existing records and inserts new ones

### Data Flow

1. **URL Collection**: Each source collects product URLs and prices from listing pages
2. **Individual Scraping**: Each product URL is scraped for detailed information
3. **Data Processing**: Extracted data is normalized and structured
4. **Database Updates**: Data is upserted into Supabase with availability tracking

### Scraping Strategy

- Uses Playwright with stealth plugin to avoid detection
- Implements retry mechanisms for failed requests
- Handles dynamic content loading with appropriate waits
- Processes both tabular data and free-form descriptions

## Data Structure

The scraper extracts and stores:
- Product name and URL
- Price information
- Cupping scores (when available)
- Farm and processing details
- Availability status

## Environment Setup

Requires `.env` file with:
- `PUBLIC_SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key for database access

## Deployment Notes

- `run-scraper.sh` script includes random delay (0-8 hours) for scheduled runs
- Uses `xvfb-run` for headless execution on servers
- Logs are emailed via `msmtp` after completion
- Chrome session data stored in `session-profile-sm/` directory (gitignored)