#!/usr/bin/env python

# Copyright 2021 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.  
review_diff_parser.py
'''

import re
from rbtools.api.client import RBClient
from generator.src.utils.BotConst import SERVICE_ACCOUNT, SERVICE_PASSWORD
from generator.src.utils.Logger import logger

class ReviewDiffParser(object):
   def __init__(self):
      self.queryUrl = "https://reviewboard.eng.vmware.com/api/review-requests/{0}/diffs/"
      self.linePattern = re.compile(r"^@@ (\-\d+),(\d+) (\+\d+),(\d+) @@")

   def __enter__(self):
      '''login review board system'''
      self.clientRB = RBClient('https://reviewboard.eng.vmware.com/')
      self.clientRB.login(username=SERVICE_ACCOUNT, password=SERVICE_PASSWORD)
      logger.info("login review board -->")
      return self.clientRB

   def __exit__(self, exc_type, exc_val, exc_tb):
      logger.info("<-- logout review board")
      try:
         self.clientRB.logout()
      except Exception as e:
         logger.info("logout review board error: {0}".format(e))

   def getDifference(self, reviewRequestId):
      '''
      Download patch info and parse it
      Restore difference infos by file list.
      :return param diffInfo: dict<filePath, diffList>
      '''
      try:
         diffConntent = self.downloadPatchInfo(reviewRequestId)
         lastReviewDiff = self.parseLastReviewDiff(diffConntent)
         # filter delete file
         diffInfo = {}
         for filePath, reviewCodes in lastReviewDiff.items():
            if "delete" == reviewCodes:  # delete file
               logger.info("review: {0} deleted".format(filePath))
            else:
               diffInfo[filePath] = reviewCodes
      except Exception as e:
         logger.info("get review diff error: {0}".format(e))
         raise Exception("get review diff failure")
      return diffInfo

   def downloadPatchInfo(self, reviewRequestId):
      '''Download patch info by review request id'''
      url = self.queryUrl.format(reviewRequestId)
      allReviewDiffRes = self.clientRB.get_url(url, timeout=5000)
      logger.info("review request #{0}".format(reviewRequestId))
      *_, lastReviewDiffResource = allReviewDiffRes.all_items
      patchInfo = lastReviewDiffResource.get_patch()
      return patchInfo.data.decode()

   def parseLastReviewDiff(self, differences):
      '''
      Parse download patch datas
      For example:
         diff --git a/bora/modules/vmkernel/wobtree/splinterdb/src/splinter_test.c b/bora/modules/vmkernel/wobtree/splinterdb/src/splinter_test.c
         index 7b77e3845ea32d78d4d2e9a3c94cc5601c9023be..ff90c9abfb767426d62c64c7de70d7b4b9bc8282 100644
         --- a/bora/modules/vmkernel/wobtree/splinterdb/src/splinter_test.c
         +++ b/bora/modules/vmkernel/wobtree/splinterdb/src/splinter_test.c
         @@ -158,6 +158,71 @@ test_all_done(const uint8 done, const uint8 num_tables)
             return (done == ((1 << num_tables) - 1));
          }
      Skip line start with 'diff --git' or 'index ...'
      Get file path from line start with '---' or '+++'
      Split difference by file path to get each file difference detail
      '''
      diffInfo = {}
      filePath, fileContent = "", []
      diffLines = differences.split('\n')
      while diffLines:
         line = diffLines.pop(0)
         if line.startswith("diff --git"):
            continue
         elif re.match(r"index [0-9a-z]{40}..[0-9a-z]{40}", line):
            continue
         elif line.startswith("--- ") or line.startswith("+++ "):
            if fileContent and filePath:
               diffInfo[filePath] = self.getReviewFileDiff(fileContent)
               fileContent = []
            filePath = self.getReviewFilePath(line)
         else:
            fileContent.append(line)
      if fileContent and filePath:
         diffInfo[filePath] = self.getReviewFileDiff(fileContent)
      return diffInfo

   def getReviewFilePath(self, line):
      line = line.replace("--- ", "").replace("+++ ", "")
      line = line.split()[0]
      if line.startswith("a/") or line.startswith("b/"):
         return "/".join(line.split("/")[2:])
      return "/".join(line.split("/")[5:])

   def getReviewFileDiff(self, diffContent):
      '''
      Get each file difference detail
      :return param fileDiff: List element: Tuple (+/-, code, lineNo)
      Here explain for example:
         @@ -158,6 +158,71 @@ test_all_done(const uint8 done, const uint8 num_tables)
      Use RegExp `^@@ (\-\d+),(\d+) (\+\d+),(\d+) @@` to match `@@ -158,6 +158,71 @@`
      Then get delete start lineNo=-158 and add start lineNo=158, and abs(lineNo)
      If one file's difference is '-' totally, it's a deleted file, just mark 'delete' to skip compare detail.
      '''
      otherLineNo = 0
      deleteLineNo, addLineNo = 0, 0
      codes = []
      fileDiff = []
      while diffContent:
         line = diffContent.pop(0)
         if self.linePattern.match(line):
            if codes:
               fileDiff.extend(codes)
               codes = []
            lineNoInfo = self.linePattern.findall(line)[0]
            deleteLineNo, addLineNo = abs(int(lineNoInfo[0])), int(lineNoInfo[2])
            continue
         if line.startswith("-"):
            if line[1:]:
               codes.append(('-', deleteLineNo, line[1:]))
            deleteLineNo += 1
         elif line.startswith("+"):
            if line[1:]:
               codes.append(('+', addLineNo, line[1:]))
            addLineNo += 1
         elif "\ No newline at end of file" == line:
            continue
         else:
            deleteLineNo += 1
            addLineNo += 1
            otherLineNo += 1
      fileDiff.extend(codes)

      if 0 == otherLineNo:
         if 0 == len(list((r for r in fileDiff if '+' == r[0]))):  # delete file
            return "delete"
         elif 0 == len(list((r for r in fileDiff if '-' == r[0]))):  # add file
            return fileDiff
      return fileDiff


if __name__ == "__main__":
   # Test:
   import os
   downloadDir = os.path.join(os.path.abspath(__file__).split("/generator")[0], "persist/tmp/p4-review-check-report")
   reviewRequestId = "1833044"
   diffFile = os.path.join(downloadDir, "{0}.txt".format(reviewRequestId))
   url = "https://reviewboard.eng.vmware.com/api/review-requests/{0}/diffs/".format(reviewRequestId)
   clientRB = RBClient('https://reviewboard.eng.vmware.com/')
   clientRB.login(username=SERVICE_ACCOUNT, password=SERVICE_PASSWORD)
   allReviewDiffRes = clientRB.get_url(url)
   *_, lastReviewDiffResource = allReviewDiffRes.all_items
   patchInfo = lastReviewDiffResource.get_patch()
   with open(diffFile, 'w') as f:
      f.write(patchInfo.data.decode())

   # parser = ReviewDiffParser()
   # with parser:
   #    lastReviewDiff = parser.getDifference(reviewRequestId)
   # for filePath, fileDiff in lastReviewDiff.items():
   #    print("-"*30)
   #    print(filePath)
   #    fileDiff.sort(key=lambda a: a[1], reverse=False)
   #    reviewAdd = (r for r in fileDiff if '+' == r[0])
   #    reviewDelete = (r for r in fileDiff if '-' == r[0])
   #    for diff in reviewDelete:
   #       print(diff)
   #    print("*"*20)
   #    for diff in reviewAdd:
   #       print(diff)
