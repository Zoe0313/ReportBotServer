#!/usr/bin/env python

# Copyright 2023 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.  
jira_report.py
- JIRA API:
   refer to https://developer.atlassian.com/server/jira/platform/jira-rest-api-examples/
- Response data fields:
   "id"         used in query issue detail by API https://jira.eng.vmware.com/rest/api/2/issue/5451714
   "key"        jira number link, e.g. <https://jira.eng.vmware.com/browse/STORVMC-3922|STORVMC-3922>
   "summary"    show first 60 chars others replaced by ...
   "priority"   priority.name, e.g. Normal
   "status"     status.name, e.g. Needs Review
   "labels"     keyword list, e.g. ["vmaas-m3","vmc-storage-sh","vsan-plus-service-agent"]
   "issuetype"  issuetype.name, bug type, e.g. Task
   "assignee"   bug assignee, assignee.emailAddress
   "project"    project.name: project, project.projectCategory.name: category
   "components" component list
   "duedate"    ETA, e.g. 2023-06-14
   "created"    the create time of issue，maybe used in aged issue report. e.g. 2023-07-09T23:42:13.000-0700
   "reporter"   issue reporter, reporter.emailAddress
- Custom fields:
   "customfield_10051" is Bugzilla ID, used in "Bugzilla ID" is not empty
   "customfield_12852" is Bugzilla Status, used in "Bugzilla ID" is not empty, customfield_12852.value
