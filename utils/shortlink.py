from botconst import VIA_API, CONTENT_TYPE_JSON
from tokens import Token
import json
import certifi
import urllib3
import sys

class ShortLinkUtils(object):
   # We don't want to call the via API to get the short link every time,
   # as that will burden the DB for via server, we want to reuse the generated
   # short urls. So we persist them and load it when we need it.

   @classmethod
   def loadShortUrlDict(cls, fileName):
      with open(fileName, 'r') as file:
         component2shortUrl = json.load(file)
      return component2shortUrl

   @classmethod
   def saveShortUrlDict(cls, fileName, component2shortUrl):
      with open(fileName, 'w') as file:
         json.dump(component2shortUrl, file)

   @classmethod
   def getShortUrl(cls, url):
      http = urllib3.PoolManager(ca_certs=certifi.where())
      encoded_body = json.dumps(
         {"longUrl": url, "userLabel": "string"}).encode('utf-8')
      res = http.request(
         'POST', VIA_API,
         headers={'Content-Type': CONTENT_TYPE_JSON,
                  "X-HeaderKey": Token.VIA_TOKEN},
         body=encoded_body)
      r = json.loads(res.data.decode('utf-8'))
      return r.get('shortUrl')


if __name__ == '__main__':
   shortUrl = ShortLinkUtils.getShortUrl("www.google.com")
   print(shortUrl)
   # https://via.vmw.com/ETHN This is really google.
   # Do not run above main function frequently, this is a waste
   # to the DB of the via server, because every time it generates a
   # new short url for you.
