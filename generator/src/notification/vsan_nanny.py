#!/usr/bin/env python

# Copyright 2022 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.  
vsan_nanny.py
== Vsan-nanny Duty Roster  ==
https://wiki.eng.vmware.com/VSAN/Nanny#Vsan-nanny_Duty_Roster
All Global timezone assignee
'''
from generator.src.utils.Logger import PerfLogger
PerfLogger.info('import PerfLogger')
import datetime
import argparse
PerfLogger.info('import external python packages')
from generator.src.utils.Logger import logger
from generator.src.utils.Utils import LoadSlashCommandUsage, Local2Utc, logExecutionTime
from generator.src.utils.RefreshVsanNannyList import GetNannyList
PerfLogger.info('import customized parameters, functions')

buglistLine = "Bug list: https://via.vmw.com/UKKDDr"
BotSorryReply = '''Sorry, I can't get the information now since some error hit when querying the resource.
Please refer to the source page - https://wiki.eng.vmware.com/VSAN/Nanny#Vsan-nanny_Duty_Roster for more details.'''

@logExecutionTime
def _GetDutyInfoByDay(day):
   df = GetNannyList()
   dutyDf = df[df['week'] <= day]
   if dutyDf.empty:
      raise Exception(f"{day.strftime('%Y-%m-%d')} is before `Vsan-nanny Duty Roster` first begin day.")
   if len(dutyDf) == len(df):
      thisDayMonday = day - datetime.timedelta(day.weekday())
      logger.info(f"this day's Monday: {thisDayMonday}")
      if thisDayMonday.strftime('%m/%d/%Y') in df['WeekBegins'].values:
         return dutyDf.iloc[-1]
      raise Exception(f"{day.strftime('%Y-%m-%d')} exceeds the last day of the form `Vsan-nanny Duty Roster` which is out of date.")
   return dutyDf.iloc[-1]

def _GenerateOneWeek(dutyInfo):
   message = "vSAN-nanny of week: {0}\n".format(dutyInfo['WeekBegins'])
   message += "{0} <@{1}>\n".format(dutyInfo['USFullName'], dutyInfo['USUserName'])
   message += "{0} <@{1}>\n".format(dutyInfo['GlobalFullName'], dutyInfo['GlobalUserName'])
   return message

@logExecutionTime
def GetVsanNannyOfOneDay(oneDay):
   try:
      dutyInfo = _GetDutyInfoByDay(oneDay)
      message = _GenerateOneWeek(dutyInfo)
      message += buglistLine
   except Exception as e:
      logger.error(f"Failed to get vsan-nanny of one day: {e}")
      message = BotSorryReply
   return message

@logExecutionTime
def GetVsanNannyBetweenDayRange(startDay, endDay):
   weekMessages = []
   errorMessage = ''
   oneDay = startDay
   while oneDay <= endDay:
      try:
         dutyInfo = _GetDutyInfoByDay(oneDay)
         weekMessages.append(_GenerateOneWeek(dutyInfo))
         oneDay = oneDay + datetime.timedelta(days=7)
      except Exception as e:
         logger.error(f"Failed to get vsan-nanny between day range: {e}")
         errorMessage = BotSorryReply
         break
   if len(weekMessages) > 0:
      message = '-----------------------------\n'.join(weekMessages)
      message += buglistLine
      return message
   if len(errorMessage) > 0:
      return errorMessage
   return BotSorryReply

def ParseArgs():
   parser = argparse.ArgumentParser(description='Generate slash command `/whois-vsan-nanny` response')
   parser.add_argument('--tz', type=str, required=True, help='User local time zone')
   parser.add_argument('--param', type=str, required=True, help='The specific time or time range of vsan-nanny duty')
   return parser.parse_args()

if __name__=="__main__":
   args = ParseArgs()
   timezone = args.tz
   param = args.param.strip()
   dtDay1 = datetime.datetime.utcnow()
   if param == 'now':
      message = GetVsanNannyOfOneDay(dtDay1)
   else:
      dtDay2 = None
      days = param.split(' ')
      if len(days) >= 1:
         try:
            dtDay1 = datetime.datetime.strptime(days[0], '%Y-%m-%d')
            dtDay1 = Local2Utc(localTime=dtDay1, timezone=timezone)
            logger.info(f'dtDay1: {dtDay1}')
            if len(days) == 2:
               dtDay2 = datetime.datetime.strptime(days[1], '%Y-%m-%d')
               dtDay2 = Local2Utc(localTime=dtDay2, timezone=timezone)
               logger.info(f'dtDay2: {dtDay2}')
               if dtDay1 > dtDay2:
                  raise Exception(f"End day({dtDay2.strftime('%Y-%m-%d')}) should be "
                                  f"greater than start day({dtDay1.strftime('%Y-%m-%d')}).")
            elif len(days) > 2:
               raise Exception("More than two days.")
         except Exception as e:
            logger.error(f'Fail to parse time range {param} because of {e}')
            usage = LoadSlashCommandUsage('whois-vsan-nanny')
            message = f'```USAGE:\n{usage}```'
            print(message)
            exit()
      logger.info(f'day1: {dtDay1}, day2: {dtDay2}')
      if dtDay2:
         message = GetVsanNannyBetweenDayRange(dtDay1, dtDay2)
      else:
         message = GetVsanNannyOfOneDay(dtDay1)
   print(message)