# !/usr/bin/env python

# Copyright 2021 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.
Logger.py
'''

import datetime
import logging
import logging.handlers
import os
LOG_FORMAT = "%(asctime)s.%(msecs)03d - %(levelname)s - %(filename)s[:%(lineno)d] - %(message)s"
DATE_FORMAT = "%Y/%m/%d %H:%M:%S"

dirPath = os.path.join(os.path.abspath(__file__).split("/generator")[0], "persist/log")
os.makedirs(dirPath, exist_ok=True)

def getUTCTime(sec, what):
   return datetime.datetime.utcnow().timetuple()

logging.Formatter.converter = getUTCTime

def createLogger(filename):
   logger = logging.getLogger(filename)
   logger.setLevel(logging.DEBUG)
   handler = logging.handlers.TimedRotatingFileHandler(os.path.join(dirPath, filename),
                                                       when='midnight', interval=1, backupCount=7)
   handler.setFormatter(logging.Formatter(fmt=LOG_FORMAT, datefmt=DATE_FORMAT))
   logger.addHandler(handler)
   return logger

logger = createLogger(filename='slackbot-generator.log')
PerfLogger = createLogger(filename='slackbot-generator-perf.log')
