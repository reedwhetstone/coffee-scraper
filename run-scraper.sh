#!/bin/bash
cd /home/ubuntu/coffee-scraper
/usr/bin/npm run scrape all > scraper.log 2>&1
cat scraper.log | mail -s "Coffee Scraper Log $(date '+\%Y-\%m-\%d')" rwhetstone0934@gmail.com -A scraper.log