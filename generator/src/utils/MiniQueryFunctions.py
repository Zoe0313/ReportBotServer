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
import certifi
from generator.src.utils.Logger import logger


def short2long(url):
   session = requests.session()
   try:
      r = session.get(url, allow_redirects=False)
      longUrl = r.headers.get('location')
   except Exception as e:
      logger.error("get long url error: ", e)
      return url
   return longUrl

def long2short(url):
   http = urllib3.PoolManager(ca_certs=certifi.where())
   encodedBody = json.dumps({"longUrl": url, "userLabel": "string"}).encode('utf-8')
   try:
      res = http.request(method='POST',
                         url="https://via.vmware.com/via-console/app-api/v1/vialink",
                         headers={'Content-Type': 'application/json',
                                  "X-HeaderKey": "%241%24Yfai%2FUQF%24egNLEHGRocRPuPuzq3tsE%2F"},
                         body=encodedBody)
      r = json.loads(res.data.decode('utf-8'))
   except Exception as e:
      logger.error("get short url error: ", e)
      return None
   return r.get('shortUrl')

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

