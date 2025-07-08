<!-- @format -->

# Coffee Scraper

A web scraper for collecting coffee bean information from various sources.

## Features

- Scrapes coffee bean data from multiple sources:
  - Sweet Maria's
  - Captain's Coffee
  - Bodhi Leaf
- Updates a Supabase database with the scraped data
- Tracks when items become unstocked
- Handles scraping failures gracefully

## Running the Scraper

To run the scraper for all sources:

```bash
npm run scrape all
npm run scrape-local all for local deployment ( not headless)
```

To run for a specific source:

```bash
npm run scrape sweet_maria
npm run scrape captain_coffee
npm run scrape bodhi_leaf
npm run scrape showroom_coffee
```

to run the embeddings

```bash
npm run generate-embeddings generate
npm run generate-embeddings status
```

## Recent Updates

- Add retry mechanism for failed URL collection
- Add tracking of when products become unstocked via the `stocked` field
- Chang the inventory update approach to only mark products as unstocked when they're no longer found on the source website
