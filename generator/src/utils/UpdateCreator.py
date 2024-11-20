#!/usr/bin/env python

# Copyright 2023 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.  
UpdateCreator.py

unset vmwareId please use $unset: {"vmwareId": ""}
'''
import requests
import pymongo

MONGO_DB = "slackbot"
MONGO_URI = "mongodb://service:66i*22AZxnrIvsFiLqu&mB3D68kt6xkU8iTQDvCPaJpD0t9n6h@vsanperf-vsanbot-db.vdp.lvn.broadcom.net:27017/" + MONGO_DB
userInfos = dict()

def get_account(vmwareId):
   url = 'https://vsanbot.vdp.lvn.broadcom.net/api/v1/user?name=' + vmwareId
   res = requests.get(url)
   if res.status_code == 200:
      account = res.json()['mail'].split('@')[0]
      return account
   print('Not find account by vmwareId:', vmwareId)
   return vmwareId

def get_bc_account(vmwareId):
   if not userInfos.get(vmwareId):
      userInfos[vmwareId] = get_account(vmwareId)
   account = userInfos[vmwareId]
   return account

def insert_new_mailinfo(new_userinfos):
   with pymongo.MongoClient(MONGO_URI) as client:
      print("Login " + MONGO_URI)
      db = client[MONGO_DB]
      collection = db['mailinfos']
      
      for oktaId, userinfo in new_userinfos.items():
         try:
            data = {
               "oktaId": oktaId,
               "mail": userinfo['mail'],
               "fullName": userinfo['full_name'],
               "manager": userinfo['manager'],
               "gid": userinfo['gid'],
               "vmwareId": userinfo['vmwareId']
            }
            result_insert = collection.insert_one(data)
            print(result_insert)
         except Exception as e:
            print(f'Fail to insert new mail info {oktaId}, error:', e)
      

def update_vmwareId_into_bc_account():
   with pymongo.MongoClient(MONGO_URI) as client:
      print("Login " + MONGO_URI)
      db = client[MONGO_DB]
   
      collection = db['reportconfigurations']
   
      # Update creator
      documents = collection.find({"vmwareId": {"$exists": True}})
      exist_vmware_id_count = 0
      for doc in documents:
         title = doc['title']
         try:
            reportId = doc['_id']
            creator = doc['creator']
            vmwareId = doc['vmwareId']
            status = doc['status']
            account = get_bc_account(vmwareId)
            print('Update creator "{}" into {} by vmwareId {} for report {} [{}]'.format(
               creator, account, vmwareId, title, status))
            result_set = collection.update_one(
               {"_id": reportId}, {"$set": {"creator": account}}
            )
            print(result_set.matched_count, result_set.modified_count)
            check_result = collection.find_one({"_id": reportId})
            print('check result:', check_result['creator'], check_result['vmwareId'])
            print("-----")
         except Exception as e:
            print(f'Fail to update creator for {title}, error:', e)
         exist_vmware_id_count += 1
      print('exist vmware id count:', exist_vmware_id_count)
      print("="*20)
   
      # Update mentionUsers
      documents = collection.find({"creator": {"$exists": True}})
      for doc in documents:
         title = doc['title']
         try:
            reportId = doc['_id']
            status = doc['status']
            mentionUsers = doc['mentionUsers']
            mention_accounts = []
            for mention_vmwareId in mentionUsers:
               print(f'mention user vmwareId: {mention_vmwareId}')
               mention_account = get_bc_account(mention_vmwareId)
               mention_accounts.append(mention_account)
            if len(mention_accounts) > 0:
               print('Update mentionUsers "{}" into {} for report {} [{}]'.format(
                  mentionUsers, mention_accounts, title, status))
               result_set = collection.update_one(
                  {"_id": reportId}, {"$set": {"mentionUsers": mention_accounts}}
               )
               print(result_set.matched_count, result_set.modified_count)
               check_result = collection.find_one({"_id": reportId})
               print('check result:', check_result['mentionUsers'])
               print("-----")
         except Exception as e:
            print(f'Fail to update mention users for {title}, error:', e)
   
      # Update bugzilla assignee
      documents = collection.find({"reportType": "bugzilla_by_assignee"})
      for doc in documents:
         title = doc['title']
         try:
            reportId = doc['_id']
            status = doc['status']
            bugzillaAssignees = doc['reportSpecConfig']['bugzillaAssignee']
            bugzilla_accounts = []
            for bugzilla_vmwareId in bugzillaAssignees:
               print(f'bugzilla assignee vmwareId: {bugzilla_vmwareId}')
               bugzilla_account = get_bc_account(bugzilla_vmwareId)
               bugzilla_accounts.append(bugzilla_account)
            if len(bugzilla_accounts) > 0:
               print('Update bugzillaAssignee "{}" into {} for report {} [{}]'.format(
                  bugzillaAssignees, bugzilla_accounts, title, status))
               result_set = collection.update_one(
                  {"_id": reportId}, {"$set": {"reportSpecConfig.bugzillaAssignee": bugzilla_accounts}}
               )
               print(result_set.matched_count, result_set.modified_count)
               check_result = collection.find_one({"_id": reportId})
               print('check result:', check_result['reportSpecConfig']['bugzillaAssignee'])
               print("-----")
         except Exception as e:
            print(f'Fail to update bugzilla assignees for {title}, error:', e)
   
      # Update nanny assignees
      documents = collection.find({"reportType": "nanny_reminder", "reportSpecConfig.nannyCode":"vcf"})
      for doc in documents:
         title = doc['title']
         try:
            reportId = doc['_id']
            status = doc['status']
            nannyAssignees = doc['reportSpecConfig']['nannyAssignee'].split('\n')
            nanny_accounts = []
            for nanny_vmwareId in nannyAssignees:
               print(f'nanny assignee vmwareId: {nanny_vmwareId}')
               nanny_account = get_bc_account(nanny_vmwareId)
               nanny_accounts.append(nanny_account)
            if len(nanny_accounts) > 0:
               nanny_account_str = "\n".join(nanny_accounts)
               print('Update nannyAssignee "{}" into {} for report {} [{}]'.format(
                  doc['reportSpecConfig']['nannyAssignee'], nanny_account_str, title, status))
               result_set = collection.update_one(
                  {"_id": reportId}, {"$set": {"reportSpecConfig.nannyAssignee": nanny_account_str}}
               )
               print(result_set.matched_count, result_set.modified_count)
               check_result = collection.find_one({"_id": reportId})
               print('check result:', check_result['reportSpecConfig']['nannyCode'], check_result['reportSpecConfig']['nannyAssignee'])
               print("-----")
         except Exception as e:
            print(f'Fail to update nanny assignees for {title}, error:', e)

new_userinfos = {
   "xs032484": {
      "gid": "102881097674941081219",
      "mail": "xunzhi.sun@broadcom.com",
      "full_name": "Xunzhi Sun",
      "manager": "dc004720",
      "vmwareId": ""
   },
   "as031732": {
      "gid": "104766321531890040068",
      "mail": "aaron.spear@broadcom.com",
      "full_name": "Aaron Spear",
      "manager": "jh013504",
      "vmwareId": ""
   },
   "dc004720": {
      "gid": "104199294830703192297",
      "mail": "david.campos@broadcom.com",
      "full_name": "David Campos",
      "manager": "jh013504",
      "vmwareId": ""
   },
   "jh013504": {
      "gid": "115045129042034799999",
      "mail": "john-s.huang@broadcom.com",
      "full_name": "John Huang",
      "manager": "sd007088",
      "vmwareId": ""
   }
}
insert_new_mailinfo(new_userinfos)