from BaseReport import ReportType, ReportTemplateConfig, ReportGenerator
from datetime import datetime, timedelta
import requests

class SVSPassRateReportConfig(ReportTemplateConfig):
   def __init__(self, data):
      self.testCases = data["testCases"]
      self.reportType = ReportType.SVS_PASS_RATE_REPORT

class SVSPassRateReportGenerator(ReportGenerator):
   def __init__(self, botConfig, reportConfig):
      super().__init__(botConfig, reportConfig)
   
   def GenerateReport(self):

      today = datetime.today()
      message = '{0}-{1}-{2}: Pass rate of svs runs\n'.format(today.year, today.month, today.day)
      message += '20  \t50  \t100\ttest name\n'

      # resultLine += '<%s|%s>' % (bug_component2shortUrl[key], bug_count)
      # testCaseName / passRate
      testCaseResult = {}

      for testcase in self.reportConfig.reportTemplate.testCases:
         testCaseResult[testcase] = {}
         r = requests.get(self.botConfig.svs20QueryURL + testcase)
         testCaseResult[testcase]['20'] = r.json().get('objects')[0].get('pass_percentage')
         r = requests.get(self.botConfig.svs50QueryURL + testcase)
         testCaseResult[testcase]['50'] = r.json().get('objects')[0].get('pass_percentage')
         r = requests.get(self.botConfig.svs100QueryURL + testcase)
         testCaseResult[testcase]['100'] = r.json().get('objects')[0].get('pass_percentage')

      for test, passRates in testCaseResult.items():
         ms = ''
         for num in ('20', '50', '100'):
            passRate = passRates[num]
            passRateStr = "{:2.0f}%\t".format(passRate) if passRate > 50 else \
               "<{}|{}>\t".format(self.botConfig.svsUserLink % (test, num),
                                 "{:2.0f}%".format(passRate))
            ms += passRateStr
         ms += test
         message += ms + '\n'
      message = message.replace("'", "")
      message = message.replace('"', "")
      return message