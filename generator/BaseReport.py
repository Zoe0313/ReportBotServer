from enum import Enum

class ReportType(Enum):
   BUGZILLA_BUG_TABLE_BY_COMPONENT = 1,
   BUGZILLA_NANNY_REPORT = 2,
   P4_CHECKIN_REPORT = 3,
   SLACK_BOT_HEALTH_REPORT = 4,
   SVS_PASS_RATE_REPORT = 5

class BaseConfig():
   def __init__(self, data):
      # slack generic info
      self.slackPostUrl = "https://slack.com/api/chat.postMessage"
      self.slackLookupUrl = "https://slack.com/api/users.lookupByEmail?email=%s@vmware.com"
      self.slackImopenUrl = "https://slack.com/api/im.open"
      self.testChannelId = "C020QKAGMSQ"
      self.maintainerChannelId = "C026LRRM7T4"
 
      # bot account info
      self.bearerAuth = "Authorization: Bearer xoxb-2154537752-833403957187-yPWkRumT1Ayc3jq76H4TsviU"
 
      # log file info
      self.log = "/var/XXXX/log"
 
      # retry number in case report failed
      self.retryNum = 3
 
      # TODO: need check if account info can be reused.
 
      # bugzilla info
      self.bugzillaAccount = ""
      self.bugzillaCredential = ""
      self.bugzillaUrl = ""
 
      # p4 info
      self.p4Account = "svc.vsan-er"
      self.p4Pwdbase64 = "cDhNLjhUeiFAUzQhODYuUUNvcw=="
 
      # svs info
      self.svs20QueryURL = "https://svs.eng.vmware.com/api/v1.1/testsuites/?runs=20&branch=main&name__in="
      self.svs50QueryURL = "https://svs.eng.vmware.com/api/v1.1/testsuites/?runs=50&branch=main&name__in="
      self.svs100QueryURL = "https://svs.eng.vmware.com/api/v1.1/testsuites/?runs=100&branch=main&name__in="
      self.svsUserLink = "https://devhub.eng.vmware.com/legacy/#/svs/testsuite/%s?runs=%s&branch=main"
      # nanny info
 
      # short url info

class ReportConfig():
   def __init__(self):
      self.id = "XXX-XXXX-XXXX"                        # report configuration uuid
      self.scheduling = "* * * * *"                    # cron scheduling string. may update later
      self.channelId = ["GQV757T6K"]                 # slack channelId
      # self.reportTemplate = reportTemplateInstance     # different report type should have different report template
 
      # better to get below info from backend
      # self.lastUpdateTime =                 # last update time
      # self.lastUpdateUser =                 # last update user

class ReportTemplateConfig():
   def __init__(self):
      self.reportTitle = "70u3 bugs(P0&P1) by components daily report"    # report name
      self.reportType = ReportType.BUGZILLA_BUG_TABLE_BY_COMPONENT        # enum for report type

class ReportGenerator():
   def __init__(self, botConfig, reportConfig):
      self.botConfig = botConfig
      self.reportConfig = reportConfig
   
   def GenerateReport(self):
      pass