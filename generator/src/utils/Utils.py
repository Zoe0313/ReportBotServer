# !/usr/bin/env python

# Copyright 2021 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.
Utils.py
'''

import os
import subprocess
import time
import functools
import datetime
from generator.src.utils.Logger import logger

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
