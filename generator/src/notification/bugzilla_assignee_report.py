#!/usr/bin/env python

# Copyright 2021 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.  
bugzilla_assignee_report.py
'''
import base64
import requests
import re
from urllib import parse
from collections import defaultdict, namedtuple
from generator.src.utils.BotConst import SERVICE_ACCOUNT, SERVICE_PASSWORD
from generator.src.utils.Utils import logExecutionTime, noIntervalPolling
from generator.src.utils.Logger import logger
Record = namedtuple('Record', ['bugId', 'assignee', 'reporter', 'severity', 'priority',
                               'status', 'fixBy', 'eta', 'summary'])
Nan = '---'
tabStr = " "*4

class BugzillaAssigneeSpider(object):
   def __init__(self, args):
      self.title = parse.unquote(args.title)
      self.userList = args.users.split(",")
      headerList = ['Pri', 'Status', 'ETA', 'FixBy', 'Summary']
      self.columnDict = {header: len(header) for header in headerList}
      self.assigneeQueryUrl = "https://bugzilla-rest.eng.vmware.com/rest/v1/bug/assignee/{0}"
      self.bugIdQueryUrl = "https://bugzilla-rest.eng.vmware.com/rest/v1/bug/{0}"
      self.showBugUrl = "https://bugzilla.eng.vmware.com/show_bug.cgi?id={0}"
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
      result = self.getRecords()
      message = []
      message.append("*Title: {0}*".format(self.title))
      if result:
         lineFormatter = tabStr*2 + "{0}: {1} {2} _FixBy:_ {3} _ETA:_ {4}\n" + " "*26 + "_Summary_: {5}"
         for user in self.userList:
            recordList = result.get(user, [])
            recordList.sort(key=lambda r: r.bugId, reverse=True)
            if len(recordList) > 0:
               message.append("○ *{0}* (Count: *{1}*)".format(user, len(recordList)))
               for record in recordList:
                  idWithLink = "<%s|%s>" % (self.showBugUrl.format(record.bugId), record.bugId)
                  line = lineFormatter.format(idWithLink, record.priority, record.status, record.fixBy, record.eta,
                                              record.summary)
                  message.append(line)
            else:
               message.append("*{0} (No Bug)* :coffee:".format(user))
      else:
         message.append("No bugs assigned to selected members. :coffee:")

      report = "\n".join(message)
      return report

   def getRecords(self, assigneeMaxLength=20, summaryMaxLength=80):
      pattern = re.compile(r'fix_by_product:(.*), fix_by_version:(.*), fix_by_phase:(.*)', re.M | re.I)
      self.columnDict['Summary'] = summaryMaxLength
      result = defaultdict(list)
      for user in self.userList:
         # please avoid assignee name longer than 80 chars.
         assignee = user if len(user) < assigneeMaxLength else user[:assigneeMaxLength - 3] + '...'
         bugList = self.getBugInfoByAssignee(user)
         if isinstance(bugList, list):
            for bugDict in bugList:
               bugId = str(bugDict['id'])
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
                  fixBy = Nan
                  if detailDict['fix_by']:
                     matchObj = pattern.match(detailDict['fix_by'][0])
                     fixBy = ",".join([matchObj.group(1), matchObj.group(2), matchObj.group(3)])
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