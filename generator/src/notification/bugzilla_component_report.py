# !/usr/bin/env python

# Copyright 2021 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.
bugzilla_component_report.py
'''
import os
import re
import json
import datetime
import requests
from urllib import parse
from lxml import etree
import pandas as pd
from generator.src.utils.BotConst import BUGZILLA_ACCOUNT, BUGZILLA_PASSWORD
from generator.src.utils.Utils import removeOldFiles, printRunningTime
from generator.src.utils.MiniQueryFunctions import long2short
from generator.src.utils.Logger import logger

downloadDir = os.path.join(os.path.abspath(__file__).split("/generator")[0], "download")
if not os.path.exists(downloadDir):
   os.mkdir(downloadDir)

class BugzillaComponentSpider(object):
   def __init__(self, args):
      self.loginUrl = "https://bugzilla.eng.vmware.com/"
      self.foreUrl = "https://bugzilla.eng.vmware.com/{}"
      self.title = args.title.strip('"')
      self.buglistUrl = args.url
      self.session = requests.session()

   def __del__(self):
      removeOldFiles(downloadDir, 1, "report")

   def loginSystem(self):
      self.session.post(self.loginUrl, data={"Bugzilla_login": BUGZILLA_ACCOUNT,
                                             "Bugzilla_password": BUGZILLA_PASSWORD})

   def getCacheFile(self):
      encodedUrl = self.buglistUrl.encode()
      hashUrl = hashlib.sha256(encodedUrl)
      jsonFile = os.path.join(downloadDir, hashUrl.hexdigest() + ".json")
      logger.debug("cache filename:" + jsonFile)
      return jsonFile

   def downloadReportFile(self, downloadUrl):
      '''download [Export CSV]'''
      currentTime = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
      csvFile = os.path.join(downloadDir, "report_{}.csv".format(currentTime))
      with open(csvFile, "wb") as f:
         f.write(self.session.get(downloadUrl).content)
      return csvFile

   def getComponent2Count(self, html):
      component2count = {}
      hrefList = html.xpath('//*[@id="reportContainer"]/p/a[2]/@href')
      if len(hrefList) > 0:
         reportFile = self.downloadReportFile(self.foreUrl.format(hrefList[0]))
         component2count = {k: v for k, v in pd.read_csv(reportFile).values}
      return component2count

   def getMemoryShortUrl(self):
      jsonFile = getCacheFile()
      if os.path.exists(jsonFile):
         with open(jsonFile, 'rt') as f:
            component2shortUrl = json.load(f)
      return component2shortUrl

   def getComponent2ShortUrl(self, html):
      component2shortUrl = self.getMemoryShortUrl()

      longUrlList = html.xpath('//*[@id="reportContainer"]//td//a//@href')
      isChanged = False
      for url in longUrlList:
         longUrl = self.foreUrl.format(parse.unquote(url))
         matchObj = re.search(r'component=(.*)', longUrl, re.M | re.I)
         componentName = matchObj.group(1) if matchObj else "Total"
         if componentName not in component2shortUrl.keys():
            component2shortUrl[componentName] = long2short(longUrl)
            isChanged = True

      if isChanged:
         jsonFile = getCacheFile()
         with open(jsonFile, 'wt') as f:
            json.dump(component2shortUrl, f)
      return component2shortUrl

   @printRunningTime
   def getReport(self):
      self.loginSystem()

      res = self.session.get(self.buglistUrl)
      content = res.content.decode()
      html = etree.HTML(content)

      component2count, component2shortUrl = {}, {}
      try:
         component2count = self.getComponent2Count(html)
      except Exception as e:
         logger.error(f"getComponent2Count error: {e}")

      message = []
      message.append("Title: "+self.title)
      message.append("```")
      if not component2count:
          message.append("No bugs, quit now.")
      else:
         logger.info(f"bugzilla component count: {len(component2count)}")
         try:
            component2shortUrl = self.getComponent2ShortUrl(html)
         except Exception as e:
            logger.error(f"getComponent2ShortUrl error: {e}")

         nameLen = max([len(name) for name in component2count.keys()]) + 2
         lineFormatter = "{:>%ds}   {}" % nameLen
         message.append(lineFormatter.format("Component", "Count"))
         message.append("-"*(nameLen+8))

         for componentName, count in sorted(component2count.items(), key=lambda item: int(item[1]), reverse=True):
            if int(count) <= 0:
               continue
            shortUrl = component2shortUrl.get(componentName, None)
            countWithLink = '<%s|%s>' % (shortUrl, count) if shortUrl else str(count)
            message.append(lineFormatter.format(componentName, countWithLink))

      message.append("```")
      report = "\n".join(message)
      report = report.replace("'", "").replace('"', "")
      return report


import argparse
def parseArgs():
   parser = argparse.ArgumentParser(description='Generate bugzilla component report')
   parser.add_argument('--title', type=str, required=True, help='Title of bugzilla component report')
   parser.add_argument('--url', type=str, required=True, help='short link of bugzilla')
   return parser.parse_args()


if __name__ == "__main__":
   args = parseArgs()
   spider = BugzillaComponentSpider(args)
   ret = spider.getReport()
   print(ret)
   logger.info(ret)
