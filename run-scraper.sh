#!/bin/bash
cd /home/ubuntu/coffee-scraper
/usr/bin/npm run scrape all > scraper.log 2>&1
cat scraper.log | msmtp -a gmail rwhetstone0934@gmail.com