#!/usr/bin/env python

# Copyright 2023 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.  
RefreshNannysOnPage.py
Description:
  Refresh nanny list from confluence page
Page:
- DOM: https://vmw-confluence.broadcom.net/display/VSAN/DOM-Nanny
  Saved in persist/config/dom-nanny.csv
- CMMDs: https://vmw-confluence.broadcom.net/pages/viewpage.action?spaceKey=SABU&title=Guru+Duty
  Saved in persist/config/cmmds-nanny.csv
- CLOM: https://vmw-confluence.broadcom.net/display/VSAN/CLOM-Nanny
  Saved in persist/config/clom-nanny.csv
- LSOM2: https://vmw-confluence.broadcom.net/pages/viewpage.action?spaceKey=LSOM2&title=LSOM2+nanny
  Saved in persist/config/lsom2-nanny.csv
Other:
- VDFS: Nanny bot owned by xiangyu
- Our team nanny bot: vsan-health-nanny, VCF, SH FVT, VMPool
- Unknown:
  - zDOM: https://vmw-confluence.broadcom.net/display/VSAN/zDOM-Nanny
    The nanny duty list saves in gitlab(private):
      https://gitlab.eng.vmware.com/abhayj/scripts/-/blob/master/vmware/roster/zdom_raw.txt
  - LSOM: https://vmw-confluence.broadcom.net/display/VSAN/LSOM+Nanny have table but the duty roster is too old.
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

PAGE_API = 'https://vmw-confluence.broadcom.net/rest/api/content'
USER_API = 'https://vmw-confluence.broadcom.net/rest/api/user'

# confluence page personal token
# request on page https://vmw-confluence.broadcom.net/plugins/personalaccesstokens/usertokens.action
CONFLUENCE_PAGE_TOKEN = 'Bearer NDM0MTg1NDk3MDEwOkFNOdEbhCnywMmfJeLtR3pL0u6s'

def GetPageID(title, spaceKey):
    response = requests.get(
        url=PAGE_API,
        headers={'Authorization': CONFLUENCE_PAGE_TOKEN},
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
        headers={'Authorization': CONFLUENCE_PAGE_TOKEN},
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
        headers={'Authorization': CONFLUENCE_PAGE_TOKEN},
        params={'key': userKey})
    if response.status_code == 200:
        data = response.json()
        return data['username']

def GetMailAccountById(oktaID):
    account = oktaID
    try:
        url = "https://nimbus-api.vdp.lvn.broadcom.net/api/v1/users/" + oktaID
        response = requests.get(url)
        if response.status_code == 200:
            mail = response.json().get('mail', '')
            account = mail.split('@')[0]
    except:
        pass
    return account

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
        mailAccount = GetMailAccountById(nannyName)
        WeekBegins.append(weekBeginDay)
        NannyNames.append(mailAccount)
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
        mailAccount = GetMailAccountById(userKey2name[userKey])
        NannyNames.append(mailAccount)
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
        mailAccount = GetMailAccountById(nannyName)
        WeekBegins.append(weekBeginDay)
        NannyNames.append(mailAccount)
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
        mailAccount = GetMailAccountById(userKey2name[userKey])
        NannyNames.append(mailAccount)
    WeekBegins = FormatDate(WeekBegins)
    df = pd.DataFrame({'Week': WeekBegins, 'Nanny': NannyNames})
    df = df.sort_values(by='Week')
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

def GetLatestNannys(csvFile):
    today = datetime.datetime.today()
    monday = today - datetime.timedelta(days=today.weekday())
    monday = datetime.datetime.strptime(monday.strftime("%Y-%m-%d"), "%Y-%m-%d")
    csvFile = os.path.join(persistDir, csvFile)
    df = pd.read_csv(csvFile)
    df['Week'] = pd.to_datetime(df['Week'])
    filtered_df = df[df['Week'] >= monday]
    nannys = filtered_df['Nanny'].values.tolist()
    if len(nannys) > 0:
        thisWeekNanny = nannys[0]
        if nannys.count(thisWeekNanny) > 1:
            index = nannys.index(thisWeekNanny, 1)
            nannys = nannys[:index]
    return nannys

def UpdateNannyReportConfiguration(nannyCode, csvFile):
    nannys = GetLatestNannys(csvFile)
    nannyAssignee = "\n".join(nannys)
    print(f'Update nanny assignees {nannys} by code {nannyCode}')
    url = f"https://vsanbot.vdp.lvn.broadcom.net/api/v1/nanny?code={nannyCode}&nannys={nannyAssignee}"
    response = requests.post(url)
    print(response.status_code)
    print(response.json())

def UpdateAll():
    UpdateNannyReportConfiguration("dom", "dom-nanny.csv")
    UpdateNannyReportConfiguration("cmmds", "cmmds-nanny.csv")
    UpdateNannyReportConfiguration("clom", "clom-nanny.csv")
    UpdateNannyReportConfiguration("lsom2", "lsom2-nanny.csv")