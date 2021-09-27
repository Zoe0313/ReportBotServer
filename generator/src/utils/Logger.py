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
LOG_FORMAT = "%(asctime)s - %(levelname)s - %(filename)s[:%(lineno)d] - %(message)s"
DATE_FORMAT = "%Y/%m/%d %H:%M:%S %p"

dirPath = os.path.join(os.path.abspath(__file__).split("/generator")[0], "persist/log")
os.makedirs(dirPath, exist_ok=True)

def getBeijingTime(sec, what):
   beijingTime = datetime.datetime.now() + datetime.timedelta(hours=8)
   return beijingTime.timetuple()

logging.Formatter.converter = getBeijingTime

def createLogger():
   logger = logging.getLogger('mylogger')
   logger.setLevel(logging.DEBUG)
   handler = logging.handlers.TimedRotatingFileHandler(os.path.join(dirPath, 'slackbot-generator.log'),
                                                       when='midnight', interval=1, backupCount=7)
   handler.setFormatter(logging.Formatter(fmt=LOG_FORMAT, datefmt=DATE_FORMAT))
   logger.addHandler(handler)
   return logger

logger = createLogger()
