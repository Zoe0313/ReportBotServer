# !/usr/bin/env python

# Copyright 2021 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.
MiniQueryFunction.py
'''

import os
import json
import requests
import urllib3
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
        response = requests.post(url='http://vsanvia.vmware.com/api/shorten',
                                 data=json.dumps(payload), verify=False)
        if response.status_code == 200:
            data = response.json()
            return data.get('short_url', None)
    except Exception as e:
        logger.error("get short url error: {0}".format(e))
    return None

def short2long(short_url):
    try:
        response = requests.get(url=short_url, allow_redirects=False,
                                verify=False)
        if response.status_code == 302:
            long_url = response.headers.get('location')
            return long_url
    except Exception as e:
        logger.error("get long url error: ", e)
    return None

def vsanviaLinkMigration():
    response = requests.get(url='http://vsanvia.vmware.com/api/urls?user=svc.vsan-er')
    if response.status_code == 200:
        results = response.json()
        urls = results['results']
        print(f"The number of urls is {len(urls)}")
        for url in urls:
            url_id = url['pk']
            original_url = url['original_url']
            if 'bugzilla.eng.vmware.com' not in original_url:
                continue
            original_url = original_url.replace('bugzilla.eng.vmware.com', 'bugzilla-vcf.lvn.broadcom.net')
            try:
                payload = {'original_url': original_url}
                response = requests.post(url=f'http://vsanvia.vmware.com/api/url/{url_id}',
                                         data=json.dumps(payload))
                data = response.json()
                print('Succeed to update the long url:', data)
            except Exception as e:
                print(f'Fail to update the long url: {url_id} {original_url}')
                print(e)

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

def queryMembersByLdap(managerName):
   '''
   query API:
   'https://ldap-data.svc-stage.eng.vmware.com/ldap/_search'
   -H 'Content-Type: application/json' -d '{"query" : {"match": {"direct_manager_username": "<username>"}}}'
   '''
   members = []
   try:
      res = requests.get(url='https://ldap-data.svc-stage.eng.vmware.com/ldap/_search',
                         data='{"query": {"match": {"direct_manager_username": "%s"}}}' % managerName,
                         headers={'Content-Type': 'application/json'})
      content = res.json()
      hits = content.get('hits', {}).get('hits', [])
      for hit in hits:
         info = hit.get('_source', {})
         members.append(info['username'])
         logger.info(info['is_service_account'], info['username'], info['direct_manager_username'])
   except Exception as e:
      logger.error("query members by ldap error: ", e)
   return members

def getTeamMembersByLdap(bossId):
   '''This team members not contain service accounts.'''
   users = [bossId]
   members = [bossId]
   while users:
      user = users.pop()
      ret = queryMembersByLdap(user)
      members.extend(ret)
      users.extend(ret)
   return members

def outputMemberFile(bossId):
   downloadDir = os.path.join(os.path.abspath(__file__).split("/src")[0], "download")
   if not os.path.exists(downloadDir):
      os.mkdir(downloadDir)
   ldapList = getTeamMembersByLdap(bossId)
   if ldapList:
      with open(os.path.join(downloadDir, bossId), 'wt') as f:
         f.write('\n'.join(ldapList))
      return True
   return False

def getTeamMembersByNimbus(bossId):
   '''This team members contain service accounts.'''
   session = requests.session()
   users = [bossId]
   members = [bossId]
   while users:
      user = users.pop()
      url = 'https://nimbus-api.eng.vmware.com/api/v1//users/{}'.format(user)
      try:
         datas = session.get(url).json()
         reports = datas.get('direct_reports', [])
         members.extend(reports)
         users.extend(reports)
      except Exception as e:
         logger.error("get team members by nimbus error: ", e)
   return members

def isServiceAccount(account):
   '''
   There is a way to check whether the account is service account or not:
   https://ldap-data.svc.eng.vmware.com/ldap/_doc/svc.vmpool There is a field named "is_service_account".
   This will indicate whether the account is service account or not.
   '''
   ret = True
   session = requests.session()
   url = 'https://ldap-data.svc.eng.vmware.com/ldap/_doc/{}'.format(account)
   try:
      datas = session.get(url).json()
      ret = datas.get('_source', {}).get('is_service_account', '')
   except Exception as e:
      logger.error("check service account error: ", e)
   return '1' == ret


def postMessageByChannelId(channelId, message):
   from generator.src.utils.BotConst import POST_MESSAGE_API_BY_CHANNEL, POST_MESSAGE_BEAR_TOKEN
   urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

   url = POST_MESSAGE_API_BY_CHANNEL.format(channelId)
   session = requests.session()
   session.headers = {"Authorization": POST_MESSAGE_BEAR_TOKEN}
   result = session.post(url, data={"text": message}, verify=False)
   logger.info("post message by rest-api, response: {0}".format(result.content.decode()))

