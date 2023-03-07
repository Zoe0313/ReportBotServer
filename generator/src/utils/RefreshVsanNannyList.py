#!/usr/bin/env python

# Copyright 2023 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.  
RefreshVsanNannyList.py

== Vsan-nanny Duty Roster  ==
https://wiki.eng.vmware.com/VSAN/Nanny#Vsan-nanny_Duty_Roster

Refresh vsan-nanny.csv cache file on Monday 9:30am.
'''

import os
import datetime
import requests
import pandas as pd
from lxml import etree
from generator.src.utils.Utils import memorize
from generator.src.utils.Logger import logger

projectPath = os.path.abspath(__file__).split("/generator")[0]
persistDir = os.path.join(projectPath, "persist/config")
os.makedirs(persistDir, exist_ok=True)
csvFile = os.path.join(persistDir, "vsan-nanny.csv")

WIKI_API = "https://wiki.eng.vmware.com/wiki/api.php"

def GetPageID():
   pageID = os.environ.get('VSAN-NANNY_PAGE_ID')
   if not pageID:
      res = requests.get(
         url=WIKI_API,
         params={
            'action': 'query',
            'format': 'json',
            'prop': 'redirects',
            'titles': 'VSAN/Nanny'
         })
      if 200 == res.status_code:
         data = res.json()
         pageID = str(list(data["query"]["pages"].values())[0]['pageid'])
         os.environ['VSAN-NANNY_PAGE_ID'] = pageID
         logger.debug('VSAN/Nanny wiki page ID: {}'.format(pageID))
      else:
         raise Exception('Failed to get vSAN Nanny page Id: code={0}, content={1}'.format(
            res.status_code, res.content.decode()))
   return pageID

def RefreshList():
   '''Get vSAN Nanny table and save in CSV file'''
   pageID = GetPageID()
   session = requests.Session()
   res = session.get(
      url=WIKI_API,
      params={
         'action': 'parse',
         'pageid': pageID,
         'format': 'json'
      })
   if 200 == res.status_code:
      content = res.content.decode()
      html = etree.HTML(content)
      df = pd.DataFrame()
      df['WeekBegins'] = html.xpath(r'/html/body/div/table[1]/tbody//tr/td[1]/text()')
      df['WeekBegins'] = df['WeekBegins'].apply(lambda x: x.replace('\\n', ''))
      df['USFullName'] = html.xpath(r'/html/body/div/table[1]/tbody//tr/td[2]/a/text()')
      df['USUserName'] = html.xpath(r'/html/body/div/table[1]/tbody//tr/td[2]/a/@href')
      df['USUserName'] = df['USUserName'].apply(lambda x: x.replace('\\"mailto:', '').replace('@vmware.com\\"', ''))
      df['GlobalFullName'] = html.xpath(r'/html/body/div/table[1]/tbody//tr/td[3]/a/text()')
      df['GlobalUserName'] = html.xpath(r'/html/body/div/table[1]/tbody//tr/td[3]/a/@href')
      df['GlobalUserName'] = df['GlobalUserName'].apply(lambda x: x.replace('\\"mailto:', '').replace('@vmware.com\\"', ''))
      if df.empty:
         raise Exception('vSAN Nanny list is empty.')
      df.to_csv(csvFile, index=False)
      logger.debug('{} saved'.format(csvFile))
   else:
      raise Exception('Failed to get vSAN Nanny table by pageId {0}: code={1}, content={2}'.format(
         pageID, res.status_code, res.content.decode()))

@memorize
def GetNannyList(filePath=csvFile):
   df = pd.read_csv(filePath)
   df['week'] = df['WeekBegins'].apply(lambda x: datetime.datetime.strptime(x, '%m/%d/%Y'))
   return df

if __name__ == "__main__":
   RefreshList()
