# !/usr/bin/env python

# Copyright 2021 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.
Utils.py
'''

import os
import subprocess
import datetime
from generator.src.utils.Logger import logger

def runCmd(cmd, nTimeOut=300):
   process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stdin=subprocess.PIPE, shell=True)
   try:
      stdout, stderr = process.communicate(timeout=nTimeOut)
   except subprocess.TimeoutExpired:
      process.kill()
      stdout, stderr = process.communicate()
   return stdout, stderr

def printRunningTime(func):
   def wrapper(*args, **kwargs):
      startTime = datetime.datetime.now()
      ret = func(*args, **kwargs)
      endTime = datetime.datetime.now()
      dt = endTime - startTime
      output = 'Function [%s] ElaspeTime: %.3fs' % (func.__name__, dt.total_seconds())
      logger.info(output)
      return ret
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
               logger.error('remove file error: ', e)
