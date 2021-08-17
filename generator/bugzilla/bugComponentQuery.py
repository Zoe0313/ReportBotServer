import re
import base64
import requests
import os
import json
import urllib3
import certifi
import logging
import sys
from datetime import datetime
from bs4 import BeautifulSoup
sys.path.append('../')
PATH = "./log/"
if not os.path.exists(PATH):
   os.makedirs(PATH, exist_ok=True)

logging.basicConfig(filename=PATH+'bcq.log', level=logging.DEBUG)
logger = logging.getLogger('bugzillaquery')

def getHtmlContent(url, session, timeout=30):
   res = session.get(url, headers=dict(referer=url))
   logger.debug(res.content)
   return res.content

def login():
   payload = {
      "Bugzilla_login": "chjing",
      "Bugzilla_password": base64.b64decode('MTEwMTg1OVBhdWwl')
   }
   
   session = requests.session()
   login_url = "https://bugzilla.eng.vmware.com/"
   result = session.post(
      login_url,
      data=payload,
      headers=dict(referer=login_url)
   )
   logger.debug(result)
   return session

def getShortUrl(url):
   http = urllib3.PoolManager(ca_certs=certifi.where())
   encoded_body = json.dumps({"longUrl": url, "userLabel": "string"}).encode('utf-8')
   data = None
   try:
      res = http.request('POST', "https://via-api.vmware.com/via-console/app-api/v1/vialink",
                        headers={'Content-Type': 'application/json',
                                 "X-HeaderKey": "%241%24Yfai%2FUQF%24egNLEHGRocRPuPuzq3tsE%2F"},
                        body=encoded_body)
      data = res.data.decode('utf-8')
      r = json.loads(data)  
      return r.get('shortUrl')
   except:
      logger.debug("url: " + url)
      logger.debug("data: " + data)
      return None

def loadShortUrlDict(fileName):
   with open(fileName, 'r') as file:
      component2shortUrl = json.load(file)
   return component2shortUrl

def saveShortUrlDict(fileName, component2shortUrl):
   with open(fileName, 'w') as file:
      json.dump(component2shortUrl, file)

def fillTheDict(queryDict, countDict, countTask=False):
   try:
      session = login()
      for component, url in queryDict.items():
         content = getHtmlContent(url, session)
         p = re.compile('>(\S+) bugs? found')
         count = p.findall(str(content))[0]
         if count == 'One':
            count = 1
         if count == 'No':
            count = 0
         countDict[component] = count
         if countTask:
            regex2 = re.compile('d>Task</td')
            taskCount = len(regex2.findall(str(content)))
            countDictTasks[component] = taskCount
   except Exception as ex:
      logger.error(ex.with_traceback())

def getCountNShortUrlDict(url):
   session = login()
   # Get the oringial content
   content = getHtmlContent(url, session)
   initial_urls = []
   # Parse the content and get the initial urls we need to parse
   soup = BeautifulSoup(content, 'html.parser')
   for link in soup.find_all('a'):
      sub_url = link.get('href')
      if "buglist.cgi?action=wrap" in sub_url:
         initial_urls.append("https://bugzilla.eng.vmware.com/" + sub_url)
         logger.info("initial urls:")
         logger.info(initial_urls)
   component2url = {}
   for initial_url in initial_urls:
      try:
         component = initial_url.split('component=')[1]
         component = component.replace('%20', ' ')
         component2url[component] = initial_url
      except:
         component = 'Total'
         component2url[component] = initial_url
   component2count = {}
   fillTheDict(component2url, component2count)
   fileName = PATH + url[-4:] + '.json'
   if not os.path.exists(fileName):
      saveShortUrlDict(fileName, {})
   component2shortUrl = loadShortUrlDict(fileName)
   for component, longUrl in component2url.items():
      if component not in component2shortUrl.keys() or \
         not component2shortUrl[component] or \
         component2shortUrl[component] == 'None':
         shortUrl = getShortUrl(longUrl)
         if shortUrl is not None:
            component2shortUrl[component] = shortUrl
   saveShortUrlDict(fileName, component2shortUrl)
   logger.debug(component2count)
   logger.debug(component2shortUrl)
   return component2count, component2shortUrl

def generateAndSendMsg(message, bug_component2count, bug_component2shortUrl,
                       unclose_component2count, unclosed_component2shortUrl):
   results = []
   message += 'UnResolved    Resolved but not closed    Component\n' \
              '--------------------------------------------------------\n'
   # The keys should be the union of the keys of bug_component2count and
   # unclose_component2count
   keys = set(bug_component2count.keys()).union(set(unclose_component2count.keys()))
   for key in keys:
      resultLine =  ""
      # This is for add how many tasks are there in the unresolved bugs
      bug_count = 0
      if key in bug_component2count:
         bug_count = int(bug_component2count[key])
         if not bug_component2shortUrl[key] or bug_component2shortUrl[key] == "None":
            resultLine += str(bug_count)
         else:
            resultLine += '<%s|%s>' % (bug_component2shortUrl[key], bug_count)
      else:
         resultLine += str(bug_count)
      resultLine += '                 '
      if bug_count<100:
         resultLine += '  '
      if bug_count<10:
         resultLine += '  '

      unclose_bug_count = 0
      if key in unclose_component2count:
         unclose_bug_count = int(unclose_component2count[key])
         if not unclosed_component2shortUrl[key] \
            or unclosed_component2shortUrl[key] == "None":
            resultLine += str(unclose_bug_count)
         else:
            resultLine += '<%s|%s>' % (unclosed_component2shortUrl[key], unclose_bug_count)
      else:
         resultLine += str(unclose_bug_count)
      resultLine += '                                       '
      if unclose_bug_count<100:
         resultLine += '  '
      if int(unclose_component2count[key])<10:
         resultLine += '  '

      resultLine += key
      resultLine += '\n'
      message += resultLine
   message += '\n'
   return message

def generateAndSendMsgWithoutUnclosed(message, countDict, queryLinkDict):
   results = []
   message += 'Count         Component\n---------------------------\n'
   for component, count in countDict.items():
      if int(count) <= 0:
         continue
      resultLine = ""
      if not queryLinkDict.get(component) or queryLinkDict.get(component) == "None":
         resultLine += str(count)
      else:
         resultLine += '<%s|%s>' % (queryLinkDict.get(component), count)
      resultLine += '                '
      if int(count)<100:
         resultLine += '  '
      if int(count)<10:
         resultLine += '  '
      resultLine += component
      resultLine += '\n'
      message += resultLine
   message += '\n'
   return message

def cleanTotal(d):
   if 'Total' in d:
      del d['Total']