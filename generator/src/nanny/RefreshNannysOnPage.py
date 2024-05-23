#!/usr/bin/env python

# Copyright 2023 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.  
RefreshNannysOnPage.py
Description:
  Refresh nanny list from confluence page
Page:
- DOM: https://confluence.eng.vmware.com/display/VSAN/DOM-Nanny
  Saved in persist/config/dom-nanny.csv
- CMMDs: https://confluence.eng.vmware.com/pages/viewpage.action?spaceKey=SABU&title=Guru+Duty
  Saved in persist/config/cmmds-nanny.csv
- CLOM: https://confluence.eng.vmware.com/display/VSAN/CLOM-Nanny
  Saved in persist/config/clom-nanny.csv
- LSOM2: https://confluence.eng.vmware.com/pages/viewpage.action?spaceKey=LSOM2&title=LSOM2+nanny
  Saved in persist/config/lsom2-nanny.csv
Other:
- VDFS: Nanny bot owned by xiangyu
- Our team nanny bot: vsan-health-nanny, VCF, SH FVT, VMPool
- Unknown:
  - zDOM: https://confluence.eng.vmware.com/display/VSAN/zDOM-Nanny
    The nanny duty list saves in gitlab(private):
      https://gitlab.eng.vmware.com/abhayj/scripts/-/blob/master/vmware/roster/zdom_raw.txt
  - LSOM: https://confluence.eng.vmware.com/display/VSAN/LSOM+Nanny have table but the duty roster is too old.
