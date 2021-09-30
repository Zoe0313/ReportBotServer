#!/usr/bin/env python

# Copyright 2021 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.  
bugzilla_assignee_report.py
'''
import base64
import requests
import datetime
from collections import defaultdict, namedtuple
from generator.src.utils.BotConst import SERVICE_ACCOUNT, SERVICE_PASSWORD
from generator.src.utils.Utils import logExecutionTime, noIntervalPolling
from generator.src.utils.Logger import logger
Record = namedtuple('Record', ['bugId', 'assignee', 'reporter', 'severity', 'priority',
                               'status', 'fixBy', 'eta', 'summary'])
Nan = 'Nan'

class BugzillaAssigneeSpider(object):
   def __init__(self, args):
      self.title = args.title
      self.userList = args.users.split(",")
      self.currentTime = datetime.datetime.now()
      headerList = ['Assignee', 'Pri', 'Status', 'ETA', 'FixBy', 'Summary']
      self.columnDict = {header: len(header) for header in headerList}
      self.assigneeQueryUrl = "https://bugzilla-rest.eng.vmware.com/rest/v1/bug/assignee/{0}"
      self.bugIdQueryUrl = "https://bugzilla-rest.eng.vmware.com/rest/v1/bug/{0}"
      btAccountInfo = base64.b64encode("{0}:{1}".format(SERVICE_ACCOUNT, SERVICE_PASSWORD).encode())
      self.session = requests.session()
      self.session.headers.update({'Authorization': 'Basic {0}'.format(str(btAccountInfo, 'utf-8')),
                                   'Host': 'bugzilla-rest.eng.vmware.com'})

   @noIntervalPolling
   def getBugInfoByAssignee(self, user):
      res = self.session.get(self.assigneeQueryUrl.format(user))
      bugInfos = res.json().get('bugs', [])
      if not bugInfos:
         return res.json().get('message', '')
      return bugInfos

   @noIntervalPolling
   def getBugInfoById(self, bugId):
      res = self.session.get(self.bugIdQueryUrl.format(bugId))
      bugInfos = res.json().get('bugs', [])
      if not bugInfos:
         return res.json().get('message', '')
      return bugInfos

   @logExecutionTime
   def getReport(self):
      message = []
      message.append("*Title: {0}*".format(self.title))
      message.append("Time: " + self.currentTime.strftime("%Y-%m-%d %H:%M:%S"))
      message.append("```")
      result = self.getRecords()
      if result:
         contentFormatter = "".join(["{:<%ds}  " % col for col in self.columnDict.values()][1:])
         headerFormatter = "{:>%ds}  --  " % self.columnDict['Assignee'] + contentFormatter
         bodyFormatter = " " * (self.columnDict['Assignee'] + 6) + contentFormatter
         message.append(headerFormatter.format(*(col for col in self.columnDict.keys())))
         userName = ""
         for user in self.userList:
            recordList = result.get(user, [])
            recordList.sort(key=lambda r: r.bugId, reverse=True)
            for record in recordList:
               if userName == user:
                  message.append(bodyFormatter.format(record.priority, record.status, record.eta, record.fixBy,
                                                      record.summary))
               else:
                  message.append(headerFormatter.format(record.assignee, record.priority, record.status, record.eta,
                                                        record.fixBy, record.summary))
                  userName = user
      else:
         message.append("No bugs assigned to selected members.")
      message.append("```")
      report = "\n".join(message)
      report = report.replace("'", "").replace('"', "")
      return report

   def getRecords(self, assigneeMaxLength=20, summaryMaxLength=80):
      self.columnDict['Summary'] = summaryMaxLength
      result = defaultdict(list)
      for user in self.userList:
         # please avoid assignee name longer than 80 chars.
         assignee = user if len(user) < assigneeMaxLength else user[:assigneeMaxLength - 3] + '...'
         self.columnDict['Assignee'] = max(len(user), self.columnDict['Assignee'])
         bugList = self.getBugInfoByAssignee(user)
         if isinstance(bugList, list):
            for bugDict in bugList:
               bugId = bugDict['id']
               severity = bugDict['severity']
               priority = bugDict['priority']
               status = bugDict['status']
               summary = bugDict['summary']
               # please avoid summary longer than 80 chars.
               summary = summary if len(summary) < summaryMaxLength else summary[:summaryMaxLength - 3] + '...'
               fixBy, reporter, eta = '', '', ''
               bugDetail = self.getBugInfoById(bugId)
               if isinstance(bugDetail, list):
                  detailDict = bugDetail[0]
                  reporter = detailDict['reporter']
                  eta = detailDict['cf_eta'].replace('00:00:00 GMT', '') if detailDict['cf_eta'] else Nan
                  fixBy = ",".join([s.replace('fix_by_', '') for s in detailDict['fix_by']]) \
                     if detailDict['fix_by'] else Nan
               else:
                  logger.error('{} bugDetail: {}'.format(user, bugDetail))
               result[user].append(Record(bugId, assignee, reporter, severity, priority, status, fixBy, eta, summary))
               self.columnDict['Pri'] = max(len(priority), self.columnDict['Pri'])
               self.columnDict['Status'] = max(len(status), self.columnDict['Status'])
               self.columnDict['ETA'] = max(len(eta), self.columnDict['ETA'])
               self.columnDict['FixBy'] = max(len(fixBy), self.columnDict['FixBy'])
         else:
            logger.error('{} bugList: {}'.format(user, bugList))
      return result

import argparse
def parseArgs():
   parser = argparse.ArgumentParser(description='Generate bugzilla assignee report')
   parser.add_argument('--title', type=str, required=True, help='Title of bugzilla assignee report')
   parser.add_argument('--users', type=str, required=True, help='user name list')
   return parser.parse_args()

if __name__ == '__main__':
   args = parseArgs()
   spider = BugzillaAssigneeSpider(args)
   ret = spider.getReport()
   print(ret)
   logger.info(ret)
