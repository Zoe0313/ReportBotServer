import json
from BaseReport import ReportType, BaseConfig, ReportConfig
from P4CheckinReport import P4CheckinReportConfig, P4CheckinReportGenerator
from SlackbotHealthReport import SlackbotHealthReportConfig, SlackbotHealthReportGenerator
from SVSPassRateReport import SVSPassRateReportConfig, SVSPassRateReportGenerator

def LoadBaseConfig():
   f = open('baseConfig.json')
   data = json.load(f)
   return BaseConfig(data)

def LoadReportConfig(id):
   f = open(id)
   data = json.load(f)
   reportConfig = ReportConfig()
   reportConfig.id = data["id"]
   reportConfig.channelId = data["channelIds"]
   reportConfig.reportTemplate = LoadReportTemplate(data)
   return reportConfig

def LoadReportType(typ):
   if typ == "P4_CHECKIN_REPORT":
      return ReportType.P4_CHECKIN_REPORT
   elif typ == "SLACK_BOT_HEALTH_REPORT":
      return ReportType.SLACK_BOT_HEALTH_REPORT
   elif typ == "SVS_PASS_RATE_REPORT":
      return ReportType.SVS_PASS_RATE_REPORT

def LoadReportTemplate(data):
   typ = LoadReportType(data["reportType"])
   if typ == ReportType.P4_CHECKIN_REPORT:
      reportTemplate = P4CheckinReportConfig(data)
   if typ == ReportType.SLACK_BOT_HEALTH_REPORT:
      reportTemplate = SlackbotHealthReportConfig(data)
   if typ == ReportType.SVS_PASS_RATE_REPORT:
      reportTemplate = SVSPassRateReportConfig(data)

   return reportTemplate

def GetReportGenerator(botConfig, reportConfig):
   if reportConfig.reportTemplate.reportType == ReportType.P4_CHECKIN_REPORT:
      return P4CheckinReportGenerator(botConfig, reportConfig)
   if reportConfig.reportTemplate.reportType == ReportType.SLACK_BOT_HEALTH_REPORT:
      return SlackbotHealthReportGenerator(botConfig, reportConfig)
   if reportConfig.reportTemplate.reportType == ReportType.SVS_PASS_RATE_REPORT:
      return SVSPassRateReportGenerator(botConfig, reportConfig)  