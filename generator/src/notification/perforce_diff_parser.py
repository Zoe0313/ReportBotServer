#!/usr/bin/env python

# Copyright 2021 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.  
perforce_diff_parser.py
'''

import os
import re
import time
from generator.src.utils.Logger import logger
from generator.src.utils.Utils import runCmd
from generator.src.utils.BotConst import SERVICE_ACCOUNT, SERVICE_PASSWORD


class ReviewLinkNotFound(Exception):
   def __str__(self):
      return "p4 change without any review"


class PerforceDiffParser(object):
   def __init__(self):
      self.p4alias = '/build/apps/bin/p4 -u {}'.format(SERVICE_ACCOUNT)
      self.linePattern1 = re.compile(r"^(\d+)([acd])(\d+)$")
      self.linePattern2 = re.compile(r"^(\d+)([acd])(\d+),(\d+)$")
      self.linePattern3 = re.compile(r"^(\d+),(\d+)([acd])(\d+)$")
      self.linePattern4 = re.compile(r"^(\d+),(\d+)([acd])(\d+),(\d+)$")
      self.reviewIdPattern = re.compile(r"https://reviewboard.eng.vmware.com/r/(\d{7,})", re.I)
      self.changeCommand = '%s changes -s submitted -u {0} %s | /bin/grep -v "CBOT"'
      self.addFiles = []

   def loginPerforce(self):
      os.environ['P4CONFIG'] = ""
      os.environ['P4USER'] = SERVICE_ACCOUNT
      command = "echo '{0}' | {1} login".format(SERVICE_PASSWORD, self.p4alias)
      for i in range(1, 4):
         stdout, stderr, returncode = runCmd(command)
         if returncode != 0:
            logger.debug("p4 login stderr: {0}, returncode: {1}, execute times: {2}".format(stderr, returncode, i))
            time.sleep(0.5)
         else:
            return
      raise Exception("Perforce internal error")

   def setParams(self, startTime, endTime, branchList):
      checkinTimeRange = "{0},{1}".format(startTime.strftime("%Y/%m/%d:%H:%M:%S"),
                                          endTime.strftime("%Y/%m/%d:%H:%M:%S"))
      branchStr = " ".join(["//depot/{0}/...@{1}".format(branch, checkinTimeRange) for branch in branchList])
      self.changeCommand = self.changeCommand % (self.p4alias, branchStr)

   def getChanges(self, user):
      command = self.changeCommand.format(user)
      stdout, stderr, returncode = runCmd(command, nTimeOut=5000)
      if not stdout and 1 == returncode:
         return []
      elif returncode != 0:
         logger.debug("p4 changes stdout:{0}, stderr:{1}, returncode:{2}".format(stdout, stderr, returncode))
         raise Exception("Perforce internal error")
      return stdout.decode('utf-8', errors='ignore').split('\n')[:-1]

   def getDescribes(self, cln):
      '''
      Get submit description of the cln by perforce command
      For example:
         run command: /build/apps/bin/p4 -u svc.vsan-er describe -a 9385524
         we can get some submit brief description in first line like:
            Change 9385524 by alanh@alanh-jetpack on 2021/11/22 00:45:44
         then use RegExp `Change (.*) by (.*) on (.*)` to get submit time and other useful datas
      :param cln: string
      '''
      command = '{0} describe -a {1}'.format(self.p4alias, cln)
      stdout, stderr, returncode = runCmd(command, nTimeOut=5000)
      if returncode != 0:
         logger.debug("p4 describe stdout:{0}, stderr:{1}, returncode:{2}".format(stdout, stderr, returncode))
         raise Exception("Perforce internal error")
      describes = stdout.decode('utf-8', errors='ignore').split('\n')
      matchObj = re.match(r"Change (.*) by (.*) on (.*)", describes[0], re.M | re.I)
      changeTime = matchObj.group(3)
      return describes[1:], changeTime

   def isEmergencyBackout(self, describes):
      isBackout = "Back out" in "".join(describes[:5])
      isEmergency = False
      for line in describes:
         if "Reviewed by:" in line:
            line = line.replace("Reviewed by:", "")
            isEmergency = "emergency" in line.lower()
            break
      return isBackout and isEmergency

   def getReviewers(self, describes):
      '''
      Get reviewer list in perforce describe stdout
      For example:
         Reviewed by: dperi, wyattx, kelsallt, bliu
      reviewer list: ['dperi', 'wyattx', 'kelsallt', 'bliu']
      '''
      reviewers = []
      for line in describes:
         if "Reviewed by:" in line:
            line = line.replace("Reviewed by:", "")
            reviewers = list(set(reviewer.strip() for reviewer in line.split(',')))
            logger.info("reviewers: {0}".format(reviewers))
            break
      return reviewers

   def getReviewRequestId(self, describes):
      '''
      Get review request id from Review URL
      If Review URL is None, raise `ReviewLinkNotFound`
      ReviewLinkNotFound means that on the right of "Review URL:" is nothing, or not find "Review URL:"
         Example cln: 9785582,9800681
      '''
      reviewUrl = ""
      for line in describes:
         if "Review URL:" in line:
            reviewUrl = line.replace("Review URL:", "").strip()
            break
      if reviewUrl:
         # get the multi-review-ids in Review URL line
         reviewRequestIds = self.reviewIdPattern.findall(reviewUrl)
         reviewRequestIds = list(set(reviewRequestIds))
         if len(reviewRequestIds) > 0:
            return reviewRequestIds[0]  # next step here return reviewRequestIds
      # There is no link on the right of "Review URL" or not find "Review URL:" keywords
      raise ReviewLinkNotFound()

   def getDifference(self, describes):
      '''
      Restore difference infos by affected file list.
      :return param diffInfo: dict<filePath, diffList>
      '''
      affectedFiles = self.parseAffectedFiles(describes)
      lastChangeDiff = self.parseDifferences(describes)
      # filter delete file
      diffInfo = {}
      for filePath, status in affectedFiles:
         if 'add' == status:
            diffInfo[filePath] = lastChangeDiff.get(filePath, [])
         elif 'delete' == status:
            logger.info("change: {0} deleted".format(filePath))
         else:
            diffInfo[filePath] = lastChangeDiff.get(filePath, [])
      return diffInfo

   def parseAffectedFiles(self, describes):
      '''
      Get affected file list in perforce describe stdout
      For example:
         run command: /build/apps/bin/p4 -u svc.vsan-er describe -a 9385524
         we can get affected file list like:
         Affected files ...

         ... //depot/bora/main/apps/crtbora/common/mks.cc#119 edit
         ... //depot/bora/main/apps/rde/rmksContainer/linux/callbacks.c#69 edit
         ......
         restore filePath: apps/rde/rmksContainer/linux/callbacks.c  status: edit
         If this file status is 'add', restore in self.addFiles because of have not '>' at the beginning of each line
      '''
      try:
         index = describes.index("Affected files ...")
      except Exception as e:
         raise Exception("describe hasn't any affected files: {0}".format(e))

      self.addFiles = []
      fileList = []
      affectedFiles = describes[index+2:]
      for line in affectedFiles:
         line = line.strip()
         if not line:
            break
         if line.startswith('... '):
            line = line.replace('... ', '')
            filePath = line.split()[0].split('#')[0]
            filePath = "/".join(filePath.split("/")[5:])
            status = line.split()[1]
            fileList.append((filePath, status))
            if 'add' == status:
               self.addFiles.append(filePath)
      return fileList

   def parseDifferences(self, describes):
      '''Get difference in perforce describe stdout.'''
      try:
         index = describes.index("Differences ...")
      except Exception as e:
         raise Exception("describe hasn't any differences: {0}".format(e))

      # jump `Differences ...` and one empty line to get the real difference content
      diffContent = describes[index+2:]
      differences = self.parseLastChangeDiff(diffContent)
      return differences

   def parseLastChangeDiff(self, diffLines):
      '''
      Split difference by '==== fileInfo ====' to get each file difference detail
      For example:
         Differences ...

         ==== //depot/bora/main/apps/crtbora/common/mks.cc#119 (text) ====

         300,305d299
         <     *    enableDecoderWatermark - this switch enables/disables H264/HEVC/
      '''
      diffInfo = {}
      filePath, fileContent = "", []
      while diffLines:
         line = diffLines.pop(0)
         if re.match(r'^==== (.*) ====$', line):
            if fileContent and filePath:
               isAddFile = filePath in self.addFiles
               diffInfo[filePath] = self.getChangeFileDiff(fileContent, isAddFile)
               fileContent = []
            filePath = self.getChangeFilePath(line)
         else:
            fileContent.append(line)
      if fileContent and filePath:
         isAddFile = filePath in self.addFiles
         diffInfo[filePath] = self.getChangeFileDiff(fileContent, isAddFile)
      return diffInfo

   def getChangeFilePath(self, line):
      line = re.findall(r'==== (.*) ====', line)[0]
      line = line.split('#')[0]
      return "/".join(line.split("/")[5:])

   def matchLineInfo(self, pattern, line):
      results = pattern.findall(line)[0]
      diffType, typeIndex = '', 0
      for index, res in enumerate(results):
         if res in ['a', 'c', 'd']:
            diffType = res
            typeIndex = index
            break
      left = results[:typeIndex]
      right = results[typeIndex + 1:]
      delStart, delEnd = left if 2 == len(left) else (left[0], left[0])
      addStart, addEnd = right if 2 == len(right) else (right[0], right[0])
      return delStart, delEnd, diffType, addStart, addEnd

   def getChangeFileDiff(self, diffContent, isAddFile):
      '''
      Get each file difference detail
      :return param fileDiff: List element: Tuple (+/-, code, lineNo)
      Here explain for some example:
         1) RegExp `^(\d+)([acd])(\d+)$` to match `85c85`
         2) RegExp `^(\d+)([acd])(\d+),(\d+)$` to match `90,91c90`
         3) RegExp `^(\d+),(\d+)([acd])(\d+)$` to match `104c103,104`
         4) RegExp `^(\d+),(\d+)([acd])(\d+),(\d+)$` to match `5769,5770c5801,5803`
      Delete code's lineNo at the left of `acd`, add code's lineNo at the right of `acd`.
      If one number on the left side, this shows that delete start lineNo is the same as end lineNo (delete one line);
      If two number on the left side, this shows that delete lines range: [start lineNo, end lineNo];
      If one number on the right side, this shows that add start lineNo is the same as end lineNo (add one line);
      If two number on the right side, this shows that add lines range: [start lineNo, end lineNo];
      Diff type: `a` - add   `d` - delete   `c` - both `add` and `delete`
      '''
      deleteLineNo, addLineNo = 0, 0
      if isAddFile:
         # Between file path and first line code, there is one empty line.
         # We should jump this line and mark first line code is lineNo=1.
         diffContent = diffContent[1:] if not diffContent[0].strip() else diffContent
         addLineNo = 1
      codes = []
      fileDiff = []
      while diffContent:
         line = diffContent.pop(0)
         if '---' == line:
            continue
         elif self.linePattern1.match(line) or self.linePattern2.match(line) \
               or self.linePattern3.match(line) or self.linePattern4.match(line):
            if codes:
               fileDiff.extend(codes)
               codes = []
            # get delete start lineNo and add start lineNo
            for pattern in [self.linePattern4, self.linePattern3, self.linePattern2, self.linePattern1]:
               if pattern.match(line):
                  delStart, delEnd, diffType, addStart, addEnd = self.matchLineInfo(pattern, line)
                  deleteLineNo, addLineNo = int(delStart), int(addStart)
                  break
         else:
            line = line.rstrip('\r')
            if line.startswith('<'):  # delete
               if line[2:]:
                  codes.append(('-', deleteLineNo, line[2:]))
               deleteLineNo += 1
            elif line.startswith('>'):  # add
               if line[2:]:
                  codes.append(('+', addLineNo, line[2:]))
               addLineNo += 1
            elif isAddFile:
               if line:
                  codes.append(('+', addLineNo, line))
               addLineNo += 1
      fileDiff.extend(codes)
      return fileDiff
