#!/usr/bin/env python

# Copyright 2021 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.  
bugzilla_report.py
'''
import os
import re
import uuid
import datetime
import requests
from urllib import parse
from lxml import etree
import pandas as pd
import math
from generator.src.utils.BotConst import SERVICE_ACCOUNT, SERVICE_PASSWORD, BUGZILLA_DETAIL_URL
from generator.src.utils.Utils import logExecutionTime, noIntervalPolling, splitOverlengthReport, transformReport
from generator.src.utils.MiniQueryFunctions import getShortUrlsFromCacheFile, short2long
from generator.src.utils.Logger import logger

DOWNLOAD_DIR = os.path.join(os.path.abspath(__file__).split("/generator")[0], "persist/tmp")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

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

# bug summary str limit length
SUMMARY_MAX_LENGTH = 57

class BugzillaSpider(object):
   def __init__(self, args):
      self.loginUrl = "https://bugzilla.eng.vmware.com/"
      self.foreUrl = "https://bugzilla.eng.vmware.com/{}"
      self.title = parse.unquote(args.title).strip('"')
      self.buglistUrl = args.url.strip('"')
      self.session = requests.session()
      self.longUrl = ''
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

   @logExecutionTime
   def loginSystem(self):
      result = self.session.post(self.loginUrl, data={"Bugzilla_login": SERVICE_ACCOUNT,
                                                      "Bugzilla_password": SERVICE_PASSWORD})
      content = result.content.decode()
      html = etree.HTML(content)
      textList = html.xpath('//*[@id="bugzilla-body"]/div/div//text()')
      divTxts = [row.strip() for row in textList if row.strip()]
      if len(divTxts) > 0:
         if "Common Tasks" != divTxts[0]:
            logger.error(divTxts)
            raise Exception("Because of `{0}`, it can't login bugzilla system.".format(divTxts[0]))

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

   @logExecutionTime
   @noIntervalPolling
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

   @logExecutionTime
   @noIntervalPolling
   def downloadCsvFile(self, downloadUrl):
      today = datetime.datetime.today().strftime("%Y%m%d")
      csvFile = os.path.join(DOWNLOAD_DIR, "bugzilla{}_{}.csv".format(today, uuid.uuid4()))
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
            if 'error' == output:
               output = 'Export CSV occur unexpected error.'
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
      keyName = queryStr.format(*paramList)
      if "=-total-&" in keyName:
         keyName = keyName.split("=-total-&")[1]
      return keyName

   def getShortUrlDict(self, html):
      shortUrlDict = {}
      longUrlList = html.xpath('//*[@id="reportContainer"]//td//a//@href')
      if len(longUrlList) > 0:
         lastLongUrl = longUrlList[-1]
         completeLastLongUrl = self.foreUrl.format(lastLongUrl)
         urlTails = {}
         for url in longUrlList:
            longUrl = self.foreUrl.format(url)
            urlTail = longUrl.split(completeLastLongUrl)[1][1:] if url != lastLongUrl else 'Total'
            urlTail = parse.unquote(urlTail)
            urlTails[urlTail] = longUrl
         shortUrlDict = getShortUrlsFromCacheFile(fileDir=DOWNLOAD_DIR, fileKey=completeLastLongUrl,
                                                  urlTailDict=urlTails)
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

   @logExecutionTime
   def getBuglistReport(self, html):
      isNoContent = False
      bugCountInfos = html.xpath('//*[@id="buglistHeader"]/div/div[2]/h3[1]/text()')
      if not (len(bugCountInfos) > 0 and "bug" in bugCountInfos[0].lower()):
         logger.error(f"{self.buglistUrl} can't find bug count")
         raise Exception(f"I can't find bug count on <{self.buglistUrl}|bugzilla page>. "
                         f"Maybe temporary bugzilla server down.")

      message = []
      message.append("*Title: {0}*".format(self.title))
      bugCountInfoStr = bugCountInfos[0].strip().lower()
      if "one bug found" == bugCountInfoStr:
         bugCount = 1
      else:
         findRes = re.findall("(.*?) bugs found", bugCountInfoStr)
         bugCount = 0 if "no" == findRes[0] else int(findRes[0])
      logger.info("bug count: {0}".format(bugCount))
      if bugCount > 0:
         bugCountInfo = "One bug found." if 1 == bugCount else "{0} bugs found.".format(bugCount)
         message.append(bugCountInfo)
         detail = self.getBuglistDetail()
         reports = splitOverlengthReport(detail, isContentInCodeBlock=True, enablePagination=True)
         reports[0] = "\n".join(message) + reports[0]
         message = reports
      else:
         isNoContent = True
         message.append("No bugs currently.")
         message = ["\n".join(message)]
      return message, isNoContent

   def getBuglistDetail(self):
      # Keyword "#" will make downloading failed such as #buglistsort=pri,asc.
      # Replace by "&" which split each bugzilla query condition.
      self.longUrl = self.longUrl.replace('#', '&')
      downloadUrl = self.longUrl + ';ctype=csv'
      csvFile = self.downloadCsvFile(downloadUrl)
      if os.path.exists(csvFile):
         df = pd.read_csv(csvFile)
         if not df.empty:
            # drop empty columns
            df.dropna(axis=1, how='all', inplace=True)
            df.fillna(value="", inplace=True)
            # get existed column name list
            headers = df.columns.values
            logger.info('headers: {0}'.format(headers))
            summaryColumnName = 'Summary' if 'Summary' in headers else 'Summary (first 60 chars)'
            paramsLength = {'Bug ID': 7, 'Assignee': -1, 'Priority': 3, 'Status': -1, 'ETA': 10, summaryColumnName: 60}
            showParams = [k for k, v in paramsLength.items()]
            showParams = [param for param in showParams if param in headers]
            if 'Assignee' in showParams:
               paramsLength['Assignee'] = max([len(user) for user in df['Assignee'].values] + [len('Assignee')])
            if 'Status' in showParams:
               paramsLength['Status'] = max([len(status) for status in df['Status'].values] + [len('Status')])
            # default sort by 'Bug ID' column
            df = df.sort_values(by='Bug ID', ascending=True)
            # calculate column chars size
            formatList = []
            for param, length in paramsLength.items():
               if param in showParams:
                  formatList.append("{:<%ds}" % length)
            lineFormatter = formatList[0] + "  " + " ".join(formatList[1:-1]) + " {}"
            # get show column list
            nameDict = {'Bug ID': 'PR', 'Assignee': 'Assignee', 'Priority': 'Pri', 'Status': 'Status', 'ETA': 'ETA',
                        summaryColumnName: 'Summary'}
            showColumns = [name for param, name in nameDict.items() if param in headers]
            logger.info('show columns: {0}'.format(showColumns))
            # make buglist content
            messages = []
            messages.append("```" + lineFormatter.format(*showColumns))
            for _, bug in df.iterrows():
               valueList = []
               for param in showParams:
                  value = bug[param]
                  if "Bug ID" == param:
                     value = "<%s|%s>" % (BUGZILLA_DETAIL_URL + str(value), str(value))
                  elif summaryColumnName == param:
                     value = value if len(value) < SUMMARY_MAX_LENGTH else value[:SUMMARY_MAX_LENGTH] + "..."
                  valueList.append(value)
               messages.append(lineFormatter.format(*valueList))
            messages.append("```")
            return messages
         else:
            logger.info("CSV file {0}'s content is empty.".format(csvFile))
      raise Exception('View list as CSV occur unexpected error.')

   @logExecutionTime
   def getTabularReport(self, html):
      buttonName = html.xpath('//*[@id="reportContainer"]/p/a[2]/text()')
      if not (len(buttonName) > 0 and buttonName[0] == "Export CSV"):
         logger.error(f"{self.buglistUrl} can't find Export CSV button")
         raise Exception(f"I can't find Export CSV button on <{self.buglistUrl}|bugzilla page>. "
                         f"Maybe temporary bugzilla server down.")

      csvRes = self.getCsvContent(html)
      isNoContent = csvRes is "No bugs currently."
      message = []
      message.append("*Title: {0}*".format(self.title))
      if isinstance(csvRes, dict):
         shortUrlDict = self.getShortUrlDict(html)
         for tableTitle, tableDataDf in csvRes.items():
            logger.info(f"{tableTitle} table size: {tableDataDf.shape[0]}x{tableDataDf.shape[1]}")
            message.extend(self.generateTable(tableTitle, tableDataDf, shortUrlDict))
      else:
         message.append(csvRes)
      return message, isNoContent

   @logExecutionTime
   def parseHtml(self):
      self.longUrl = short2long(self.buglistUrl) if "via.vmw.com" in self.buglistUrl else self.buglistUrl
      res = self.session.get(self.buglistUrl)
      content = res.content.decode(errors='ignore')
      html = etree.HTML(content)
      return html

   @logExecutionTime
   def getReport(self):
      self.loginSystem()
      html = self.parseHtml()
      if "/buglist.cgi" in self.longUrl:  # query buglist
         message, isNoContent = self.getBuglistReport(html)
         return transformReport(messages=message, isNoContent=isNoContent, enableSplitReport=False)
      elif "/report.cgi" in self.longUrl:  # tabular
         message, isNoContent = self.getTabularReport(html)
         return transformReport(messages=message, isNoContent=isNoContent, isContentInCodeBlock=False)
      else:
         logger.error(f"Unsupported bugzilla url: {self.buglistUrl}, long url: {self.longUrl}")
         raise Exception(f"Unsupported bugzilla url: {self.buglistUrl}, long url: {self.longUrl}")


import argparse
def parseArgs():
   parser = argparse.ArgumentParser(description='Generate bugzilla report')
   parser.add_argument('--title', type=str, required=True, help='Title of bugzilla report')
   parser.add_argument('--url', type=str, required=True, help='short link of bugzilla')
   return parser.parse_args()

if __name__ == "__main__":
   args = parseArgs()
   spider = BugzillaSpider(args)
   ret = spider.getReport()
   print(ret)
   logger.info(ret)
