#!/usr/bin/env python

# Copyright 2021 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.  
bugzilla_report.py
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
import math
from generator.src.utils.BotConst import BUGZILLA_ACCOUNT, BUGZILLA_PASSWORD
from generator.src.utils.Utils import logExecutionTime, noIntervalPolling
from generator.src.utils.MiniQueryFunctions import long2short, short2long
from generator.src.utils.Logger import logger

downloadDir = os.path.join(os.path.abspath(__file__).split("/generator")[0], "persist/tmp")
os.makedirs(downloadDir, exist_ok=True)

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
      self.lettersWidth = {'a': 2, 'b': 2, 'c': 2, 'd': 2, 'e': 2, 'f': 1.5, 'g': 2, 'h': 2, 'i': 0.5, 'j': 1, 'k': 2,
                           'l': 0.5, 'm': 3, 'n': 2, 'o': 2, 'p': 2, 'q': 2, 'r': 1.5, 's': 2, 't': 1.5, 'u': 2,
                           'v': 2, 'w': 3, 'x': 2, 'y': 2, 'z': 2, 'A': 2.5, 'B': 2, 'C': 2, 'D': 2.5, 'E': 2, 'F': 2,
                           'G': 3, 'H': 3, 'I': 0.5, 'J': 2, 'K': 3, 'L': 2, 'M': 3, 'N': 2, 'O': 3, 'P': 2, 'Q': 3,
                           'R': 2, 'S': 2, 'T': 2, 'U': 2, 'V': 3, 'W': 4, 'X': 3, 'Y': 2, 'Z': 2, '0': 2, '1': 2,
                           '2': 2, '3': 2, '4': 2, '5': 2, '6': 2, '7': 2, '8': 2, '9': 2, '!': 1, '"': 1, '#': 2.5,
                           '$': 2.5, '%': 3, '&': 3, "'": 0.5, '(': 1, ')': 1, '*': 1.5, '+': 2, ',': 1, '-': 1,
                           '.': 0.5, '/': 1.5, ':': 0.5, ';': 1, '<': 2, '=': 2.5, '>': 2, '?': 1.5, '@': 3, '[': 1,
                           '\\': 2, ']': 1, '^': 2, '_': 2, '`': 1, '{': 1, '|': 0.5, '}': 1, '~': 2.5}

   def loginSystem(self):
      result = self.session.post(self.loginUrl, data={"Bugzilla_login": BUGZILLA_ACCOUNT,
                                                      "Bugzilla_password": BUGZILLA_PASSWORD})
      content = result.content.decode()
      html = etree.HTML(content)
      textList = html.xpath('//*[@id="bugzilla-body"]/div/div//text()')
      divTxts = [row.strip() for row in textList if row.strip()]
      if len(divTxts) > 0:
         if "Common Tasks" != divTxts[0]:
            logger.error(divTxts)
            raise Exception(divTxts[0])

   def regularizeTable(self, df):
      columnList = df.columns.values.tolist()[1:]
      df = df.set_index(df.columns[0])  # set index by first column
      df[columnList] = df[columnList].astype('int')  # ensure value's type is int
      df.loc['Total'] = [df[col].sum() for col in columnList]  # Horizontal Total
      df['Total'] = [rowSeries.sum() for _, rowSeries in df.iterrows()]  # Vertical Total
      # swap rows and columns if columns size more than double rows size
      indexName = df.index.name
      verticalAxis, horizontalAxis = indexName.strip(), ''
      isTranspose = False
      if '/' in indexName:
         verticalAxis = indexName.split('/')[0].strip()
         horizontalAxis = indexName.split('/')[1].replace('"', '').strip()
         isTranspose = df.shape[1] > df.shape[0] * 2
         if isTranspose:
            df = df.T
            verticalAxis, horizontalAxis = horizontalAxis, verticalAxis
         df.index.name = '{0}/{1}'.format(verticalAxis, horizontalAxis)
      df = df[df['Total'] > 0]  # drop count=0 lines
      if len(columnList) == 1:
         df = df.sort_values(by="Total", axis=0, ascending=False)
         df = df.drop(columns=['Total'])
      else:
         df = df.sort_values(by="Total", axis=0, ascending=False)  # descending sort
      return df, isTranspose, axis2param.get(verticalAxis, ''), axis2param.get(horizontalAxis, '')

   def getSplitTable(self, csvFile):
      df = pd.read_csv(csvFile, header=None)
      splitLineDf = df[df[0].str.contains('/') & df[0].str.contains(':')]
      # get split table's title and index range
      pattern = re.compile(r'(.*): "(.*)""(.*)" / "(.*)"', re.M | re.I)
      splitIndexRange, outputTitleList = [], []
      multiAxis = ''
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
      dfDict, isTranspose, ver, hor = {}, False, '', ''
      for indexRange, title in zip(splitIndexRange, outputTitleList):
         start, end = indexRange[0], indexRange[1]
         tableTitle, firstColumnName = title[0], title[1]
         dfData = df.loc[start + 1:end]
         partDf = pd.DataFrame(dfData.values, columns=[firstColumnName] + columnList)
         dfDict[tableTitle], isTranspose, ver, hor = self.regularizeTable(partDf)
      return dfDict, isTranspose, axis2param.get(multiAxis, ''), ver, hor

   def readCsvFile(self, csvFile):
      df = pd.read_csv(csvFile)
      firstHeaderName = df.columns.values[0]
      if '/' in firstHeaderName and ':' in firstHeaderName:  # multiple table & vertical axis & horizontal axis
         dfDict, isTranspose, mult, ver, hor = self.getSplitTable(csvFile)
         self.indexQueryStr = '%s={0}&%s={1}' % (mult, ver)
         self.columnQueryStr = '%s={0}&%s={1}' % (mult, hor)
         self.countQueryStr = '%s={0}&%s={1}&%s={2}' % (mult, ver, hor) if not isTranspose \
            else '%s={0}&%s={2}&%s={1}' % (mult, hor, ver)
      else:
         df, isTranspose, ver, hor = self.regularizeTable(df)
         self.indexQueryStr = '%s={0}' % ver
         self.columnQueryStr = '%s={0}' % hor
         self.countQueryStr = '%s={0}&%s={1}' % (ver, hor) if not isTranspose else '%s={1}&%s={0}' % (hor, ver)
         dfDict = {'single': df}
      return dfDict

   @noIntervalPolling
   def downloadCsvFile(self, downloadUrl):
      today = datetime.datetime.today().strftime("%Y%m%d")
      csvFile = os.path.join(downloadDir, "bugzilla{}_{}.csv".format(today, uuid.uuid4()))
      content = self.session.get(downloadUrl).content
      content = content.strip()
      logger.info("download csv content size: {0}".format(len(content)))
      if len(content) > 0:
         with open(csvFile, "wb") as f:
            f.write(content)  # Export CSV
         logger.info("download csv file: {0}".format(csvFile))
         return csvFile
      return "empty"

   def getCsvContent(self, html):
      output = "No bugs currently."
      hrefList = html.xpath('//*[@id="reportContainer"]/p/a[2]/@href')
      if len(hrefList) > 0:
         downloadUrl = self.foreUrl.format(hrefList[0])
         csvFile = self.downloadCsvFile(downloadUrl)
         if 'error' == csvFile:
            output = 'Export CSV occur unexpected error.'
         elif 'empty' == csvFile:
            pass
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
         completeLastLongUrl = self.foreUrl.format(lastLongUrl)
         key = hashlib.sha256(completeLastLongUrl.encode()).hexdigest()
         pklFile = os.path.join(downloadDir, f"{key}.pkl")
         shortUrlDict = self.readMemoryShortUrl(pklFile)
         for url in longUrlList:
            longUrl = self.foreUrl.format(url)
            urlTail = longUrl.split(completeLastLongUrl)[1][1:] if url != lastLongUrl else 'Total'
            urlTail = parse.unquote(urlTail)
            shortUrlDict[urlTail] = shortUrlDict.get(urlTail) if shortUrlDict.get(urlTail) else long2short(longUrl)
         self.writeMemoryShortUrl(pklFile, shortUrlDict)
      return shortUrlDict

   def outputSimpleTable(self, dfData, shortUrlDict):
      indexNameList = dfData.index.values.tolist() if dfData.index.values.tolist() else []
      columnName = dfData.columns.values.tolist()[0]
      indexName = dfData.index.name
      indexName = indexName.split('/')[0].strip() if '/' in indexName else indexName
      message = []
      message.append('Count         {0}'.format(indexName))
      message.append('---------------------------')
      for indexName in indexNameList:
         count = dfData.loc[indexName][columnName]
         shortUrlKey = self.getKeyName(indexName, columnName)
         shortUrl = '' if 0 == count else shortUrlDict.get(shortUrlKey, '')
         resultLine = '<%s|%s>' % (shortUrl, str(count)) if shortUrl else str(count)
         resultLine += '                '
         if int(count) < 100:
            resultLine += '  '
         if int(count) < 10:
            resultLine += '  '
         resultLine += indexName
         message.append(resultLine)
      return message

   def generateTable(self, title, dfData, shortUrlDict):
      multiValue = '' if "single" == title else title.split(':')[1].strip()
      message = [] if "single" == title else [title]
      columnNameList = dfData.columns.values.tolist() if dfData.columns.values.tolist() else []
      firstHeaderName = dfData.index.name
      if 1 == len(columnNameList):
         return self.outputSimpleTable(dfData, shortUrlDict)

      columnLens = {columnName: math.floor(sum([self.lettersWidth.get(c, 1) for c in columnName]))
                    for columnName in columnNameList}
      indexNameList = dfData.index.values.tolist() if dfData.index.values.tolist() else []
      message.append("{0}  |  {1}".format("  ".join(columnNameList), firstHeaderName.split("/")[0]))
      for indexName in indexNameList:
         tableRowList = []
         formatList = []
         for columnName in columnNameList:
            count = dfData.loc[indexName][columnName]
            shortUrlKey = self.getKeyName(indexName, columnName, multiValue)
            columnLength = columnLens[columnName]
            if 0 == count:  # replace 0 into -
               shortUrl = ''
               countWithLink = '-'
               columnLength += 1
            else:
               shortUrl = shortUrlDict.get(shortUrlKey, '')
               countWithLink = '<%s|%s>' % (shortUrl, str(count)) if shortUrl else str(count)
            tableRowList.append(countWithLink)
            formatList.append("{:<%ds}" % (len('<%s|>' % shortUrl) + columnLength - len(str(count)) + 1
                                           if shortUrl else columnLength))
         tableRowList.append(indexName)
         lineFormatter = "  ".join(formatList) + "    {}"
         message.append(lineFormatter.format(*tableRowList))
      return message

   def getBuglistReport(self, html):
      message = []
      try:
         bugCountInfos = html.xpath('//*[@id="buglistHeader"]/div/div[2]/h3[1]/text()')
         bugCountInfoStr = bugCountInfos[0].strip().lower()
         if "one bug found" == bugCountInfoStr:
            message.append('%s : <%s|%s>' % (self.title, self.buglistUrl, 1))
         else:
            findRes = re.findall("(.*?) bugs found", bugCountInfoStr)
            bugCount = 0 if "no" == findRes[0] else int(findRes[0])
            message.append('%s : <%s|%s>' % (self.title, self.buglistUrl, bugCount))
      except Exception as e:
         logger.error(f"{self.buglistUrl} query buglist error: {e}")
         message.append(":warning: temporary bugzilla server down.")
      return message

   def getTabularReport(self, html):
      buttonName = html.xpath('//*[@id="reportContainer"]/p/a[2]/text()')
      if not (len(buttonName) > 0 and buttonName[0] == "Export CSV"):
         logger.error(f"{self.buglistUrl} can't find Export CSV button")
         return [":warning: temporary bugzilla server down."]

      csvRes = self.getCsvContent(html)
      message = []
      message.append("*Title: {0}*".format(self.title))
      if isinstance(csvRes, dict):
         shortUrlDict = self.getShortUrlDict(html)
         for tableTitle, tableDataDf in csvRes.items():
            logger.info(f"{tableTitle} table size: {tableDataDf.shape[0]}x{tableDataDf.shape[1]}")
            message.extend(self.generateTable(tableTitle, tableDataDf, shortUrlDict))
      else:
         message.append(csvRes)
      return message

   @logExecutionTime
   def getReport(self):
      try:
         self.loginSystem()
      except Exception as e:
         logger.debug(f"Error happened in generating bugzilla report: Because of {e}, it can't login bugzilla system.")
         return f":warning: Because of `{e}`, it can't login bugzilla system."

      longUrl = short2long(self.buglistUrl) if "via.vmw.com" in self.buglistUrl else self.buglistUrl
      res = self.session.get(self.buglistUrl)
      content = res.content.decode()
      html = etree.HTML(content)

      if "/buglist.cgi" in longUrl:  # query buglist
         message = self.getBuglistReport(html)
      elif "/report.cgi" in longUrl:  # tabular
         message = self.getTabularReport(html)
      else:
         logger.debug(f"Unsupported bugzilla url: {self.buglistUrl}, long url: {longUrl}")
         message = [":warning: Unsupported bugzilla url."]
      report = "\n".join(message)
      return report


import argparse
def parseArgs():
   parser = argparse.ArgumentParser(description='Generate bugzilla report')
   parser.add_argument('--title', type=str, required=True, help='Title of bugzilla report')
   parser.add_argument('--url', type=str, required=True, help='short link of bugzilla')
   return parser.parse_args()

if __name__ == "__main__":
   args = parseArgs()
   try:
      spider = BugzillaSpider(args)
      ret = spider.getReport()
      print(ret)
      logger.info(ret)
   except Exception as e:
      from generator.src.utils.MiniQueryFunctions import postMessageByChannelId
      from generator.src.utils.BotConst import VSAN_SLACKBOT_MONITOR_CHANNELID
      nowTime = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
      errorMsg = "Time: {0}, *{1}* Bugzilla report generator occur issue:\n{2}".format(nowTime, args.title, str(e))
      postMessageByChannelId(channelId=VSAN_SLACKBOT_MONITOR_CHANNELID, message=errorMsg)