'''

import os
import json
import requests
import datetime
from lxml import etree
import pandas as pd
from generator.src.utils.Utils import logExecutionTime

projectPath = os.path.abspath(__file__).split("/generator")[0]
persistDir = os.path.join(projectPath, "persist/config")
os.makedirs(persistDir, exist_ok=True)

PAGE_API = 'https://confluence.eng.vmware.com/rest/api/content'
USER_API = 'https://confluence.eng.vmware.com/rest/api/user'

CONFLUENCE_PAGE_TOKEN = os.environ.get('CONFLUENCE_PAGE_TOKEN', '')

def GetPageID(title, spaceKey):
    response = requests.get(
        url=PAGE_API,
        headers={'Authorization': f'Bearer {CONFLUENCE_PAGE_TOKEN}'},
        params={'title': title, 'spaceKey': spaceKey, 'expand': 'history'}
    )
    pageId = None
    if response.status_code == 200:
        data = response.json()
        if len(data.get('results', [])) > 0:
            pageId = data['results'][0]['id']
    if not pageId:
        raise Exception(f'Failed to get the pageID of "spaceKey={spaceKey}&title={title}" by confluence API.')
    return pageId

def GetPageContent(pageID):
    content = None
    response = requests.get(
        url=PAGE_API + "/{}".format(pageID),
        headers={'Authorization': f'Bearer {CONFLUENCE_PAGE_TOKEN}'},
        params={'expand': 'body.storage'})
    if response.status_code == 200:
        data = response.json()
        if data.get('body', {}).get('storage', {}).get('value', None):
            content = data['body']['storage']['value']
    if not content:
        raise Exception(f'Failed to get the content of pageID "{pageID}" by confluence API.')
    return content

def GetUsernameByKey(userKey):
    response = requests.get(
        url=USER_API,
        headers={'Authorization': f'Bearer {CONFLUENCE_PAGE_TOKEN}'},
        params={'key': userKey})
    if response.status_code == 200:
        data = response.json()
        return data['username']

def FormatDate(dateList):
    date = dateList[0]
    try:
        datetime.datetime.strptime(date, "%Y-%m-%d")
        return dateList
    except:
        print("The date formatter is not '%Y-%m-%d'.")
    MonthName = ["January", "February", "March", "April",
                 "May", "June", "July", "August",
                 "September", "October", "November", "December"]
    MonthMap = {m: i for i, m in enumerate(MonthName, start=1)}
    newDateList = []
    for date in dateList:
        dates = date.split(",")
        month, day = dates[1].strip().split()
        month = "%02d" % MonthMap[month]
        day = "%02d" % int(day)
        year = dates[2].strip()
        newDateList.append(f"{year}-{month}-{day}")
    return newDateList

@logExecutionTime
def RefreshDOMNannyList():
    pageID = GetPageID(title='DOM-Nanny', spaceKey='VSAN')
    content = GetPageContent(pageID)
    html = etree.HTML(content)
    elements = html.xpath(r'/html/body/table/tbody//tr//text()')
    WeekBegins = []
    NannyNames = []
    mappingFile = os.path.join(os.path.dirname(__file__), "vsan-dom-team-members.json")
    with open(mappingFile, 'r') as f:
        DOMNannyDict = json.load(f)
    for i in range(2, len(elements), 2):
        if not elements[i].startswith('Monday'):
            continue
        weekBeginDay, nannyFrontName = elements[i], elements[i+1]
        nannyName = DOMNannyDict[nannyFrontName] if DOMNannyDict.get(nannyFrontName) else nannyFrontName
        WeekBegins.append(weekBeginDay)
        NannyNames.append(nannyName)
    WeekBegins = FormatDate(WeekBegins)
    df = pd.DataFrame({'Week': WeekBegins, 'Nanny': NannyNames})
    if df.empty:
        raise Exception('DOM-Nanny list is empty.')
    csvFile = os.path.join(persistDir, "dom-nanny.csv")
    df.to_csv(csvFile, index=False)
    print('{} saved'.format(csvFile))

@logExecutionTime
def RefreshCMMDsNannyList():
    pageID = GetPageID(title='Guru Duty', spaceKey='SABU')
    content = GetPageContent(pageID)
    html = etree.HTML(content)
    elements = html.xpath(r'//tr/td[1]//text()')
    WeekBegins = [element for element in elements if element.startswith('Monday')]
    elements = html.xpath(r'//tr/td[2]//link/user')
    userKeys = [element.values()[0] for element in elements]
    NannyNames = []
    userKey2name = {}
    for userKey in userKeys:
        if not userKey2name.get(userKey):
            userKey2name[userKey] = GetUsernameByKey(userKey)
        NannyNames.append(userKey2name[userKey])
    WeekBegins = FormatDate(WeekBegins)
    df = pd.DataFrame({'Week': WeekBegins, 'Nanny': NannyNames})
    if df.empty:
        raise Exception('CMMDs-Nanny list is empty.')
    csvFile = os.path.join(persistDir, "cmmds-nanny.csv")
    df.to_csv(csvFile, index=False)
    print('{} saved'.format(csvFile))

@logExecutionTime
def RefreshCLOMNannyList():
    pageID = GetPageID(title='CLOM-Nanny', spaceKey='VSAN')
    content = GetPageContent(pageID)
    html = etree.HTML(content)
    elements = html.xpath(r'/html/body/table/tbody//tr//text()')
    WeekBegins = []
    NannyNames = []
    mappingFile = os.path.join(os.path.dirname(__file__), "vsan-clom-team-members.json")
    with open(mappingFile, 'r') as f:
        CLOMNannyDict = json.load(f)
    for i in range(2, len(elements), 2):
        if not elements[i].startswith('Monday'):
            continue
        weekBeginDay, nannyFrontName = elements[i], elements[i+1]
        nannyName = CLOMNannyDict[nannyFrontName] if CLOMNannyDict.get(nannyFrontName) else nannyFrontName
        WeekBegins.append(weekBeginDay)
        NannyNames.append(nannyName)
    WeekBegins = FormatDate(WeekBegins)
    df = pd.DataFrame({'Week': WeekBegins, 'Nanny': NannyNames})
    if df.empty:
        raise Exception('CLOM-Nanny list is empty.')
    csvFile = os.path.join(persistDir, "clom-nanny.csv")
    df.to_csv(csvFile, index=False)
    print('{} saved'.format(csvFile))

@logExecutionTime
def RefreshLSOM2NannyList():
    pageID = GetPageID(title='LSOM2 Nanny', spaceKey='LSOM2')
    content = GetPageContent(pageID)
    html = etree.HTML(content)
    WeekBegins = html.xpath(r'//tr/td[2]/div/p/time/@datetime')
    elements = html.xpath(r'//tr/td[1]//link/user')
    userKeys = [element.values()[0] for element in elements]
    NannyNames = []
    userKey2name = {}
    for userKey in userKeys:
        if not userKey2name.get(userKey):
            userKey2name[userKey] = GetUsernameByKey(userKey)
        NannyNames.append(userKey2name[userKey])
    WeekBegins = FormatDate(WeekBegins)
    df = pd.DataFrame({'Week': WeekBegins, 'Nanny': NannyNames})
    if df.empty:
        raise Exception('LSOM2-Nanny list is empty.')
    csvFile = os.path.join(persistDir, "lsom2-nanny.csv")
    df.to_csv(csvFile, index=False)
    print('{} saved'.format(csvFile))
    
def RefreshNannysOnPage():
    RefreshDOMNannyList()
    RefreshCMMDsNannyList()
    RefreshCLOMNannyList()
    RefreshLSOM2NannyList()
