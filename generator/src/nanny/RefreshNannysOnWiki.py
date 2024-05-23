# !/usr/bin/env python

# Copyright 2023 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.
RefreshNannysOnWiki.py
Description:
  Refresh nanny list from wiki page
Function:
- VSAN Nanny: https://wiki.eng.vmware.com/VSAN/Nanny#Vsan-nanny_Duty_Roster on Monday 9:30am.
  Save the list in persist/config/vsan-nanny.csv
Tips:
- If login failed, please confirm the login user and password are valid or not.
  Or the wiki api maybe changed again.
- If you forgot your wiki password, please "Change password" on
  https://wiki.eng.vmware.com/Special:Preferences
'''

import os
import base64
import requests
import pandas as pd
from lxml import etree
from generator.src.utils.Utils import logExecutionTime

projectPath = os.path.abspath(__file__).split("/generator")[0]
persistDir = os.path.join(projectPath, "persist/config")
os.makedirs(persistDir, exist_ok=True)

WIKI_LOGIN_USER = os.environ.get('WIKI_LOGIN_USER', '')
WIKI_LOGIN_PASSWORD = os.environ.get('WIKI_LOGIN_PASSWORD', '')

@logExecutionTime
def RefreshVSanNannyList():
    S = requests.Session()
    URL = "https://wiki.eng.vmware.com/wiki/api.php"
    response = S.get(
        url=URL,
        params={
            'action': "query",
            'meta': "tokens",
            'type': "login",
            'format': "json"})
    data = response.json()
    loginToken = data['query']['tokens']['logintoken']
    print('Login token: ', loginToken)
    response = S.post(
        url=URL,
        data={
            'action': "clientlogin",
            'username': WIKI_LOGIN_USER,
            'password': base64.b64decode(WIKI_LOGIN_PASSWORD.encode()),
            'loginreturnurl': URL,
            'logintoken': loginToken,
            'format': "json"})
    data = response.json()
    print('Login info: ', data)
    # Login info:  {'clientlogin': {'status': 'PASS', 'username': 'Lzoe'}}
    # Login info:  {'clientlogin': {'status': 'FAIL', 'message': 'Incorrect username or password entered.\nPlease try again.', 'messagecode': 'wrongpassword'}}
    if data['clientlogin']['status'] != 'PASS':
        raise Exception(data['clientlogin']['message'])
    
    response = S.get(
        url=URL,
        params={
            'action': 'query',
            'format': 'json',
            'prop': 'redirects',
            'titles': 'VSAN/Nanny'
        })
    data = response.json()
    pageID = data['query']['pages'].popitem()[0]
    print('VSAN/Nanny Page ID: ', pageID)
    
    response = S.get(
        url=URL,
        params={
            'action': 'parse',
            'pageid': pageID,
            'format': 'json'
        })
    content = response.content.decode()
    html = etree.HTML(content)
    df = pd.DataFrame()
    df['WeekBegins'] = html.xpath(r'/html/body/div/table[1]/tbody//tr/td[1]/text()')
    df['WeekBegins'] = df['WeekBegins'].apply(lambda x: x.replace('\\n', ''))
    df['USFullName'] = html.xpath(r'/html/body/div/table[1]/tbody//tr/td[2]/a/text()')
    df['USUserName'] = html.xpath(r'/html/body/div/table[1]/tbody//tr/td[2]/a/@href')
    df['USUserName'] = df['USUserName'].apply(lambda x: x.replace('\\"mailto:', '').replace('@vmware.com\\"', ''))
    df['GlobalFullName'] = html.xpath(r'/html/body/div/table[1]/tbody//tr/td[3]/a/text()')
    df['GlobalUserName'] = html.xpath(r'/html/body/div/table[1]/tbody//tr/td[3]/a/@href')
    df['GlobalUserName'] = df['GlobalUserName'].apply(
        lambda x: x.replace('\\"mailto:', '').replace('@vmware.com\\"', ''))
    if df.empty:
        raise Exception('vSAN Nanny list is empty.')
    csvFile = os.path.join(persistDir, "vsan-nanny.csv")
    df.to_csv(csvFile, index=False)
    print('{} saved'.format(csvFile))
