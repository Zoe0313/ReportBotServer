import os
import os
import sys
sys.path.insert(1, os.path.join(sys.path[0], '..'))
from botconst import SERVICE_ACCOUNT, SERVICE_PASSWORD
from utils.utils import RunCmd

def p4Login():
    # p4Ticket = "/tmp/.vdcstestframework.mtsautomation.p4tickets"
    os.environ['P4CONFIG'] = ""
    os.environ['P4USER'] = SERVICE_ACCOUNT
    # os.environ['P4TICKETS'] = p4Ticket
    # cmd = "/build/apps/bin/p4_login --all --user {0} --password {1} --ticket-file {2}".format(P4_ACCOUNT, P4_PASSWORD, p4Ticket)
    cmd = "echo '{0}' | /build/apps/bin/p4 -u {1} login".format(SERVICE_PASSWORD, SERVICE_ACCOUNT)
    print(cmd)
    output = RunCmd(cmd).decode('utf-8')
    print(output)

def p4Submitted(pathes, users=None, checkTime=None, args=""):
   baseCmd = "/build/apps/bin/p4 -u svc.vsan-er changes -s submitted"
   fullCmds = []
   outputs = []
   repo = ""
   if checkTime:
      checkTime = "@" + checkTime
   for path in pathes:
      repo += " " + path + checkTime
   if users:
      for user in users:
         cmd = baseCmd + " -u {0}".format(user) + repo + args
         fullCmds.append(cmd)
   else:
      cmd = baseCmd + repo + args
      fullCmds.append(cmd)
   for cmd in fullCmds:
      print("command for p4 submitted change: " + cmd)
      output = RunCmd(cmd).decode('utf-8')
      output = output.split("\n", 2)[2]
      outputs.append(output)
      print("output: " + output)
   return outputs

def p4DescribeChange(clns):
   ret = []
   if not clns:
      print("No cln for p4 change description")
      return ret
   for cln in clns:
      cmd = "/build/apps/bin/p4 -u svc.vsan-er describe -s {1}".format(SERVICE_PASSWORD, cln)
      print("command for getting p4 change description: " + cmd)
      output = RunCmd(cmd).decode('utf-8')
      print("output: " + output)
      output = ExtractRecord(output)
      ret.append(output)
   return ret

def ExtractRecord(recordString):
   print("Extract p4 change description...")
   recordStrings = recordString.split("\n")
   overall = recordStrings[2].split(" ")
   print("overall: \n")
   print(overall)
   record = {}
   record['cln'] = overall[1]
   record['summary'] = recordStrings[4][1:]
   record['user'] = overall[3].split("@")[0]
   record['time'] = overall[5] + " " + overall[6]
   record['bugId'] = ""
   print("print(record: \n")
   print(record)
   for info in recordStrings:
      print("========================")
      if "Bug Number:" in info:
         record['bugId'] = info[12:]
         break
   return record