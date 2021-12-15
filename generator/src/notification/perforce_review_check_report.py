#!/usr/bin/env python

# Copyright 2021 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.  
perforce_review_check_report.py
features:
1. notification for change without any review
2. notification for change where last review and actual submission are different
'''

import re
import datetime
from collections import defaultdict
from perforce_diff_parser import PerforceDiffParser, ReviewLinkNotFound
from review_diff_parser import ReviewDiffParser
from generator.src.utils.Utils import logExecutionTime, noIntervalPolling
from generator.src.utils.Logger import logger
from generator.src.utils.BotConst import PERFORCE_DESCRIBE_URL, REVIEWBOARD_REQUEST_URL, POST_MESSAGE_BEAR_TOKEN, \
   POST_MESSAGE_API_BY_CHANNEL, POST_MESSAGE_API_BY_USER, VSAN_SLACKBOT_MONITOR_CHANNELID

import requests
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

class CompareNotEqual(Exception):
   def __init__(self, errorInfo):
      super().__init__(self)
      logger.info(errorInfo)
      self.errorInfo = "compare unequal"
      if errorInfo.startswith("compare file list unequal"):
         self.errorInfo = "compare file list unequal"
      elif "add code unequal" in errorInfo:
         file = errorInfo.split("add code unequal")[0]
         self.errorInfo = "{0} add code unequal".format(file)
      elif "delete code unequal" in errorInfo:
         file = errorInfo.split("delete code unequal")[0]
         self.errorInfo = "{0} delete code unequal".format(file)

   def __str__(self):
      return self.errorInfo


class PerforceReviewCheckSpider(object):
   def __init__(self, args):
      self.title = args.title
      self.branchList = args.branches.split(",")
      self.branchList = [branch for branch in filter(self.isVSAN, self.branchList)]
      self.userList = args.users.split(",")
      utc7 = datetime.timezone(offset=-datetime.timedelta(hours=7))
      self.dtStartTime = datetime.datetime.fromtimestamp(args.startTime, tz=utc7)
      self.dtEndTime = datetime.datetime.fromtimestamp(args.endTime, tz=utc7)
      self.checkinTime = ""
      self.p4Parser = PerforceDiffParser()
      self.rbParser = ReviewDiffParser()

   def isVSAN(self, branch):
      '''
      the perforce path should be //depot///...
      For vSAN, project we can focus on bora, scons, vsan-mgmt-ui.
      '''
      return branch in ['bora/main', 'scons/main', 'vsan-mgmt-ui/main']

   def compareTwoDiffs(self, lastChangeDiff, lastReviewDiff):
      # check diff file count
      if len(lastChangeDiff) != len(lastReviewDiff):
         raise CompareNotEqual(f"compare file list unequal review({len(lastReviewDiff)}) change({len(lastChangeDiff)})")
      # check diff file list
      changeDiffFileList = [file for file in lastChangeDiff.keys()]
      for file in lastReviewDiff.keys():
         if file not in changeDiffFileList:
            raise CompareNotEqual(f"compare file list unequal {file}")
      for file, reviewCodes in lastReviewDiff.items():
         changeCodes = lastChangeDiff[file]
         # sort diff line no
         reviewCodes.sort(key=lambda a: a[1], reverse=False)
         changeCodes.sort(key=lambda a: a[1], reverse=False)
         # compare add diff codes
         reviewAdd = {r[1]: r[2] for r in reviewCodes if '+' == r[0]}
         changeAdd = {r[1]: r[2] for r in changeCodes if '+' == r[0]}
         addLineNoList = set(reviewAdd.keys()) & set(changeAdd.keys())
         for lineNo in addLineNoList:
            reviewCode = "#{0} {1}".format(lineNo, reviewAdd[lineNo])
            changeCode = "#{0} {1}".format(lineNo, changeAdd[lineNo])
            if reviewCode != changeCode:
               raise CompareNotEqual(f"{file} add code unequal - review({reviewCode}) change({changeCode})")
         # compare delete diff codes
         reviewDelete = {r[1]: r[2] for r in reviewCodes if '-' == r[0]}
         changeDelete = {r[1]: r[2] for r in changeCodes if '-' == r[0]}
         deleteLineNoList = set(reviewDelete.keys()) & set(changeDelete.keys())
         for lineNo in deleteLineNoList:
            reviewCode = "#{0} {1}".format(lineNo, reviewDelete[lineNo])
            changeCode = "#{0} {1}".format(lineNo, reviewDelete[lineNo])
            if reviewCode != changeCode:
               raise CompareNotEqual(f"{file} delete code unequal - review({reviewCode}) change({changeCode})")

   def getRecords(self):
      noReviews, unEquals = defaultdict(list), defaultdict(list)
      unknowns = []
      self.p4Parser.loginPerforce()
      changeList = self.p4Parser.getChanges(self.dtStartTime, self.dtEndTime, self.branchList)
      logger.info("change list count: {0}".format(len(changeList)))

      with self.rbParser:
         for change in changeList:
            if change:
               matchObj = re.match(r"Change (.*) on (.*) by (.*) '(.*)'", change)
               cln = matchObj.group(1)
               user = matchObj.group(3).split('@')[0]
               if user not in self.userList:
                  continue
               logger.info("-"*30)
               logger.info("p4 change cln={0}, user={1}".format(cln, user))
               changeTime, reviewRequestId = "", ""
               try:
                  describeList, changeTime = self.p4Parser.getDescribes(cln)
                  reviewRequestId = self.p4Parser.getReviewRequestId(describeList)
                  # reviewerList = self.p4Parser.getReviewers(describeList)
                  lastChangeDiff = self.p4Parser.getDifference(describeList)
                  lastReviewDiff = self.rbParser.getDifference(reviewRequestId)
                  # last change diff compare with last review diff
                  self.compareTwoDiffs(lastChangeDiff, lastReviewDiff)
               except ReviewLinkNotFound as e:
                  logger.info("occur review link not found: {0}".format(e))
                  noReviews[user].append((cln, changeTime))
               except CompareNotEqual as e:
                  logger.info("occur compare not equal: {0}".format(e))
                  unEquals[user].append((cln, reviewRequestId, changeTime, str(e)))
               except Exception as e:
                  logger.info("unknown exception: {0}".format(e))
                  unknowns.append(str(e))
      return noReviews, unEquals, unknowns

   def getReportByChangeOwner(self, userName, noReviewList, unEqualList):
      message = []
      message.append("*Title: {0}'s {1}*".format(userName, self.title))
      message.append("Branch: {0}".format(" & ".join(self.branchList)))
      message.append(self.checkinTime)
      if len(noReviewList) > 0:
         message.append("*The following change(s) without any review:* ")
         for info in noReviewList:
            p4Link = "<{0}|{1}>".format(PERFORCE_DESCRIBE_URL.format(info[0]), info[0])
            message.append("      #{0}  {1}".format(p4Link, info[1]))
      if len(unEqualList) > 0:
         message.append("*The following change(s) submitted are different with the last review revision：*")
         for info in unEqualList:
            p4Link = "<{0}|{1}>".format(PERFORCE_DESCRIBE_URL.format(info[0]), info[0])
            reviewLink = "<{0}|{1}>".format(REVIEWBOARD_REQUEST_URL.format(info[1]), info[1])
            message.append("      #{0}  {1}  {2}  {3}".format(p4Link, reviewLink, info[2], info[3]))
      return "\n".join(message)

   @noIntervalPolling
   def sendReportByUser(self, userName, message):
      url = POST_MESSAGE_API_BY_USER.format(userName)
      session = requests.session()
      session.headers = {"Authorization": POST_MESSAGE_BEAR_TOKEN}
      result = session.post(url, data={"text": message}, verify=False)
      logger.info("sendReportByUser response: {0}".format(result.content.decode()))

   @noIntervalPolling
   def sendReportByChannelId(self, channelId, message):
      url = POST_MESSAGE_API_BY_CHANNEL.format(channelId)
      session = requests.session()
      session.headers = {"Authorization": POST_MESSAGE_BEAR_TOKEN}
      result = session.post(url, data={"text": message}, verify=False)
      logger.info("sendReportByChannelId response: {0}".format(result.content.decode()))

   @logExecutionTime
   def sendReports(self):
      ret = ""
      noReviews, unEquals, unknowns = self.getRecords()
      if len(unknowns) > 0:
         msg = "\n".join(unknowns)
         self.sendReportByChannelId(channelId=VSAN_SLACKBOT_MONITOR_CHANNELID, message=msg)
      self.checkinTime = "Checkin Time(PST): {0} --- {1}".format(self.dtStartTime.strftime("%Y/%m/%d %H:%M:%S"),
                                                                 self.dtEndTime.strftime("%Y/%m/%d %H:%M:%S"))
      for user in self.userList:
         noReviewList = noReviews.get(user, [])
         unEqualList = unEquals.get(user, [])
         if len(noReviewList) > 0 or len(unEqualList) > 0:
            msg = self.getReportByChangeOwner(user, noReviewList, unEqualList)
            # self.sendReportByUser(userName=user, message=msg)
            ret += msg + "\n"
      if not ret:
         message = []
         message.append("*Title: {0}*".format(self.title))
         message.append("Branch: {0}".format(" & ".join(self.branchList)))
         message.append(self.checkinTime)
         message.append("I haven't found any differences between last review and actual submission.")
         return "\n".join(message)
      return ret

import argparse
def parseArgs():
   parser = argparse.ArgumentParser(description='Generate perforce review check report')
   parser.add_argument('--title', type=str, required=True, help='Title of perforce review check report')
   parser.add_argument('--branches', type=str, required=True, help='Branches of perforce review check report')
   parser.add_argument('--startTime', type=float, required=True, help='Check start time')
   parser.add_argument('--endTime', type=float, required=True, help='Check end time')
   parser.add_argument('--users', type=str, required=True, help='Users of perforce review check report')
   return parser.parse_args()

if __name__ == '__main__':
   args = parseArgs()
   spider = PerforceReviewCheckSpider(args)
   ret = spider.sendReports()
   # schedule.js wait for the stdout and send report to selected channel
   print(ret)
   logger.info(ret)
