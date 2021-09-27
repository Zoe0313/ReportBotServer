import sys
import os
import json
sys.path.append('../')
sys.path.insert(1, os.path.join(sys.path[0], '../..'))
from datetime import datetime
from bugComponentQuery import generateAndSendMsgWithoutUnclosed, \
   getCountNShortUrlDict
import argparse

def parseArgs():
   parser = argparse.ArgumentParser(description='Generate bugzilla report')
   parser.add_argument('--title', type=str, required=True, \
      help= 'Title of bugzilla report')
   parser.add_argument('--url', type=str, required=True, help='short link of bugzilla')
   return parser.parse_args()

if __name__ == '__main__':

   args = parseArgs()
   component2count, component2shortUrl = getCountNShortUrlDict(args.url)
   today = datetime.today()
   message = args.title + '\n'
   component2count = {k: v for k, v in sorted(component2count.items(), key=lambda item: int(item[1]), reverse=1)}
   if not component2count:
      message += "No bugs, quit now."
   else:
      message = generateAndSendMsgWithoutUnclosed(message, component2count, component2shortUrl)
   print(message)