from BaseReport import ReportType, ReportTemplateConfig, ReportGenerator
import os
import time
from datetime import datetime, timedelta
import subprocess
import base64

class SlackbotHealthReportConfig(ReportTemplateConfig):
   def __init__(self, data):
      #TODO: further refine
      #Check current infrastructure status (server CPU, memory, storage, NFS mounting info, etc)
      #Check possible external dependency (bugzilla, svs, etc)
      #Check SlackBot log info
      self.reportType = ReportType.SLACK_BOT_HEALTH_REPORT

class SlackbotHealthReportGenerator(ReportGenerator):
   def __init__(self, botConfig, reportConfig):
      super().__init__(botConfig, reportConfig)
   
   def GenerateReport(self):
      message= "```Slackbot health check TODO```\n"

      message += "Infra::greendot:\n"
      message += "Ext::greendot:\n"
      message += "Log::greendot:\n"

      return message
