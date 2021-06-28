from BaseReport import ReportType, ReportTemplateConfig, ReportGenerator
import os
import time
from datetime import datetime, timedelta
import subprocess
import base64

class P4CheckinReportConfig(ReportTemplateConfig):
   def __init__(self, data):
      self.branch = data["branch"]
      self.reportType = ReportType.P4_CHECKIN_REPORT
      self.reportTitle = data["reportTitle"]
      self.checkTime = data["checkTime"]
      self.printTime = data["printTime"]
      self.targetUserAccount = data["targetUserAccount"]
      self.tailNotes = data["tailNotes"]

class P4CheckinReportGenerator(ReportGenerator):
   def __init__(self, botConfig, reportConfig):
      super().__init__(botConfig, reportConfig)
   
   def GenerateReport(self):
      today = datetime.today()
      yesterday = datetime.today() - timedelta(days=1)
      beforeYesterday = yesterday - timedelta(days=1)

      p = base64.b64decode(self.botConfig.p4Pwdbase64).decode('utf-8')

      checkTime = self.reportConfig.reportTemplate.checkTime.format(
            yesterday.year, yesterday.month, yesterday.day, today.year, today.month, today.day)
      printTime = self.reportConfig.reportTemplate.printTime.format(
            yesterday.year, yesterday.month, yesterday.day, today.year, today.month, today.day)

      messageHeader = self.reportConfig.reportTemplate.reportTitle.format(printTime) + '\n'
      messageContent= ""

      '''
      Currently includes user of team from Vamsi, Jake, Figo, Boris, alakshmipathy
      and IC hzheng, amdurm, daip, dparthasarathy, ramananj
      '''
      TeamFiles = ["Figo_Team"]
      teamMembers = []
      ret = []
      for targetFile in TeamFiles:
         f=open(targetFile, "r")
         flines = f.readlines()
         for x in flines:
            teamMembers.append(x[:-1])
         f.close()

      for people in teamMembers:
         cmds = ['''
echo {0} | /build/apps/bin/p4 -u {1} login -a
/build/apps/bin/p4 -u {1} changes -s submitted -u {2} //depot/bora/{3}/...@{4} //depot/vsan-mgmt-ui/{3}/...@{4} | /bin/grep -v "CBOT"'''.format(
            p, self.botConfig.p4Account, people, self.reportConfig.reportTemplate.branch, checkTime)]

         for cmd in cmds:
            output = RunCmd(cmd).decode('utf-8')
            output = output.split("\n",2)[2]
            if output:
               recordsString = output.split("\n")
               for recordString in recordsString:
                  if recordString:
                     cln = recordString.split(" ", 2)[1]
                     cmdDetail = '''
echo {0} | /build/apps/bin/p4 -u {1} login -a
/build/apps/bin/p4 -u {1} describe -s {2}'''.format(p, self.botConfig.p4Account, cln)
                     output = RunCmd(cmdDetail).decode('utf-8')
                     ret.append(ExtractRecord(output))

      if not ret:
         messageContent = "No Changes"
      else:
         for record in sorted(ret, key = lambda i: i['cln']):
            messageContent += record['cln'] + "  "
            messageContent += record['bugId'] + "  "
            messageContent += record['user'] + "  "
            messageContent += record['summary'] + "\n"

      message = messageHeader + messageContent
      message += "\n" + self.reportConfig.reportTemplate.tailNotes
      message = message.replace("'", "")
      message = message.replace('"', "")
      return message

def RunCmd(cmd):
   process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
   process.wait()

   output = process.stdout.read()
   print(output)
   error = process.stderr.read()
   if error:
      print(cmd)
      print(error)

   return output

def ExtractRecord(recordString):
   recordStrings = recordString.split("\n")
   overall = recordStrings[2].split(" ")
   record = {}
   record['cln'] = overall[1]
   record['summary'] = recordStrings[4][1:]
   record['user'] = overall[3].split("@")[0]
   record['time'] = overall[5] + " " + overall[6]
   record['bugId'] = ""
   for info in recordStrings:
      if "Bug Number:" in info:
         record['bugId'] = info[12:]
         break
   return record