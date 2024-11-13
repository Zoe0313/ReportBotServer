#!/usr/bin/env python

# Copyright 2023 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.  
jira_api_util.py
'''

import requests
from generator.src.utils.BotConst import JIRA_ACCESS_TOKEN, CONTENT_TYPE_JSON

JIRA_ISSUE_API = 'https://vmw-jira.broadcom.net/rest/api/2/issue'
JIRA_SEARCH_API = 'https://vmw-jira.broadcom.net/rest/api/2/search'

def detail(jiraID):
    headers = {
        'Authorization': JIRA_ACCESS_TOKEN,
        "Content-Type": CONTENT_TYPE_JSON
    }
    response = requests.get(
        url=JIRA_ISSUE_API + "/" + jiraID,
        headers=headers
    )
    status_code = response.status_code
    if status_code == 200:
        return response.json()
    error_message = response.json().get('errorMessages', 'not found')
    raise Exception(f'{status_code} - {error_message}')

def search(jql, startAt, maxResults, fields):
    '''
    JIRA API - searching for issues by jql
    curl \
       -X GET \
       -H "Authorization: Bearer xxx" \
       -H "Content-Type: application/json" \
       --data-urlencode "jql=xxx" \
       --data-urlencode "startAt=0" \
       --data-urlencode "maxResults=50"
       --data-urlencode "fields=['id','key']" \
       "https://vmw-jira.broadcom.com/rest/api/2/search"
    response data: {
       "startAt": 0,
       "maxResults": 50,
       "total": 73,
       "values": [
          {
             "id": "5451714",
             "self": "https://vmw-jira.broadcom.com/rest/api/2/issue/5451714",
             "key": "STORVMC-3922"
          }, ......
       ] }
    '''
    query = {
        'jql': jql,
        'startAt': startAt,
        'maxResults': maxResults,
        'fields': fields
    }
    headers = {
        'Authorization': JIRA_ACCESS_TOKEN,
        "Content-Type": CONTENT_TYPE_JSON
    }
    response = requests.get(
        url=JIRA_SEARCH_API,
        headers=headers,
        params=query
    )
    status_code = response.status_code
    if status_code == 200:
        datas = response.json()
        return datas['startAt'], datas['maxResults'], datas['total'], datas['issues']
    error_message = response.json().get('errorMessages', 'not found')
    raise Exception(f'{status_code} - {error_message}')

def queryIssuesByJql(jql, fields):
    issueList = []
    startAt, maxResults, total, issues = search(jql, 0, 50, fields)
    issueList.extend(issues)
    while len(issueList) < total:
        startAt, maxResults, _, issues = search(jql, startAt + maxResults, 50, fields)
        issueList.extend(issues)
    return issueList

# jql = 'issuekey IN parentIssuesOf("{0}")'.format('VSANCORE-16532')
# issues = queryIssuesByJql(jql, ["id", "labels", "priority"])
# print(issues[0])
