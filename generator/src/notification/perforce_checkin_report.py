# !/usr/bin/env python

# Copyright 2021 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.
perforce_checkin_report.py
'''

import os
import re
import time
import datetime
from collections import defaultdict, namedtuple
from generator.src.utils.Utils import runCmd, logExecutionTime
from generator.src.utils.Logger import logger
from generator.src.utils.BotConst import SERVICE_ACCOUNT, SERVICE_PASSWORD
Record = namedtuple('Record', ['cln', 'summary', 'user', 'time', 'bugId'])
USER_NAME_MAX_LENGTH = 20
SUMMARY_MAX_LENGTH = 80

class PerforceSpider(object):
   def __init__(self, args):
      self.p4Path = '/build/apps/bin/p4 -u {}'.format(SERVICE_ACCOUNT)
      self.title = args.title.strip('"')
      self.branchList = args.branches.split(",")
      # perforce use UTC7 time. The UTC7 time is 7 hours later than the system time.
      utc7 = datetime.timezone(offset=-datetime.timedelta(hours=7))
      startTime = datetime.datetime.fromtimestamp(args.startTime, tz=utc7).strftime("%Y/%m/%d:%H:%M:%S")
      endTime = datetime.datetime.fromtimestamp(args.endTime, tz=utc7).strftime("%Y/%m/%d:%H:%M:%S")
      self.checkTime = "{0},{1}".format(startTime, endTime)
      self.userList = args.users.split(",")
      self.showTitle = '*Title: {0}*\nBranch: {1}\nCheckin Time(PST): {2} --- {3}'.\
         format(self.title, " & ".join(self.branchList), startTime, endTime)

   def loginSystem(self):
      os.environ['P4CONFIG'] = ""
      os.environ['P4USER'] = SERVICE_ACCOUNT
      cmdStr = "echo '{0}' | {1} login".format(SERVICE_PASSWORD, self.p4Path)
      isLogin = False
      for i in range(1, 4):
         stdout, stderr, returncode = runCmd(cmdStr)
         if returncode != 0:
            logger.debug("p4 login stderr: {0}, returncode: {1}, execute times: {2}".format(stderr, returncode, i))
            time.sleep(0.5)
         else:
            isLogin = True
            break
      return isLogin

   @logExecutionTime
   def getReport(self):
      if not self.loginSystem():
         return "Perforce internal error"

      message = []
      message.append(self.showTitle)
      message.append("```")
      result = self.getRecords()
      if result:
         userNameLength = max([len(user) for user in result.keys()])
         columnLength = {"User": 10, "CLN": 10, "Time": 22, "PR": 16}
         if userNameLength < columnLength["User"]:
            columnLength["User"] = userNameLength
         elif columnLength["User"] < userNameLength < USER_NAME_MAX_LENGTH:
            columnLength["User"] = userNameLength
         headerFormatter = "{:>%ds}  --  {:<%ds}{:<%ds}{:<%ds}{}" % \
                            (columnLength["User"], columnLength["CLN"], columnLength["Time"], columnLength["PR"])
         bodyFormatter = " " * (columnLength["User"] + 6) + "{:<%ds}{:<%ds}{:<%ds}{}" % \
                          (columnLength["CLN"], columnLength["Time"], columnLength["PR"])
         message.append(headerFormatter.format("User", "CLN", "Time", "Bug Number", "Summary"))

         userName = ''
         for user in self.userList:
            recordList = result.get(user, [])
            recordList.sort(key=lambda a: a.cln, reverse=True)
            for record in recordList:
               # please avoid lines longer than 80 chars.
               showSummary = record.summary if len(record.summary) < SUMMARY_MAX_LENGTH else record.summary[:SUMMARY_MAX_LENGTH - 3] + '...'
               if userName == user:
                  message.append(bodyFormatter.format(record.cln, record.time, record.bugId, showSummary))
               else:
                  showName = user if len(user) < USER_NAME_MAX_LENGTH else user[:columnLength["User"] - 3] + '...'
                  message.append(headerFormatter.format(showName, record.cln, record.time, record.bugId, showSummary))
                  userName = user
      else:
         message.append("No Changes.")

      message.append("```")
      report = "\n".join(message)
      report = report.replace("'", "").replace('"', "")
      return report

   def getRecords(self):
      formatStr = "//depot/{}/...@{}"
      branchStr = " ".join([formatStr.format(branch, self.checkTime) for branch in self.branchList])
      if len(self.userList) == 1:
         user = self.userList[0]
         cmd = '{0} changes -s submitted -u {1} {2} | /bin/grep -v "CBOT"'.format(self.p4Path, user, branchStr)
      else:
         cmd = '{0} changes -s submitted {1} | /bin/grep -v "CBOT"'.format(self.p4Path, branchStr)
      logger.info(cmd)

      result = defaultdict(list)
      stdout, stderr, returncode = runCmd(cmd)
      if returncode != 0:
         logger.debug("p4 changes stderr: {0}, returncode: {1}".format(stderr, returncode))
         return result

      stdout = stdout.decode('utf-8')
      recordList = stdout.split('\n')
      logger.debug(f"Record count: {len(recordList)}")
      for record in recordList:
         if record:
            matchObj = re.match(r"Change (.*) on (.*) by (.*) '(.*)'", record, re.M | re.I)
            cln = matchObj.group(1)
            user = matchObj.group(3).split('@')[0]
            if user in self.userList:
               detail = self.getDetail(cln)
               if detail:
                  result[user].append(detail)
      return result

   def getDetail(self, queryCln):
      cmd = '{0} describe -s {1}'.format(self.p4Path, queryCln)
      stdout, stderr, returncode = runCmd(cmd)
      if returncode != 0:
         logger.debug("p4 describe error: {0}, returncode: {1}".format(stderr, returncode))
         return None

      stdout = stdout.decode('utf-8')
      recordList = stdout.split('\n')
      matchObj = re.match(r"Change (.*) by (.*) on (.*)", recordList[0], re.M | re.I)
      cln = matchObj.group(1)
      user = matchObj.group(2).split('@')[0]
      time = matchObj.group(3)
      summary = recordList[2].strip()
      bugId = ''
      for record in recordList:
         if "Bug Number:" in record:
            bugId = record.split("Bug Number:")[1].replace(' ', '')
            break
      return Record(cln, summary, user, time, bugId)

import argparse
def parseArgs():
   parser = argparse.ArgumentParser(description='Generate perforce report')
   parser.add_argument('--title', type=str, required=True, help='Title of perforce report')
   parser.add_argument('--branches', type=str, required=True, help='Branches of perforce report')
   parser.add_argument('--startTime', type=float, required=True, help='Check start time')
   parser.add_argument('--endTime', type=float, required=True, help='Check end time')
   parser.add_argument('--users', type=str, required=True, help='Users of perforce report')
   return parser.parse_args()

if __name__ == '__main__':
   args = parseArgs()
   spider = PerforceSpider(args)
   ret = spider.getReport()
   print(ret)
   logger.info(ret)
