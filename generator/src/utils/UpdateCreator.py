#!/usr/bin/env python

# Copyright 2023 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.  
UpdateCreator.py
'''
import requests
import pymongo

def get_account(vmwareId):
   url = 'https://vsanbot.vdp.lvn.broadcom.net/api/v1/user?name=' + vmwareId
   res = requests.get(url)
   if res.status_code == 200:
      account = res.json()['mail'].split('@')[0]
      return account
   raise Exception('Not find account by vmwareId:', vmwareId)

MONGO_DB = "zoe-slackbot"
MONGO_URI = "mongodb://service:66i*22AZxnrIvsFiLqu&mB3D68kt6xkU8iTQDvCPaJpD0t9n6h@vsanperf-vsanbot-db.vdp.lvn.broadcom.net:27017/" + MONGO_DB
with pymongo.MongoClient(MONGO_URI) as client:
   print("Login " + MONGO_URI)
   db = client[MONGO_DB]
   collection = db['reportconfigurations']

   # Update creator and unset vmwareId
   userInfos = dict()
   # documents1 = collection.find({"vmwareId": {"$exists": True}})
   documents1 = collection.find({"creator": {"$exists": True}})
   for doc in documents1:
      reportId = doc['_id']
      try:
         # # update creator
         # vmwareId = doc['vmwareId']
         # print("-----")
         # print(reportId, doc['creator'], doc['vmwareId'], doc['title'])
         # if not userInfos.get(vmwareId):
         #    userInfos[vmwareId] = get_account(vmwareId)

         # account = userInfos[vmwareId]
         # result_set = collection.update_one(
         #    {"_id": reportId},
         #    {"$set": {"creator": account}}
         # )
         # print('set creator:', result_set.matched_count, result_set.modified_count)
         # # unset vmwareId
         # result_unset = collection.update_one(
         #    {"_id": reportId},
         #    {"$unset": {"vmwareId": ""}}
         # )
         # print('unset vmwareId:', result_unset.matched_count, result_unset.modified_count)
         # update mentionUsers
         mentionUsers = doc['mentionUsers']
         mention_accounts = []
         for mention_vmwareId in mentionUsers:
            print(f'mention user vmwareId: {mention_vmwareId}')
            if not userInfos.get(mention_vmwareId):
               userInfos[mention_vmwareId] = get_account(mention_vmwareId)
            mention_account = userInfos[mention_vmwareId]
            mention_accounts.append(mention_account)
         if len(mention_accounts) > 0:
            result_set = collection.update_one(
               {"_id": reportId},
               {"$set": {"mentionUsers": mention_accounts}}
            )

         # check result
         check_result = collection.find_one({"_id": reportId})
         print(check_result['_id'], check_result['creator'], check_result.get('mentionUsers'), check_result['title'])
      except Exception as e:
         print(f'{reportId} Error:', e)

   # documents2 = collection.find({"reportType": "bugzilla_by_assignee"})
   # for doc in documents2:
   #    try:
   #       # update reportSpecConfig.bugzillaAssignee
   #       bugzillaAssignees = doc['reportSpecConfig.bugzillaAssignee']
   #       bugzilla_accounts = []
   #       for bugzilla_vmwareId in bugzillaAssignees:
   #          print(f'bugzilla assignee vmwareId: {bugzilla_vmwareId}')
   #          if not userInfos.get(bugzilla_vmwareId):
   #             userInfos[bugzilla_vmwareId] = get_account(bugzilla_vmwareId)
   #          bugzilla_account = userInfos[bugzilla_vmwareId]
   #          bugzilla_accounts.append(bugzilla_account)
   #       if len(bugzilla_accounts) > 0:
   #          result_set = collection.update_one(
   #             {"_id": reportId},
   #             {"$set": {"reportSpecConfig.bugzillaAssignee": bugzilla_accounts}}
   #          )
   #       check_result = collection.find_one({"_id": reportId})
   #       print(check_result['_id'], check_result['reportSpecConfig']['bugzillaAssignee'])
   #    except Exception as e:
   #       print(f'{reportId} Error:', e)
