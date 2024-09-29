#!/usr/bin/env python

# Copyright 2024 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.  
bugzilla_web_parser.py
'''

import os
import re
import uuid
import requests
import datetime
from lxml import etree
from generator.src.utils.Logger import logger
from generator.src.utils.BotConst import SERVICE_ACCOUNT, SERVICE_PASSWORD
from generator.src.utils.Utils import logExecutionTime

BUGZILLA_DOMAIN_NAME = "https://bugzilla-vcf.lvn.broadcom.net/"
DOWNLOAD_DIR = os.path.join(os.path.abspath(__file__).split("/generator")[0], "persist/tmp/bugzilla-report")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

class BugzillaUtils(object):
   __instance = None
   __isInit = False

   def __new__(cls):
      if not cls.__instance:
         BugzillaUtils.__instance = super().__new__(cls)
      return cls.__instance

   def __init__(self):
      if not self.__isInit:
         self._session = self.getSession()
         BugzillaUtils.__isInit = True
      self.html = None
      
   def getSession(self):
      logger.debug("Login bugzilla system")
      try:
         reqData = {"Bugzilla_login": SERVICE_ACCOUNT, "Bugzilla_password": SERVICE_PASSWORD}
         session = requests.session()
         response = session.post(BUGZILLA_DOMAIN_NAME, data=reqData)
         content = response.content.decode()
         html = etree.HTML(content)
         textList = html.xpath('//*[@id="bugzilla-body"]/div/div//text()')
         divTxts = [row.strip() for row in textList if row.strip()]
         if "Common Tasks" != divTxts[0]:
            logger.error(divTxts)
            raise Exception("Because of `{0}`, it can't login bugzilla system.".format(divTxts[0]))
         return session
      except Exception:
         logger.error("Failed to login bugzilla because of not find `Common Tasks`")
         raise Exception("I can't login %s now. "
                         "Maybe temporary bugzilla server down." % BUGZILLA_DOMAIN_NAME)

   def getHtml(self, bugzillaLink):
      response = self._session.get(bugzillaLink)
      content = response.content.decode(errors='ignore')
      return etree.HTML(content)

   def resetHtml(self):
      self.html = None

   def parseHtml(self, bugzillaLink):
      if self.html is None:
         try:
            self.html = self.getHtml(bugzillaLink)
         except Exception as e:
            logger.error('Failed to parse html: %s' % e)
            self._session = self.getSession()
            self.html = self.getHtml(bugzillaLink)

   def downloadCsvFile(self, downloadUrl):
      todayStr = datetime.datetime.today().strftime("%Y%m%d")
      csvFile = os.path.join(DOWNLOAD_DIR, "bugzilla{0}_{1}.csv".format(todayStr, uuid.uuid4()))
      content = self._session.get(downloadUrl).content.strip()
      if len(content) > 0:  # check the content of csv file
         with open(csvFile, "wb") as f:
            f.write(content)
         logger.info("Succeed to download csv file: {0}".format(csvFile))
      return csvFile

   @logExecutionTime
   def GetBuglistCount(self, buglistLink):
      try:
         self.parseHtml(buglistLink)
         bugCountInfos = self.html.xpath('//*[@id="buglistHeader"]/div/div[2]/h3[1]/text()')
         bugCountInfoStr = bugCountInfos[0].strip().lower()
         if "one bug found" == bugCountInfoStr:
            bugCount = 1
         else:
            findRes = re.findall("(.*?) bugs found", bugCountInfoStr)
            bugCount = 0 if "no" == findRes[0] else int(findRes[0])
         logger.info("bug count = %s" % bugCount)
         return bugCount
      except Exception as e:
         logger.error("Failed to get buglist count: %s" % e)
         raise Exception("I can't find bug count on <%s|bugzilla page>. "
                         "Maybe temporary bugzilla server down." % buglistLink)

   @logExecutionTime
   def ExportCSV(self, reportLink):
      # Find "Export CSV" button shows on /report.cgi bugzilla page
      try:
         self.parseHtml(reportLink)
         buttonNames = self.html.xpath('//*[@id="reportContainer"]/p/a[2]/text()')
         if "Export CSV" != buttonNames[0]:
            raise Exception
      except Exception:
         logger.error("Failed to find `Export CSV` button")
         raise Exception("I can't find `Export CSV` button on <%s|bugzilla page>. "
                         "Maybe temporary bugzilla server down." % reportLink)
      # Find download url and download CSV file
      downloadUrl = ""
      try:
         href = self.html.xpath('//*[@id="reportContainer"]/p/a[2]/@href')[0]
         downloadUrl = BUGZILLA_DOMAIN_NAME + href
         csvFile = self.downloadCsvFile(downloadUrl)
      except Exception:
         logger.error("Failed to download CSV file")
         raise Exception("I can't download CSV file. "
                         "Maybe <%s|download link> is wrong." % downloadUrl)
      return csvFile

   @logExecutionTime
   def Viewlist(self, buglistLink):
      # # Keyword "#" will make downloading failed such as #buglistsort=pri,asc.
      # # Replace by "&" which split each bugzilla query condition.
      # buglistLink = buglistLink.replace('#', '&')
      # downloadUrl = buglistLink + ';ctype=csv'
      # csvFile = self.downloadCsvFile(downloadUrl)
      # return csvFile
      # Find "View list" button shows on /buglist.cgi bugzilla page
      try:
         self.parseHtml(buglistLink)
         buttonName = self.html.xpath('//*[@id="buglistHeader"]/div/div[1]/div[2]/input/@value')[0]
         if "View list" != buttonName:
            raise Exception
      except Exception:
         logger.error("Failed to find `View list` button")
         raise Exception("I can't find `View list` button on <%s|bugzilla page>. "
                         "Maybe temporary bugzilla server down." % buglistLink)
      # Find download url and download CSV file
      downloadUrl = ""
      try:
         script = self.html.xpath('//*[@id="buglistHeader"]/div/div[1]/script/text()')[0]
         href = re.findall('href = "(.*?);ctype=csv";', script)[0] + ";ctype=csv"
         downloadUrl = BUGZILLA_DOMAIN_NAME + href
         csvFile = self.downloadCsvFile(downloadUrl)
      except Exception:
         logger.error("Failed to download CSV file")
         raise Exception("I can't download CSV file. "
                         "Maybe <%s|download link> is wrong." % downloadUrl)
      return csvFile

   @logExecutionTime
   def GetTabularHrefs(self, reportLink):
      try:
         self.parseHtml(reportLink)
         longUrlList = self.html.xpath('//*[@id="reportContainer"]//td//a//@href')
      except Exception:
         raise Exception("Failed to get all href links of tabular report")
      return longUrlList