'''
import os
import re
import argparse
import itertools
from collections import defaultdict
from typing import Dict, Union, Any
import requests
import json
from urllib import parse
from generator.src.utils.BotConst import JIRA_BASIC_TOKEN, CONTENT_TYPE_JSON, \
   BUGZILLA_DETAIL_URL, JIRA_BROWSE_URL
from generator.src.utils.Logger import logger
from generator.src.utils.Utils import splitOverlengthReport, transformReport

DOWNLOAD_DIR = os.path.join(os.path.abspath(__file__).split("/generator")[0], "persist/tmp/jira")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

JIRA_PAGE_URL = 'https://jira.eng.vmware.com/issues/?jql='
JIRA_SEARCH_API = 'https://jira.eng.vmware.com/rest/api/2/search'
JIRA_ISSUE_API = 'https://jira.eng.vmware.com/rest/api/2/issue/'
SUMMARY_MAX_LENGTH = 60
MAX_TOTAL_RESULT_SIZE = 50
DisplayFields = {'key': 'Jira ID',
                 'issuetype': 'Type',
                 'priority': 'Pri',
                 'status': 'Status',
                 'assignee': 'Assignee',
                 'labels': 'Labels',
                 'project': 'Project',
                 'duedate': 'ETA',
                 'reporter': 'Reporter',
                 'created': 'CreatedDate',
                 'updated': 'UpdatedDate',
                 'components': 'Components',
                 'customfield_10051': 'PR',
                 'customfield_12852': 'PR Status',
                 'description': 'Desc',
                 'summary': 'Summary'}

class JiraReport(object):
   def __init__(self, args):
      self.title = parse.unquote(args.title)
      self.jql = parse.unquote(args.jql)
      fields = args.fields.split(',') if len(args.fields) > 0 else []
      self.groupbyField = args.groupby
      self.fields = ["id", "key"]
      if self.groupbyField == 'none':
         self.fields = ["id", "key"] + fields
      elif self.groupbyField not in self.fields:
         self.fields.append(self.groupbyField)
      self.creator = args.creator
      logger.debug('user define jql: {}'.format(self.jql))
      logger.debug('user define fields: {}'.format(fields))
      logger.debug('user define group by field: {}'.format(self.groupbyField))
      self.session = requests.session()
      self.session.headers = {'Authorization': f'Basic {JIRA_BASIC_TOKEN}',
                              'Content-Type': CONTENT_TYPE_JSON}
      self.totalSize = 0

   def SearchIssues(self, startAt=0):
      '''
      JIRA API - searching for issues using post
      curl \
         -X POST \
         -H "Authorization: Basic xxxxxx" \
         -H "Content-Type: application/json" \
         --data '{"jql":jql,"startAt":0,"maxResults":50,"fields":["id","key"]}' \
         "https://jira.eng.vmware.com/rest/api/2/search"
      response data:
      {
         startAt: 0,
         maxResults: 50,
         total: 73,
         issues: [
            {
               id: "5451714",
               self: "https://jira.eng.vmware.com/rest/api/2/issue/5451714",
               key: "STORVMC-3922"
            }, ......
         ]
      }
      '''
      jql = self.jql.replace('currentUser()', self.creator)
      logger.debug('startAt={}'.format(startAt))
      requestData = {'jql': jql, 'startAt': startAt, 'fields': self.fields}
      response = self.session.post(url=JIRA_SEARCH_API, data=json.dumps(requestData))
      if response.status_code == 200:
         datas = response.json()
         startAt, maxResults, total, issues = datas['startAt'], datas['maxResults'], datas['total'], datas['issues']
         return startAt, maxResults, total, issues
      errorMessage = response.json().get('errorMessages', 'not found')
      raise Exception('Search issues by jql "{}" occur error: {}'.format(jql, errorMessage))

   def GetAllIssues(self):
      logger.debug('Search jira list fields: {}'.format(self.fields))
      issueList: list[dict[str: Any]] = []
      startAt, maxResults, total, issues = self.SearchIssues()
      issueList.extend(issues)
      self.totalSize = total
      if self.groupbyField == 'none':
         total = min(MAX_TOTAL_RESULT_SIZE, total)
      while len(issueList) < total:
         startAt, maxResults, _, issues = self.SearchIssues(startAt=startAt + maxResults)
         issueList.extend(issues)
      if self.groupbyField == 'none':
         issueList = issueList[:MAX_TOTAL_RESULT_SIZE]
      logger.debug('issue count={}'.format(len(issueList)))
      details: list[dict[str, str]] = []
      for issue in issueList:
         detail = {}
         issueFields = issue.get('fields', [])
         for field in self.fields:
            if field in ('id', 'key'):
               detail[field] = issue[field]
            else:
               try:
                  if field in ('labels', 'components'):
                     detail[field] = ','.join(issueFields.get(field, []))
                  elif field in ('priority', 'status', 'issuetype'):
                     detail[field] = issueFields.get(field, {}).get('name', '')
                  elif field in ('assignee', 'reporter'):
                     detail[field] = issueFields.get(field, {}).get('emailAddress', '').split('@')[0]
                  elif field in ('duedate', 'created', 'updated'):
                     detail[field] = issueFields.get(field, '').split('T')[0]
                  elif field in ('summary', 'description'):
                     words = issueFields.get(field, '')
                     words = words if len(words) < SUMMARY_MAX_LENGTH else words[:SUMMARY_MAX_LENGTH - 3] + "..."
                     detail[field] = words.replace('\n', '').replace('\r', '').replace('```', '')
                  elif field == 'project':
                     detail[field] = '[{0}][{1}]'.format(issueFields.get(field, {}).get('name', ''),
                                                         issueFields.get(field, {}).get('projectCategory', {}).get('name', ''))
                  elif field == 'customfield_10051':  # PR
                     detail[field] = issueFields.get(field, '').rstrip('.0')
                  else:
                     if issueFields.get(field) is None:
                        detail[field] = ''
                     elif isinstance(issueFields.get(field), str):
                        detail[field] = issueFields.get(field)
                     elif isinstance(issueFields.get(field), list):
                        detail[field] = ','.join(issueFields.get(field))
                     elif isinstance(issueFields.get(field), dict):
                        if issueFields.get(field, {}).get('value'):
                           detail[field] = issueFields.get(field, {}).get('value')
                        elif issueFields.get(field, {}).get('name'):
                           detail[field] = issueFields.get(field, {}).get('name')
                        else:
                           detail[field] = '---'  # not found
                     else:
                        detail[field] = '---'  # not found
               except:
                  detail[field] = ''
         details.append(detail)
      return details

   def GetJiraList(self, issues):
      line_formatter = ""
      column_width: dict[str, int] = {}
      display_fields: list[str] = []
      display_names: list[str] = []
      for field, name in DisplayFields.items():
         if field not in self.fields:
            continue
         if field in ('summary', 'description'):
            width = SUMMARY_MAX_LENGTH
         else:
            width = max([len(issue[field]) for issue in issues] + [len(name)])
         display_fields.append(field)
         display_names.append(name)
         line_formatter += "{:<%ds} " % width
         column_width[field] = width
      logger.debug("line formatter: {}".format(line_formatter))
      logger.debug("display names: {}".format(display_names))
      messages = ["```" + line_formatter.format(*display_names)]
      for issue in issues:
         lineList = []
         line_formatter = ""
         for field in display_fields:
            value = issue[field]
            if field == 'key':
               value = "<%s|%s>" % (JIRA_BROWSE_URL.format(value), value)
               width = len(value) + column_width[field] - len(issue[field])
               line_formatter += "{:<%ds} " % width
            elif field == 'customfield_10051':
               value = '' if value == '' else "<%s|%s>" % (BUGZILLA_DETAIL_URL + value, value)
               line_formatter += "{:<%ds} " % column_width[field]
            else:
               line_formatter += "{:<%ds} " % column_width[field]
            lineList.append(value)
         messages.append(line_formatter.format(*lineList))
      messages.append("```")
      return messages

   def GetJiraTable(self, issues):
      # Issues grouped by the specified field
      groupbyDict = defaultdict(list)
      for key, group in itertools.groupby(issues, lambda x: x[self.groupbyField]):
         groupbyDict[key].extend(list(group))
      urlTailDict = {}
      numberDict = {}
      urlTailDict[self.jql] = JIRA_PAGE_URL + parse.quote(self.jql)
      numberDict['Total'] = len(issues)
      if self.groupbyField.lower() == 'priority':  # Order by priority asc
         index_map = {}
         index = 0
         for key in groupbyDict.keys():
            result = re.findall("P[0-9]", key)
            if len(result) > 0:
               index_map[key] = result[0]
            else:
               index_map[key] = "Q{}".format(index)
               index += 1
         orderedKeys = sorted(groupbyDict, key=lambda k: index_map[k], reverse=False)
      else:  # Order by count desc
         orderedKeys = sorted(groupbyDict, key=lambda k: len(groupbyDict[k]), reverse=True)
      for key in orderedKeys:
         groupbyJql = self.jql + ' AND {0} = "{1}"'.format(self.groupbyField, key)
         urlTailDict[groupbyJql] = JIRA_PAGE_URL + parse.quote(groupbyJql)
         numberDict[key] = len(groupbyDict[key])
      # Generate simple table report
      messages = []
      fieldDisplayName = DisplayFields.get(self.groupbyField)
      messages.append('Count         {0}'.format(fieldDisplayName))
      messages.append('---------------------------')
      for indexName, jql in zip(numberDict, urlTailDict):
         count = numberDict[indexName]
         shortUrl = urlTailDict[jql]
         resultLine = '<%s|%s>' % (shortUrl, str(count)) if shortUrl else str(count)
         resultLine += '             '
         if count < 100:
            resultLine += '  '
         if count < 10:
            resultLine += '  '
         resultLine += indexName
         messages.append(resultLine)
      return messages

   def GetReport(self):
      issues = self.GetAllIssues()
      is_empty = (self.totalSize == 0)
      messages = ["*Title: {}*".format(self.title)]
      if is_empty:
         messages.append("No issues currently.")
         reports = ["\n".join(messages)]
      elif self.groupbyField != 'none':
         table = self.GetJiraTable(issues)
         messages.extend(table)
         reports = splitOverlengthReport(messages, isContentInCodeBlock=False, enablePagination=False)
      else:
         jiraLink = JIRA_PAGE_URL + parse.quote(self.jql)
         bugCountStr = "One issue found" if 1 == self.totalSize else "{0} issue found".format(self.totalSize)
         if self.totalSize > MAX_TOTAL_RESULT_SIZE:
            bugCountStr += ". This report only show first {0} IDs. Please view more on <{1}|Jira Page>." \
               .format(MAX_TOTAL_RESULT_SIZE, jiraLink)
         else:
            bugCountStr += " on <%s|Jira Page>." % jiraLink
         messages.append(bugCountStr)
         detail = self.GetJiraList(issues)
         reports = splitOverlengthReport(detail, isContentInCodeBlock=True, enablePagination=True)
         reports[0] = "\n".join(messages) + reports[0]
      return transformReport(messages=reports, isNoContent=is_empty, enableSplitReport=False)

def parseArgs():
   parser = argparse.ArgumentParser(description='Generate jira report')
   parser.add_argument('--title', type=str, required=True, help='Title of jira report')
   parser.add_argument('--jql', type=str, required=True, help='short link of bugzilla')
   parser.add_argument('--fields', type=str, required=True, help='display issue list which column named by fields')
   parser.add_argument('--groupby', type=str, required=True, help='display issue table group by the field')
   parser.add_argument('--creator', type=str, required=True, help='use to replace currentUser() in jql')
   return parser.parse_args()

if __name__ == "__main__":
   args = parseArgs()
   generator = JiraReport(args)
   ret = generator.GetReport()
   print(ret)
   logger.info(ret)
