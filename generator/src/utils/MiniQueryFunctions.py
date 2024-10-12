# !/usr/bin/env python

# Copyright 2021 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.
MiniQueryFunction.py
'''

import os
import json
import requests
import hashlib
import pickle
from filelock import FileLock
from generator.src.utils.Logger import logger

def long2short(long_url):
    try:
        payload = {'original_url': long_url,
                   'short_key': '',
                   'expire_type': 'indefinitely',
                   'user_id': 'svc.vsan-er'}
        response = requests.post(url='https://vsanvia.broadcom.net/api/shorten', data=json.dumps(payload), verify=False)
        if response.status_code == 200:
            data = response.json()
            return data.get('short_url', None)
    except Exception as e:
        logger.error("get short url error: {0}".format(e))
    return None

def short2long(short_url):
    try:
        response = requests.get(url=short_url, allow_redirects=False, verify=False)
        logger.info(response.status_code)
        logger.info(response.content.decode())
        if response.status_code == 302:
            long_url = response.headers.get('location')
            return long_url
    except Exception as e:
        logger.error("get long url error: ", e)
    return None

def QueryUserById(oktaId):
   if os.environ.get('STAGE') == 'product':
      API = 'https://vsanbot.vdp.lvn.broadcom.net/api/v1/user?name='
   elif os.environ.get('STAGE') == 'stage':
      API = 'https://vsanbot-stg.vdp.lvn.broadcom.net/api/v1/user?name='
   else:
      API = 'https://127.0.0.1:3001/api/v1/user?name='
   try:
      res = requests.get(API + oktaId)
      if res.status_code == 200:
         return res.json()
   except Exception as e:
      print("Fail to query 'api/v1/user?name={0}', error: {1}".format(oktaId, e))
   return {}

def readMemoryFile(pklFile):
   if os.path.exists(pklFile):
      with FileLock(pklFile + ".lock"):
         with open(pklFile, 'rb') as f:
            return pickle.load(f)

def writeMemoryFile(pklFile, data):
   with FileLock(pklFile + ".lock"):
      with open(pklFile, 'wb') as f:
         pickle.dump(data, f)

def readJsonFile(jsonPath):
   if os.path.exists(jsonPath):
      with FileLock(jsonPath + ".lock"):
         with open(jsonPath, 'r') as f:
            return json.load(f)

def writeJsonFile(jsonPath, data):
   with FileLock(jsonPath + ".lock"):
      with open(jsonPath, 'w') as f:
         json.dump(data, f)

def getShortUrlsFromCacheFile(fileDir:str, fileKey:str, urlTailDict:dict):
   key = hashlib.sha256(fileKey.encode()).hexdigest()
   pklFile = os.path.join(fileDir, "{0}.pkl".format(key))
   shortUrlDict = readMemoryFile(pklFile)
   shortUrlDict = shortUrlDict if shortUrlDict else {}
   for urlTail, longUrl in urlTailDict.items():
      shortUrlDict[urlTail] = shortUrlDict.get(urlTail) if shortUrlDict.get(urlTail) else long2short(longUrl)
   writeMemoryFile(pklFile, shortUrlDict)
   return shortUrlDict

def getLastPRsFromCacheFile(fileDir:str, fileKey:str):
    key = hashlib.sha256(fileKey.encode()).hexdigest()
    jsonFile = os.path.join(fileDir, "{0}.json".format(key))
    prList = readJsonFile(jsonFile)
    return prList if prList else []

def updatePRsInCacheFile(fileDir:str, fileKey:str, prList:list):
    key = hashlib.sha256(fileKey.encode()).hexdigest()
    jsonFile = os.path.join(fileDir, "{0}.json".format(key))
    writeJsonFile(jsonFile, prList)
