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
import requests
import pandas as pd
from urllib import parse
from generator.src.utils.Utils import runCmd, logExecutionTime, splitOverlengthReport, transformReport
from generator.src.utils.Logger import logger
from generator.src.utils.BotConst import SERVICE_ACCOUNT, SERVICE_PASSWORD, \
   BUGZILLA_DETAIL_URL, PERFORCE_DESCRIBE_URL, VSANCORE_DESCRIBE_URL, BUGZILLA_BASE
SUMMARY_MAX_LENGTH = 80
BUG_NUMBER_MAX_LENGTH = 18

class PerforceSpider(object):
   def __init__(self, args):
      self.p4Path = '/build/apps/bin/p4 -u {}'.format(SERVICE_ACCOUNT)
      self.title = parse.unquote(args.title).strip('"')
      self.branchList = args.branches.split(",")
      # perforce use UTC7 time. The UTC7 time is 7 hours later than the system time.
      utc7 = datetime.timezone(offset=-datetime.timedelta(hours=7))
      startTime = datetime.datetime.fromtimestamp(args.startTime, tz=utc7).strftime("%Y/%m/%d:%H:%M:%S")
      endTime = datetime.datetime.fromtimestamp(args.endTime, tz=utc7).strftime("%Y/%m/%d:%H:%M:%S")
      self.checkTime = "{0},{1}".format(startTime, endTime)
      self.userList = args.users.split(",")
      self.showTitle = '*Title: {0}*\nBranch: {1}\nCheckin Time(PST): {2} --- {3}\n'.\
         format(self.title, " & ".join(self.branchList),
                datetime.datetime.fromtimestamp(args.startTime, tz=utc7).strftime("%Y/%m/%d %H:%M"),
                datetime.datetime.fromtimestamp(args.endTime, tz=utc7).strftime("%Y/%m/%d %H:%M"))

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
         raise Exception("Because of `{0}`, p4 login failed.".format("Perforce internal error"))
      # get data from p4 change commands
      result = self.getRecords()
      # generate report
      message = []
      isNoContent = (result.empty is True)
      if not result.empty:
         result = result.sort_values(by=['assignee', 'CLN', 'checkinTime'], ascending=True)
         withApprovedMessage = self.GenerateTabluaReport(result[result['approved'] == 'with'])
         if len(withApprovedMessage) > 0:
            withApprovedReports = splitOverlengthReport(messages=withApprovedMessage, isContentInCodeBlock=True,
                                                        enablePagination=True)
            withApprovedReports[0] = self.showTitle + ':arrow_down: *With Approval*\n' + withApprovedReports[0]
            message.extend(withApprovedReports)
         withoutApprovedMessage = self.GenerateTabluaReport(result[result['approved'] == 'without'])
         if len(withoutApprovedMessage) > 0:
            withoutApprovedReports = splitOverlengthReport(messages=withoutApprovedMessage, isContentInCodeBlock=True,
                                                           enablePagination=True)
            withoutApprovedReports[0] = ':arrow_down: *`Without Approval`*\n' + withoutApprovedReports[0]
            if len(message) == 0:
               withoutApprovedReports[0] = self.showTitle + withoutApprovedReports[0]
            message.extend(withoutApprovedReports)
      else:
         message.append(self.showTitle + 'No Changes.')
      return transformReport(messages=message, isNoContent=isNoContent, enableSplitReport=False)

   def GenerateTabluaReport(self, result):
      message = []
      if result.empty:
         return message
      assignees = set(result['assignee'].values.tolist())
      userNameColumnLength = max([len(user) for user in assignees] + [len("User")])
      bugIDColumnLength = max([len(pr) for pr in result['PR'].values] + [len("Bug Number")])
      if bugIDColumnLength > BUG_NUMBER_MAX_LENGTH:
         bugIDColumnLength = BUG_NUMBER_MAX_LENGTH
      columnLength = {"User": userNameColumnLength, "CLN": 8, "Time": 11, "PR": bugIDColumnLength}
      headerFormatter = "{:>%ds} -- {:<%ds}  {:<%ds}  {:<%ds}  {}" % \
                        (columnLength["User"], columnLength["CLN"], columnLength["Time"], columnLength["PR"])
      message.append("```" + headerFormatter.format("User", "CLN", "Time", "Bug Number", "Summary"))
      userName = ''
      for _, data in result.iterrows():
         user = data['assignee']
         cln = "<{0}|{1}>".format(PERFORCE_DESCRIBE_URL.format(data['CLN']), data['CLN'])
         bugNumbers = data['PR']
         bugIDColumnLength = columnLength["PR"]
         if len(bugNumbers) > 0:
            bugLinks = []
            bugIDs = bugNumbers.split(",")
            for bugId in bugIDs[:2]:
               if bugId.startswith("VSANCORE"):
                  bugLink = VSANCORE_DESCRIBE_URL.format(bugId)
               else:
                  bugLink = BUGZILLA_DETAIL_URL + bugId
               bugLinks.append("<{0}|{1}>".format(bugLink, bugId))
            bugNumbers = ",".join(bugLinks)
            unformattedPrStr = data['PR']
            if len(bugIDs) > 2:
               bugNumbers += "..."
               unformattedPrStr = ",".join(bugIDs[:2]) + "..."
            # pr column length = formatted_PR_length + original_column_length - unformatted_PR_length
            bugIDColumnLength = len(bugNumbers) + columnLength["PR"] - len(unformattedPrStr)
         if userName == user:
            bodyFormatter = " " * columnLength["User"] + "    {:<%ds}  {:<%ds}  {:<%ds}  {}" % \
                            (columnLength["CLN"], columnLength["Time"], bugIDColumnLength)
            message.append(bodyFormatter.format(cln, data['checkinTime'], bugNumbers, data['summary']))
         else:
            headerFormatter = "{:>%ds} -- {:<%ds}  {:<%ds}  {:<%ds}  {}" % \
                              (columnLength["User"], columnLength["CLN"], columnLength["Time"], bugIDColumnLength)
            message.append(headerFormatter.format(data['assignee'], cln, data['checkinTime'], bugNumbers,
                                                  data['summary']))
            userName = user
      message.append('```')
      return message

   def getRecords(self):
      formatStr = "//depot/{}/...@{}"
      branchStr = " ".join([formatStr.format(branch, self.checkTime) for branch in self.branchList])
      if len(self.userList) == 1:
         user = self.userList[0]
         cmd = '{0} changes -s submitted -u {1} {2} | /bin/grep -v "CBOT"'.format(self.p4Path, user, branchStr)
      else:
         cmd = '{0} changes -s submitted {1} | /bin/grep -v "CBOT"'.format(self.p4Path, branchStr)
      logger.info(cmd)

      result = pd.DataFrame()
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
                  result = result.append(detail, ignore_index=True)
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
      timeStr = matchObj.group(3)
      try:  # change time example: 2022/06/14 03:44:29
         checkinTime = datetime.datetime.strptime(timeStr, "%Y/%m/%d %H:%M:%S").strftime("%b%d %H:%M")
      except:
         checkinTime = ""
      summary = recordList[2].strip()
      #  please avoid lines longer than 80 chars.
      summary = summary if len(summary) < SUMMARY_MAX_LENGTH else summary[:SUMMARY_MAX_LENGTH - 3] + '...'
      bugIDs = []
      isCheckinApproved = False
      for record in recordList:
         if "Bug Number:" in record:
            bugNumbers = record.split("Bug Number:")[1].replace(' ', '').upper()
            # filter PRs and VSANCORE IDs
            findIDs = re.findall(r"\d+", bugNumbers)
            PRs = []
            for findID in findIDs:
               vsancoreId = "VSANCORE-" + findID
               if vsancoreId in bugNumbers:
                  bugIDs.append(vsancoreId)
               else:
                  bugIDs.append(findID)
                  PRs.append(findID)
            # PR with keyword `CheckinApproved` or not
            if self.CheckCheckinApproved(PRs):
               isCheckinApproved = True
            break
      return {'assignee': user, 'CLN': cln, 'checkinTime': checkinTime, 'PR': ",".join(set(bugIDs)),
              'approved': 'with' if isCheckinApproved else 'without', 'summary': summary}

   def CheckCheckinApproved(self, PRs):
      isCheckinApproved = False
      for bugId in PRs:
         bugzilla_detail_url = BUGZILLA_BASE + str(bugId)
         res = requests.get(bugzilla_detail_url, auth=(SERVICE_ACCOUNT, SERVICE_PASSWORD))
         bugDetail = res.json().get('bugs')[0]
         keywords = [k.strip() for k in bugDetail.get('keywords', '').split(',')]
         if 'CheckinApproved' in keywords:
            isCheckinApproved = True
            break
      return isCheckinApproved

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
