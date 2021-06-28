import argparse
import json
from BaseReport import ReportType, BaseConfig
from NotificationService import NotificationService
from ReportGeneratorUtil import LoadBaseConfig, LoadReportConfig, GetReportGenerator

def GetArgs():
   """
   Supports the command-line arguments listed below.
   """
   parser = argparse.ArgumentParser(
       description='Process args for vSAN SDK sample application')
   parser.add_argument('-i', '--id', required=True, action='store',
                       help='The report id.')
   parser.add_argument('-t', '--test', type=bool, default=False, action='store',
                       help='Run on test or not.')
   args = parser.parse_args()
   return args

def main():
   try:
      args = GetArgs()
      # Load config
      botConfig = LoadBaseConfig()
      reportConfig = LoadReportConfig(args.id + '.json')

      # Generate message
      reportGenerator = GetReportGenerator(botConfig, reportConfig)
      message = reportGenerator.GenerateReport()
      print(message)

      # Get slackbot notification and send message
      notification = NotificationService(botConfig, reportConfig, args.test)
      notification.SendMessage(message)

   except Exception as ex:
      raise


if __name__ == "__main__":
   main()