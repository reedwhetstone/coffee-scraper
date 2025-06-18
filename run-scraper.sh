#!/bin/bash
# Set range in seconds for the delay (0 to 8 hours)
MIN_DELAY=0
MAX_DELAY=$((8 * 60 * 60)) # 8 hours in seconds

# Generate a random delay within the range
RANDOM_DELAY=$(shuf -i ${MIN_DELAY}-${MAX_DELAY} -n 1)

echo "Sleeping for ${RANDOM_DELAY} seconds before running the scraper..."
sleep $RANDOM_DELAY

echo "Starting scraper..."
cd /home/ubuntu/coffee-scraper
/usr/bin/npm run scrape all > scraper.log 2>&1
cat scraper.log | msmtp -a gmail rwhetstone0934@gmail.com