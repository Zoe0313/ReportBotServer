#!/usr/bin/env python

# Copyright 2021 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.  
svs_pass_rate_report.py
'''
import requests
import datetime
from generator.src.utils.Utils import logExecutionTime, noIntervalPolling
from generator.src.utils.Logger import logger

class SVSPassRateSpider(object):
   def __init__(self, args):
      self.title = args.title
      self.testCaseList = args.tests.split(',')
      self.currentTime = datetime.datetime.now()
      self.runTimes = [20, 50, 100]
      self.passRateQueryUrl = "https://svs.eng.vmware.com/api/v1.1/testsuites/?runs={0}&branch=main&name__in={1}"
      self.userQueryUrl = "https://devhub.eng.vmware.com/legacy/#/svs/testsuite/{0}?runs={1}&branch=main"

   @noIntervalPolling
   def getPassPercentage(self, url):
      res = requests.get(url)
      return res.json().get('objects')[0].get('pass_percentage', 0)

   @logExecutionTime
   def getReport(self):
      message = []
      message.append("*Title: {0}*".format(self.title))

      columnWidth = 7
      lineFormatter = "{:<%d}{:<%d}{:<%d}{}" % (columnWidth+2, columnWidth+2, columnWidth+1)
      message.append(lineFormatter.format(20, 50, 100, "test name"))
      for testCase in self.testCaseList:
         tableRowlist = []
         lineFormatter = ""
         for rateLine in ("20", "50", "100"):
            passRate = self.getPassPercentage(self.passRateQueryUrl.format(rateLine, testCase))
            if isinstance(passRate, int):
               passRateStr = "{:2.0f}%".format(passRate)
               if passRate > 50:
                  tableRowlist.append(passRateStr)
                  lineFormatter += "{:<%d}" % columnWidth
               else:
                  queryUrl = self.userQueryUrl.format(testCase, rateLine)
                  countWithLink = "<%s|%s>" % (queryUrl, passRateStr)
                  tableRowlist.append(countWithLink)
                  lineFormatter += "{:<%d}" % (len("<%s|>" % queryUrl) + columnWidth)
            else:
               tableRowlist.append('Nan')
               lineFormatter += "{:<%d}" % columnWidth
         tableRowlist.append(testCase)
         lineFormatter += "{}"
         message.append(lineFormatter.format(*tableRowlist))

      report = "\n".join(message)
      report = report.replace("'", "").replace('"', "")
      return report

import argparse
def parseArgs():
   parser = argparse.ArgumentParser(description='Generate SVS pass rate report')
   parser.add_argument('--title', type=str, required=True, help='Title of SVS pass rate report')
   parser.add_argument('--tests', type=str, required=True, help='Test name list')
   return parser.parse_args()

if __name__ == '__main__':
   args = parseArgs()
   spider = SVSPassRateSpider(args)
   ret = spider.getReport()
   print(ret)
   logger.info(ret)
