# !/usr/bin/env python

# Copyright 2021 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.
Utils.py
'''
import json
import os
import pytz
import subprocess
import time
import functools
import datetime
from urllib import parse
from generator.src.utils.Logger import logger

# In order to add some mention user names, we set this value less than 4000.
MAX_CHAR_LENGTH_IN_ONE_REPORT = 3900
# Cache for slash command usages
slashCmdUsagesCache = {}

def runCmd(cmd, nTimeOut=300):
   process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stdin=subprocess.PIPE, shell=True)
   try:
      stdout, stderr = process.communicate(timeout=nTimeOut)
      returncode = process.returncode
   except subprocess.TimeoutExpired:
      process.kill()
      stdout, stderr = process.communicate()
      returncode = process.returncode
   return stdout, stderr, returncode

def logExecutionTime(func):
   @functools.wraps(func)
   def wrapper(*args, **kwargs):
      startTime = time.perf_counter()
      res = func(*args, **kwargs)
      endTime = time.perf_counter()
      output = '{} took {:.3f}s'.format(func.__name__, endTime - startTime)
      logger.info(output)
      return res
   return wrapper

def getOneDay(dtDay, formatter="%Y%m%d"):
   today = datetime.datetime.today()
   oneDay = today + datetime.timedelta(days=dtDay)
   return oneDay.strftime(formatter)

def removeOldFiles(path, dtDay=15, keyWord=""):
   now = datetime.datetime.now()
   oldTime = now - datetime.timedelta(days=dtDay)
   for root, dirs, files in os.walk(path, True):
      for file in files:
         filePath = os.path.join(root, file)
         fileTime = datetime.datetime.fromtimestamp(os.path.getmtime(filePath))
         if fileTime < oldTime and keyWord in file:
            try:
               os.remove(filePath)
            except Exception as e:
               logger.exception(f'removeOldFiles error: {e}')

def noIntervalPolling(func):
   count = 0
   @functools.wraps(func)
   def wrapper(*args, **kwargs):
      nonlocal count
      count += 1
      try:
         return func(*args, **kwargs)
      except Exception as e:
         output = 'polling times: {}, Function [{}] err: {}'.format(count, func.__name__, e)
         logger.exception(output)
         if count < 3:
            return wrapper(*args, **kwargs)
      return "error"
   return wrapper

def splitOverlengthReport(messages, isContentInCodeBlock=False, enablePagination=False):
   reports = []
   def formatReport(reportLines):
      report = "\n".join(reportLines)
      if isContentInCodeBlock:
         report = report.strip("```")
         report = "```" + report + "```"
      return report

   reportLength, reportLines = 0, []
   for line in messages:
      if reportLength + len(line) > MAX_CHAR_LENGTH_IN_ONE_REPORT:
         report = formatReport(reportLines)
         reports.append(report)
         reportLength, reportLines = 0, []
      reportLength += len(line) + 1
      reportLines.append(line)

   if len(reportLines) > 0:
      report = formatReport(reportLines)
      reports.append(report)

   if enablePagination:
      # Add pagination
      pages = []
      pageSize = len(reports)
      for pageIndex, pageContent in enumerate(reports, start=1):
         if isContentInCodeBlock:
            pages.append("```Page ({0}/{1})\n{2}".format(pageIndex, pageSize, pageContent.lstrip("```")))
         else:
            pages.append("Page ({0}/{1})\n{2}".format(pageIndex, pageSize, pageContent))
      return pages
   return reports

def transformReport(messages, isNoContent=False, isContentInCodeBlock=False, enablePagination=False, enableSplitReport=True):
   if enableSplitReport:
      reports = splitOverlengthReport(messages, isContentInCodeBlock, enablePagination)
   else:
      reports = messages
   reports = [parse.quote(report) for report in reports]
   return json.dumps({'messages': reports, 'isEmpty': isNoContent})

def LoadSlashCommandUsage(fileName):
   if not fileName:
      return ''
   if slashCmdUsagesCache.get(fileName):
      return slashCmdUsagesCache[fileName]
   filePath = os.path.join(os.path.abspath(__file__).split("/generator")[0],
                           "persist", "slash_cmd_usage", fileName + ".txt")
   if os.path.exists(filePath):
      with open(filePath, 'rt') as f:
         slashCmdUsagesCache[fileName] = f.read()
      return slashCmdUsagesCache[fileName]
   return ''

def Local2Utc(localTime, timezone="Asia/Shanghai"):
   localTimezone = pytz.timezone(timezone)
   localDt = localTimezone.localize(localTime)
   utcTime = localTime + localDt.utcoffset()
   return utcTime