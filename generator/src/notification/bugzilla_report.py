#!/usr/bin/env python

# Copyright 2021 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.  
bugzilla_assignee_report.py
'''
import os
import re
import uuid
import hashlib
import pickle
import datetime
import requests
from urllib import parse
from lxml import etree
import pandas as pd
from generator.src.utils.BotConst import BUGZILLA_ACCOUNT, BUGZILLA_PASSWORD
from generator.src.utils.Utils import removeOldFiles, logExecutionTime, noIntervalPolling
from generator.src.utils.MiniQueryFunctions import long2short
from generator.src.utils.Logger import logger

downloadDir = os.path.join(os.path.abspath(__file__).split("/generator")[0], "persist/tmp")
if not os.path.exists(downloadDir):
   os.mkdir(downloadDir)

# transfer Horizontal/Vertical Axis name to query param
axis2param = {
   'Assignee': 'assigned_to',
   'Category': 'category',
   'Component': 'component',
   'Guest OS': 'guest_op_sys',
   'Hardware': 'rep_platform',
   'Host OS': 'host_op_sys',
   'Priority': 'priority',
   'Product': 'product',
   'QA Contact': 'qa_contact',
   'Reporter': 'reporter',
   'Resolution': 'resolution',
   'Reverity': 'bug_severity',
   'Status': 'bug_status',
   'Votes': 'votes'
}

class BugzillaSpider(object):
   def __init__(self, args):
      self.loginUrl = "https://bugzilla.eng.vmware.com/"
      self.foreUrl = "https://bugzilla.eng.vmware.com/{}"
      self.title = args.title.strip('"')
      self.buglistUrl = args.url.strip('"')
      self.session = requests.session()
      self.indexQueryStr = ''
      self.columnQueryStr = ''
      self.countQueryStr = ''

   def __del__(self):
      removeOldFiles(downloadDir, 1, "bugzilla")

   def loginSystem(self):
      self.session.post(self.loginUrl, data={"Bugzilla_login": BUGZILLA_ACCOUNT,
                                             "Bugzilla_password": BUGZILLA_PASSWORD})

   def regularizeTable(self, df):
      columnList = df.columns.values.tolist()[1:]
      df = df.set_index(df.columns[0])  # set index by first column
      df[columnList] = df[columnList].astype('int')  # ensure value's type is int
      df.loc['Total'] = [df[col].sum() for col in columnList]  # Horizontal Total
      df['Total'] = [rowSeries.sum() for _, rowSeries in df.iterrows()]  # Vertical Total
      df = df[df['Total'] > 0]  # drop count=0 lines
      df = df.sort_values(by="Total", axis=0, ascending=True)
      # df = df.sort_values(by="Total", axis=1, ascending=True)  # sort by Horizontal Total?
      if len(columnList) == 1 and columnList[0] == 'Number of bugs':
         df = df.drop(columns=['Total'])
      return df

   def getSplitTable(self, csvFile):
      df = pd.read_csv(csvFile, header=None)
      splitLineDf = df[df[0].str.contains('/') & df[0].str.contains(':')]
      # get split table's title and index range
      pattern = re.compile(r'(.*): "(.*)""(.*)" / "(.*)"', re.M | re.I)
      splitIndexRange, outputTitleList = [], []
      multiAxis, verticalAxis, horizontalAxis = '', '', ''
      start = -1
      for index, title in splitLineDf[0].items():
         matchObj = pattern.match(title)
         multiAxis, multiValue = matchObj.group(1), matchObj.group(2)
         verticalAxis, horizontalAxis = matchObj.group(3), matchObj.group(4)
         outputTitleList.append(
            ("{}: {}".format(multiAxis, multiValue), "{}/{}".format(verticalAxis, horizontalAxis)))
         splitIndexRange.append((start, index - 1))
         start = index
      splitIndexRange.append((start, df.shape[0] - 1))
      splitIndexRange.pop(0)
      # regular table with title and index range
      columnList = splitLineDf.loc[0].values.tolist()[1:]
      dfDict = {}
      for indexRange, title in zip(splitIndexRange, outputTitleList):
         start, end = indexRange[0], indexRange[1]
         tableTitle, firstColumnName = title[0], title[1]
         dfData = df.loc[start + 1:end]
         partDf = pd.DataFrame(dfData.values, columns=[firstColumnName] + columnList)
         dfDict[tableTitle] = self.regularizeTable(partDf)
      return dfDict, multiAxis, verticalAxis, horizontalAxis

   def readCsvFile(self, csvFile):
      df = pd.read_csv(csvFile)
      firstHeaderName = df.columns.values[0]
      if '/' in firstHeaderName and ':' in firstHeaderName:  # multiple table & vertical axis & horizontal axis
         dfDict, multiAxis, verticalAxis, horizontalAxis = self.getSplitTable(csvFile)
         mult, ver, hor = axis2param.get(multiAxis, ''), axis2param.get(verticalAxis, ''), \
                          axis2param.get(horizontalAxis, '')
         self.indexQueryStr = '%s={0}&%s={1}' % (mult, ver)
         self.columnQueryStr = '%s={0}&%s={1}' % (mult, hor)
         self.countQueryStr = '%s={0}&%s={1}&%s={2}' % (mult, ver, hor)
      else:
         df = self.regularizeTable(df)
         indexName = df.index.name
         if '/' in indexName:  # vertical axis & horizontal axis
            verticalAxis = indexName.split('/')[0].strip()
            horizontalAxis = indexName.split('/')[1].replace('"', '').strip()
            df.index.name = '{0}/{1}'.format(verticalAxis, horizontalAxis)
         else:  # vertical axis | horizontal axis
            verticalAxis, horizontalAxis = indexName.strip(), ''
         ver, hor = axis2param.get(verticalAxis, ''), axis2param.get(horizontalAxis, '')
         self.indexQueryStr = '%s={0}' % ver
         self.columnQueryStr = '%s={0}' % hor
         self.countQueryStr = '%s={0}&%s={1}' % (ver, hor)
         dfDict = {'single': df}
      return dfDict

   @noIntervalPolling
   def downloadCsvFile(self, downloadUrl):
      today = datetime.datetime.today().strftime("%Y%m%d")
      csvFile = os.path.join(downloadDir, "bugzilla{}_{}.csv".format(today, uuid.uuid4()))
      with open(csvFile, "wb") as f:
         f.write(self.session.get(downloadUrl).content)  # Export CSV
      return csvFile

   def getCsvContent(self, html):
      output = "No bugs currently."
      hrefList = html.xpath('//*[@id="reportContainer"]/p/a[2]/@href')
      if len(hrefList) > 0:
         downloadUrl = self.foreUrl.format(hrefList[0])
         csvFile = self.downloadCsvFile(downloadUrl)
         if 'error' == csvFile:
            output = 'Export CSV occur unexpected error.'
         elif os.path.exists(csvFile):
            output = self.readCsvFile(csvFile)
      return output

   def getKeyName(self, indexName, columnName, multiValue=''):
      paramList = [multiValue] if multiValue else []
      if 'Total' == indexName and columnName in ('Total', 'Number of bugs'):
         return 'Total'
      elif 'Total' == indexName:
         queryStr = self.columnQueryStr
         paramList.append(columnName)
      elif columnName in ('Total', 'Number of bugs'):
         queryStr = self.indexQueryStr
         paramList.append(indexName)
      else:
         queryStr = self.countQueryStr
         paramList.append(indexName)
         paramList.append(columnName)
      return queryStr.format(*paramList).replace("category=-total-&", "")

   def readMemoryShortUrl(self, pklFile):
      if os.path.exists(pklFile):
         with open(pklFile, 'rb') as f:
            return pickle.load(f)
      return {}

   def writeMemoryShortUrl(self, pklFile, urlDict):
      with open(pklFile, 'wb') as f:
         pickle.dump(urlDict, f)

   def getShortUrlDict(self, html):
      shortUrlDict = {}
      longUrlList = html.xpath('//*[@id="reportContainer"]//td//a//@href')
      if len(longUrlList) > 0:
         lastLongUrl = longUrlList[-1]
         completeLastLongUrl = self.foreUrl.format(parse.unquote(lastLongUrl))
         key = hashlib.sha256(completeLastLongUrl.encode()).hexdigest()
         pklFile = os.path.join(downloadDir, f"{key}.pkl")
         shortUrlDict = self.readMemoryShortUrl(pklFile)
         for url in longUrlList:
            longUrl = self.foreUrl.format(parse.unquote(url))
            urlTail = longUrl.split(completeLastLongUrl)[1][1:] if url != lastLongUrl else 'Total'
            shortUrlDict[urlTail] = shortUrlDict.get(urlTail) if shortUrlDict.get(urlTail) else long2short(longUrl)
         self.writeMemoryShortUrl(pklFile, shortUrlDict)
      return shortUrlDict

   def generateTable(self, title, dfData, shortUrlDict):
      multiValue = '' if "single" == title else title.split(':')[1].strip()
      message = [] if "single" == title else [title]
      message.append("```")
      indexNameList = dfData.index.values.tolist() if dfData.index.values.tolist() else []
      columnNameList = dfData.columns.values.tolist() if dfData.columns.values.tolist() else []
      firstHeaderName = dfData.index.name
      nameLen = max([len(name) for name in [firstHeaderName] + indexNameList])
      lineFormatter = "{:<%ds}   " % nameLen
      for columnName in columnNameList:
         lineFormatter += "{:>%ds}  " % len(columnName)
      tableHeaderList = [firstHeaderName] + columnNameList
      message.append(lineFormatter.format(*tableHeaderList))
      for indexName in indexNameList:
         tableRowList = [indexName]
         lineFormatter = "{:<%ds}   " % nameLen
         for columnName in columnNameList:
            count = dfData.loc[indexName][columnName]
            shortUrlKey = self.getKeyName(indexName, columnName, multiValue)
            shortUrl = '' if 0 == count else shortUrlDict.get(shortUrlKey, '')
            countWithLink = '<%s|%s>' % (shortUrl, str(count)) if shortUrl else str(count)
            tableRowList.append(countWithLink)
            lineFormatter += "{:>%ds}  " % (len('<%s|>' % shortUrl + columnName) if shortUrl else len(columnName))
         message.append(lineFormatter.format(*tableRowList))
      message.append("```")
      return message

   @logExecutionTime
   def getReport(self):
      self.loginSystem()
      res = self.session.get(self.buglistUrl)
      content = res.content.decode()
      html = etree.HTML(content)

      csvRes = self.getCsvContent(html)
      message = []
      message.append("Title: " + self.title)
      if isinstance(csvRes, dict):
         shortUrlDict = self.getShortUrlDict(html)
         for tableTitle, tableDataDf in csvRes.items():
            logger.info(f"{tableTitle} table size: {tableDataDf.shape[0]}x{tableDataDf.shape[1]}")
            message.extend(self.generateTable(tableTitle, tableDataDf, shortUrlDict))
      else:
         message.append(csvRes)
      report = "\n".join(message)
      return report

import argparse
def parseArgs():
   parser = argparse.ArgumentParser(description='Generate bugzilla assignee report')
   parser.add_argument('--title', type=str, required=True, help='Title of bugzilla assignee report')
   parser.add_argument('--url', type=str, required=True, help='short link of bugzilla')
   return parser.parse_args()

if __name__ == "__main__":
   args = parseArgs()
   spider = BugzillaSpider(args)
   ret = spider.getReport()
   print(ret)
   logger.info(ret)
