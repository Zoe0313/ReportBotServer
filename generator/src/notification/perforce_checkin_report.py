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
from urllib import parse
import argparse
from generator.src.utils.Utils import runCmd, logExecutionTime, splitOverlengthReport, transformReport
from generator.src.utils.Logger import logger
from generator.src.utils.BotConst import SERVICE_ACCOUNT, SERVICE_PASSWORD, \
   BUGZILLA_DETAIL_URL, PERFORCE_DESCRIBE_URL, JIRA_BROWSE_URL, BUGZILLA_BASE, REVIEWBOARD_REQUEST_URL
from generator.src.utils.Logger import PerfLogger
PerfLogger.info('import python packages and customized parameters, functions')

ReviewIDPattern = re.compile(REVIEWBOARD_REQUEST_URL.format("(\d{7,})"), re.I)
SUMMARY_MAX_LENGTH = 60
INVAILD_ID = '--'

class PerforceSpider(object):
   @logExecutionTime
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
      self.isNeedCheckinApproved = (args.needCheckinApproved == 'Yes')
      self.showTitle = '*Title: {0}*\nBranch: {1}\nCheckin Time(PST): {2} --- {3}\n'.\
         format(self.title, " & ".join(self.branchList),
                datetime.datetime.fromtimestamp(args.startTime, tz=utc7).strftime("%Y/%m/%d %H:%M"),
                datetime.datetime.fromtimestamp(args.endTime, tz=utc7).strftime("%Y/%m/%d %H:%M"))

   @logExecutionTime
   def LoginSystem(self):
      os.environ['P4CONFIG'] = ""
      os.environ['P4USER'] = SERVICE_ACCOUNT
      os.environ['P4PORT'] = "ssl:perforce.eng.vmware.com:1666"
      cmdStr = "echo 'yes' | /build/apps/bin/p4 trust"
      stdout, stderr, returncode = runCmd(cmdStr)
      assert returncode == 0, "Failed to execute command:{}".format(cmdStr)
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
   def GetReport(self):
      if not self.LoginSystem():
         raise Exception("Because of `{0}`, p4 login failed.".format("Perforce internal error"))
      # get data from p4 change commands
      result = self.GetRecords()
      # generate report
      message = []
      isNoContent = (len(result) == 0)
      if len(result) > 0:
         result = sorted(result, key=lambda data: (data['assignee'], data['CLN'], data['checkinTime']))
         if self.isNeedCheckinApproved:
            # With Approval
            withApprovedResult = list(filter(lambda data: data['approved'] == 'with', result))
            withApprovedMessage = self.GenerateTabularReport(withApprovedResult)
            if len(withApprovedMessage) > 0:
               withApprovedReports = splitOverlengthReport(messages=withApprovedMessage, isContentInCodeBlock=True,
                                                           enablePagination=True)
               withApprovedReports[0] = self.showTitle + ':arrow_down: *With Approval*\n' + withApprovedReports[0]
               message.extend(withApprovedReports)
            # Without Approval
            withoutApprovedResult = list(filter(lambda data: data['approved'] == 'without', result))
            withoutApprovedMessage = self.GenerateTabularReport(withoutApprovedResult)
            if len(withoutApprovedMessage) > 0:
               withoutApprovedReports = splitOverlengthReport(messages=withoutApprovedMessage, isContentInCodeBlock=True,
                                                              enablePagination=True)
               withoutApprovedReports[0] = ':arrow_down: *`Without Approval`*\n' + withoutApprovedReports[0]
               if len(message) == 0:
                  withoutApprovedReports[0] = self.showTitle + withoutApprovedReports[0]
               message.extend(withoutApprovedReports)
         else:
            allMessage = self.GenerateTabularReport(result)
            allReports = splitOverlengthReport(messages=allMessage, isContentInCodeBlock=True, enablePagination=True)
            allReports[0] = self.showTitle + allReports[0]
            message.extend(allReports)
      else:
         message.append(self.showTitle + 'No Changes.')
      return transformReport(messages=message, isNoContent=isNoContent, enableSplitReport=False)

   def GenerateTabularReport(self, checkinDatas):
      message = []
      if len(checkinDatas) == 0:
         return message
      # New column order: User  Bug Link  CLN  Time  Review URL  Summary
      UserColumnLength = max(max([len(data['assignee']) for data in checkinDatas]), len("User"))
      BugNumberColumnLength = max(max([len(data['bugIDs']) for data in checkinDatas]), len("Bug Link"))
      ReviewURLColumnLength = max(max([len(data['reviewIDs']) for data in checkinDatas]), len("Review URL"))
      columnLength = {"User": UserColumnLength, "Bug Link": BugNumberColumnLength, "CLN": 8,
                      "Time": 11, "Review URL": ReviewURLColumnLength, "Summary": 0}
      headerFormatter = "{:>%ds}  {:<%ds}  {:<%ds}  {:<%ds}  {:<%ds}  {}" % \
                        (columnLength["User"], columnLength["Bug Link"], columnLength["CLN"],
                         columnLength["Time"], columnLength["Review URL"])
      message.append('```' + headerFormatter.format("User", "Bug Link", "CLN", "Time", "Review URL", "Summary"))
      userName = ''
      for data in checkinDatas:
         user = data['assignee']
         cln = "<{0}|{1}>".format(PERFORCE_DESCRIBE_URL.format(data['CLN']), data['CLN'])
         checkinTime = data['checkinTime']
         summary = data['summary']
         # calculate bug link column with, add bugzilla or jira link
         displayBugNumber = INVAILD_ID
         BugNumberColumnLength = columnLength["Bug Link"]
         if len(data['bugIDs']) > 0 and len(data['bugIDs'].split(",")) > 0:
            bugNumbers = data['bugIDs'].split(",")
            BugNumberLinks = []
            PRs = list(filter(lambda bugNumber: "-" not in bugNumber, bugNumbers))
            if len(PRs) > 0:
               BugNumberLinks += ["<%s|%s>" % (BUGZILLA_DETAIL_URL + PR, PR) for PR in PRs]
            jiraIDs = list(filter(lambda bugNumber: "-" in bugNumber, bugNumbers))
            if len(jiraIDs) > 0:
               BugNumberLinks += ["<%s|%s>" % (JIRA_BROWSE_URL.format(jiraID), jiraID) for jiraID in jiraIDs]
            displayBugNumber = ",".join(BugNumberLinks)
            # pr column length = formatted_PR_length + original_column_length - unformatted_PR_length
            BugNumberColumnLength = len(displayBugNumber) + columnLength["Bug Link"] - len(data['bugIDs'])
         # calculate review url column width, add review board link
         displayReviewURL = INVAILD_ID
         ReviewURLColumnLength = columnLength["Review URL"]
         if len(data['reviewIDs']) > 0 and len(data['reviewIDs'].split(",")) > 0:
            reviewIDs = data['reviewIDs'].split(",")
            ReviewURLs = ["<%s|%s>" % (REVIEWBOARD_REQUEST_URL.format(reviewID), reviewID) for reviewID in reviewIDs]
            displayReviewURL = ",".join(ReviewURLs)
            ReviewURLColumnLength = len(displayReviewURL) + columnLength["Review URL"] - len(data['reviewIDs'])
         if userName == user:
            bodyFormatter = " " * columnLength["User"] + "  {:<%ds}  {:<%ds}  {:<%ds}  {:<%ds}  {}" % \
                            (BugNumberColumnLength, columnLength["CLN"], columnLength["Time"], ReviewURLColumnLength)
            message.append(bodyFormatter.format(displayBugNumber, cln, checkinTime, displayReviewURL, summary))
         else:
            headerFormatter = "{:>%ds}  {:<%ds}  {:<%ds}  {:<%ds}  {:<%ds}  {}" % \
                              (columnLength["User"], BugNumberColumnLength, columnLength["CLN"], columnLength["Time"],
                               ReviewURLColumnLength)
            message.append(headerFormatter.format(user, displayBugNumber, cln, checkinTime, displayReviewURL, summary))
            userName = user
      message.append('```')
      return message

   @logExecutionTime
   def GetRecords(self):
      formatStr = "//depot/{}/...@{}"
      branchStr = " ".join([formatStr.format(branch, self.checkTime) for branch in self.branchList])
      if len(self.userList) == 1:
         user = self.userList[0]
         cmd = '{0} changes -s submitted -u {1} {2} | /bin/grep -v "CBOT"'.format(self.p4Path, user, branchStr)
      else:
         cmd = '{0} changes -s submitted {1} | /bin/grep -v "CBOT"'.format(self.p4Path, branchStr)
      logger.info(cmd)

      checkinDatas = []
      stdout, stderr, returncode = runCmd(cmd)
      if returncode != 0:
         logger.debug("p4 changes stderr: {0}, returncode: {1}".format(stderr, returncode))
         return checkinDatas

      deduplicatedCLN = set()
      stdout = stdout.decode('utf-8')
      recordList = stdout.split('\n')
      logger.debug(f"Record count: {len(recordList)}")
      for record in recordList:
         if record:
            matchObj = re.match(r"Change (.*) on (.*) by (.*) '(.*)'", record, re.M | re.I)
            cln = matchObj.group(1)
            user = matchObj.group(3).split('@')[0]
            if user in self.userList:
               deduplicatedCLN.add(cln)
      for cln in deduplicatedCLN:
         detail = self.GetDetail(cln)
         if detail:
            checkinDatas.append(detail)
      return checkinDatas

   @logExecutionTime
   def GetDetail(self, queryCln):
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
      bugIDs, reviewIDs = [], []
      isCheckinApproved = False
      for record in recordList:
         record = record.lstrip()
         if record.startswith("Bug Number:"):
            bugNumberStr = record.split("Bug Number:")[1].strip().upper()
            # replace non-capital letter and number and '-' symbols with ','
            bugNumberStr = re.sub(r"[^A-Z0-9-]", ",", bugNumberStr)
            bugIDs = [bugNumber.strip() for bugNumber in bugNumberStr.split(',') if len(bugNumber.strip()) > 0]
            jiraIDs = set([bugId for bugId in bugIDs if '-' in bugId])  # jira bug number must with '-'
            PRs = set([bugId for bugId in bugIDs if '-' not in bugId])
            bugIDs = (list(PRs) + list(jiraIDs))[:2]
            if len(PRs) > 0 and self.isNeedCheckinApproved:
               # PR with keyword `CheckinApproved` or not
               if self.CheckCheckinApproved(PRs):
                  isCheckinApproved = True
         elif record.startswith("Review URL:"):
            reviewIDs = list(set(ReviewIDPattern.findall(record)))[:2]
      return {'assignee': user, 'CLN': cln, 'checkinTime': checkinTime,
              'approved': 'with' if isCheckinApproved else 'without', 'summary': summary,
              'bugIDs': ",".join(bugIDs), 'reviewIDs': ",".join(reviewIDs)}

   @logExecutionTime
   def CheckCheckinApproved(self, PRs):
      isCheckinApproved = False
      for bugId in PRs:
         bugzilla_detail_url = BUGZILLA_BASE + str(bugId)
         try:
            res = requests.get(bugzilla_detail_url, auth=(SERVICE_ACCOUNT, SERVICE_PASSWORD)).json()
            if res.get('status'):
               statusCode = res.get('status')
               message = res.get('message', '')
               raise Exception(f"status code:{statusCode}, {message}")
            bugDetail = res.get('bugs', [])[0]
            keywords = [k.strip() for k in bugDetail.get('keywords', '').split(',')]
            if 'CheckinApproved' in keywords:
               isCheckinApproved = True
               break
         except Exception as e:
            logger.error('Query bugzilla API error: {0}'.format(e))
      return isCheckinApproved

@logExecutionTime
def parseArgs():
   parser = argparse.ArgumentParser(description='Generate perforce report')
   parser.add_argument('--title', type=str, required=True, help='Title of perforce report')
   parser.add_argument('--branches', type=str, required=True, help='Branches of perforce report')
   parser.add_argument('--startTime', type=float, required=True, help='Check start time')
   parser.add_argument('--endTime', type=float, required=True, help='Check end time')
   parser.add_argument('--users', type=str, required=True, help='Users of perforce report')
   parser.add_argument('--needCheckinApproved', type=str, required=True, help='Need checkin approved or not')
   return parser.parse_args()

if __name__ == '__main__':
   args = parseArgs()
   spider = PerforceSpider(args)
   ret = spider.GetReport()
   print(ret)
   logger.info(ret)
