#!/usr/bin/env python

# Copyright 2021 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.  
bugzilla_report.py
'''

import os
import re
from urllib import parse
import math
import argparse
import pandas as pd
from generator.src.notification.bugzilla_web_parser import BugzillaUtils, BUGZILLA_DOMAIN_NAME, DOWNLOAD_DIR
from generator.src.utils.BotConst import BUGZILLA_DETAIL_URL, SUMMARY_MAX_LENGTH
from generator.src.utils.Utils import logExecutionTime, noIntervalPolling, splitOverlengthReport, transformReport
from generator.src.utils.MiniQueryFunctions import short2long, \
   getShortUrlsFromCacheFile, getLastPRsFromCacheFile, updatePRsInCacheFile
from generator.src.utils.Logger import logger

# transfer Horizontal/Vertical Axis name to query param
Axis2param = {
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

# use to calculate tabular column width
LettersWidth = {'a': 2, 'b': 2, 'c': 2, 'd': 2, 'e': 2, 'f': 1.5, 'g': 2, 'h': 2, 'i': 0.5, 'j': 1, 'k': 2,
                'l': 0.5, 'm': 3, 'n': 2, 'o': 2, 'p': 2, 'q': 2, 'r': 1.5, 's': 2, 't': 1.5, 'u': 2,
                'v': 2, 'w': 3, 'x': 2, 'y': 2, 'z': 2, 'A': 2.5, 'B': 2, 'C': 2, 'D': 2.5, 'E': 2, 'F': 2,
                'G': 3, 'H': 3, 'I': 0.5, 'J': 2, 'K': 3, 'L': 2, 'M': 3, 'N': 2, 'O': 3, 'P': 2, 'Q': 3,
                'R': 2, 'S': 2, 'T': 2, 'U': 2, 'V': 3, 'W': 4, 'X': 3, 'Y': 2, 'Z': 2, '0': 2, '1': 2,
                '2': 2, '3': 2, '4': 2, '5': 2, '6': 2, '7': 2, '8': 2, '9': 2, '!': 1, '"': 1, '#': 2.5,
                '$': 2.5, '%': 3, '&': 3, "'": 0.5, '(': 1, ')': 1, '*': 1.5, '+': 2, ',': 1, '-': 1,
                '.': 0.5, '/': 1.5, ':': 0.5, ';': 1, '<': 2, '=': 2.5, '>': 2, '?': 1.5, '@': 3, '[': 1,
                '\\': 2, ']': 1, '^': 2, '_': 2, '`': 1, '{': 1, '|': 0.5, '}': 1, '~': 2.5}

class BugzillaSpider(object):
   def __init__(self, args):
      self.bugzilla = BugzillaUtils()
      self.title = parse.unquote(args.title).strip('"')
      self.originalUrl = args.url.strip('"')
      self.isList2table = args.list2table == 'Yes'
      self.isFoldMessage = args.foldMessage == 'Yes'
      self.isSendPrDiff = args.sendIfPRDiff == 'Yes'
      self.longUrl = self.parseUrl(self.originalUrl)
      self.indexQueryStr = ''
      self.columnQueryStr = ''
      self.countQueryStr = ''

   def parseUrl(self, bugzillaLink):
      longUrl = short2long(bugzillaLink) if "vsanvia.broadcom.net" in bugzillaLink else bugzillaLink
      if self.isList2table:
         longUrl = longUrl.replace('https://bugzilla-vcf.lvn.broadcom.net/buglist.cgi?',
                                   'https://bugzilla-vcf.lvn.broadcom.net/report.cgi?'
                                   'format=table&action=wrap&x_axis_field=component&y_axis_field=&z_axis_field=&query_format=report-table&')
      return longUrl

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
      return df, isTranspose, Axis2param.get(verticalAxis, ''), Axis2param.get(horizontalAxis, '')

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
      return dfDict, isTranspose, Axis2param.get(multiAxis, ''), ver, hor

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

   def getShortUrlDict(self):
      shortUrlDict = {}
      completeLastLongUrl = ''
      longUrlList = self.bugzilla.GetTabularHrefs(self.longUrl)
      if len(longUrlList) > 0:
         lastLongUrl = longUrlList[-1]
         completeLastLongUrl = BUGZILLA_DOMAIN_NAME + lastLongUrl
         urlTails = {}
         for url in longUrlList:
            longUrl = BUGZILLA_DOMAIN_NAME + url
            urlTail = longUrl.split(completeLastLongUrl)[1][1:] if url != lastLongUrl else 'Total'
            urlTail = parse.unquote(urlTail)
            urlTails[urlTail] = longUrl
         shortUrlDict = getShortUrlsFromCacheFile(fileDir=DOWNLOAD_DIR, fileKey=completeLastLongUrl,
                                                  urlTailDict=urlTails)
      return shortUrlDict, completeLastLongUrl

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

      columnLens = {columnName: math.floor(sum([LettersWidth.get(c, 1) for c in columnName]))
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
   def getBuglistReport(self):
      isNoContent = False
      message, threadMessage = [], []
      message.append("*Title: {0}*".format(self.title))
      bugCount = self.bugzilla.GetBuglistCount(self.longUrl)
      if bugCount > 0:
         bugCountInfo = "One bug found." if 1 == bugCount else "{0} bugs found.".format(bugCount)
         if self.isFoldMessage:
            bugCountInfo += ' <%s|link>' % self.originalUrl
         message.append(bugCountInfo)
         detail = self.getBuglistDetail()
         detailReports = splitOverlengthReport(detail, isContentInCodeBlock=False, enablePagination=True)
         if self.isFoldMessage:
            threadMessage = detailReports
            message = ["\n".join(message)]
         else:
            detailReports[0] = "\n".join(message) + "\n" + detailReports[0]
            message = detailReports
      else:
         isNoContent = True
         message.append("No bugs currently.")
         message = ["\n".join(message)]
      if self.isSendPrDiff:
         lastPRs = self.getLastPRs()
         nowPRs = self.persistCurrentPRs(self.longUrl)
         nowPRSet = set(nowPRs)
         lastPRSet = set(lastPRs)
         if nowPRSet == lastPRSet:
            logger.info("Current PRs are no difference from last PRs")
            return [], [], True
         logger.info(f"Current PRs {nowPRSet} are difference from last PRs {lastPRSet}")
      return message, threadMessage, isNoContent

   def getBuglistDetail(self):
      csvFile = self.bugzilla.Viewlist(self.longUrl)
      if os.path.exists(csvFile):
         df = pd.read_csv(csvFile)
         if not df.empty:
            # drop empty columns
            df.dropna(axis=1, how='all', inplace=True)
            df.fillna(value="", inplace=True)
            # default sort by 'Bug ID' column
            df = df.sort_values(by='Bug ID', ascending=True)
            # get existed column name list
            headers = list(df.columns.values)
            logger.info('headers: {0}'.format(headers))
            summaryColumnName = 'Summary' if 'Summary' in headers else 'Summary (first 60 chars)'
            # display column names
            displayLimitDict = {'Bug ID': 'PR', summaryColumnName: 'Summary',
                                'Assignee': 'Assignee', 'Priority': 'Pri', 'Status': 'Status', 'ETA': 'ETA',
                                'Product': 'Product', 'Category': 'Category', 'Component': 'Comp',
                                'Component Manager': 'Comp Mgr'}
            # generate buglist content
            messages = []
            for _, bug in df.iterrows():
               line = ""
               for columnName, displayName in displayLimitDict.items():
                  if columnName not in headers:
                     continue
                  value = bug[columnName]
                  if "Bug ID" == columnName:
                     value = str(value)
                     line = "<%s|PR%s>" % (BUGZILLA_DETAIL_URL + value, value)
                  elif summaryColumnName == columnName:
                     value = value if len(value) < SUMMARY_MAX_LENGTH else value[:SUMMARY_MAX_LENGTH] + "..."
                     line += " - " + value + "\n                        "
                  else:
                     line += "_%s_: %s " % (displayName, value)
               messages.append(line)
            return messages
         else:
            logger.info("CSV file {0}'s content is empty.".format(csvFile))
      raise Exception('View list as CSV occur unexpected error.')

   @logExecutionTime
   def getTabularReport(self):
      try:
         csvFile = self.bugzilla.ExportCSV(self.longUrl)
         csvRes = "No bugs currently."
         if os.path.exists(csvFile):
            csvRes = self.readCsvFile(csvFile)
            if 'error' == csvRes:
               csvRes = 'Export CSV occur unexpected error.'
      except Exception:
         csvRes = 'Export CSV occur unexpected error.'

      totalBugzillaListUrl = ''
      isNoContent = csvRes is "No bugs currently."
      message = []
      message.append("*Title: {0}*".format(self.title))
      if isinstance(csvRes, dict):
         shortUrlDict, totalBugzillaListUrl = self.getShortUrlDict()
         for tableTitle, tableDataDf in csvRes.items():
            logger.info(f"{tableTitle} table size: {tableDataDf.shape[0]}x{tableDataDf.shape[1]}")
            message.extend(self.generateTable(tableTitle, tableDataDf, shortUrlDict))
      else:
         message.append(csvRes)
      if self.isSendPrDiff:
         lastPRs = self.getLastPRs()
         nowPRs = self.persistCurrentPRs(totalBugzillaListUrl)
         nowPRSet = set(nowPRs)
         lastPRSet = set(lastPRs)
         if nowPRSet == lastPRSet:
            logger.info("Current PRs are no difference from last PRs")
            return [], True
         logger.info(f"Current PRs {nowPRSet} are difference from last PRs {lastPRSet}")
      return message, isNoContent

   def getLastPRs(self):
      return getLastPRsFromCacheFile(DOWNLOAD_DIR, self.originalUrl)
      
   def persistCurrentPRs(self, bugzillaListUrl=''):
      PRs = []
      if len(bugzillaListUrl) > 0:
         self.bugzilla.resetHtml()
         csvFile = self.bugzilla.Viewlist(bugzillaListUrl)
         if os.path.exists(csvFile):
            df = pd.read_csv(csvFile)
            if not df.empty:
               # drop empty columns
               df.dropna(axis=1, how='all', inplace=True)
               df.fillna(value="", inplace=True)
               PRs = df['Bug ID'].values.tolist()
      updatePRsInCacheFile(DOWNLOAD_DIR, self.originalUrl, PRs)
      return PRs

   @logExecutionTime
   def getReport(self):
      if "/buglist.cgi" in self.longUrl:  # bugzilla list report
         message, thread, isNoContent = self.getBuglistReport()
         return transformReport(messages=message, threadMessages=thread, isNoContent=isNoContent, enableSplitReport=False)
      elif "/report.cgi" in self.longUrl:  # bugzilla table report
         message, isNoContent = self.getTabularReport()
         return transformReport(messages=message, isNoContent=isNoContent, isContentInCodeBlock=False)
      else:
         logger.error(f"Unsupported bugzilla url: {self.originalUrl}, long url: {self.longUrl}")
         raise Exception(f"Unsupported bugzilla url: {self.originalUrl}, long url: {self.longUrl}")


@logExecutionTime
def parseArgs():
   parser = argparse.ArgumentParser(description='Generate bugzilla report')
   parser.add_argument('--title', type=str, required=True, help='Title of bugzilla report')
   parser.add_argument('--url', type=str, required=True, help='short link of bugzilla')
   parser.add_argument('--list2table', type=str, required=True, help="change bugzilla list url into table url")
   parser.add_argument('--foldMessage', type=str, required=True, help="fold PR list by displaying in thread")
   parser.add_argument('--sendIfPRDiff', type=str, required=True, help="skip report if current PR list is the same as the last")
   return parser.parse_args()

if __name__ == "__main__":
   args = parseArgs()
   spider = BugzillaSpider(args)
   ret = spider.getReport()
   print(ret)
