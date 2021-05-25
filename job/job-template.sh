#!/bin/sh
cd /slackbot/bugzilla/70u3BugReport
python3 ./dailyReport/allBug/70u3BugReport.py >> /var/log/cron.log 2>&1
python3 ./dailyReport/selectedBug/70u3SelectBugReport.py >> /var/log/cron.log 2>&1