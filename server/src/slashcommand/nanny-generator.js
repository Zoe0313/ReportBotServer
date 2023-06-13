import path from 'path'
import fs from 'fs'
import logger from '../../common/logger.js'
import {
   ParseDateWithTz, FormatDate, Local2Utc
} from '../../common/utils.js'
import { ReportConfiguration } from '../model/report-configuration.js'

const BuglistLine = 'Bug list: https://via.vmw.com/UKKDDr'
const BotSorryReply = `Sorry, I can't get the information now since some error hit when querying the resource.\nPlease refer to the source page - https://wiki.eng.vmware.com/VSAN/Nanny#Vsan-nanny_Duty_Roster for more details.`
let vSANNannyCache = []

const IsValidDate = (dateStr) => {
   const dateReg = /^(\d{4})-(\d{2})-(\d{2})$/
   return dateStr.length > 0 && !isNaN(Date.parse(dateStr)) && dateReg.test(dateStr)
}

async function GetReportByNannyCode(nannyCode) {
   const report = await ReportConfiguration.findOne({ 'reportSpecConfig.nannyCode': nannyCode })
   if (report == null) {
      throw new Error(`Command failed: ${nannyCode} nanny not found.`)
   }
   return report
}

const GetMondayDate = (oneDay) => {
   let day = oneDay.getDay()
   if (day === 0) {
      day = 7
   }
   oneDay.setDate(oneDay.getDate() - day + 1)
   return new Date(oneDay.getFullYear(), oneDay.getMonth(), oneDay.getDate())
}

const GetNannyIndexByDay = (nannyAssignees, oneMondayDate) => {
   const thisMondayDate = GetMondayDate(new Date())
   if (oneMondayDate.getDay() !== 1) {
      oneMondayDate = GetMondayDate(oneMondayDate)
   }
   const deltaTime = oneMondayDate.getTime() - thisMondayDate.getTime()
   const diffWeek = deltaTime / (24 * 3600 * 1000 * 7)
   let index = 0
   if (diffWeek > 0) {
      index = diffWeek % nannyAssignees.length
   } else if (diffWeek < 0) {
      index = nannyAssignees.length + diffWeek % nannyAssignees.length
   }
   return index
}

const GenerateNannyReply = async (payload, tz) => {
   let stdout = ''
   let param = payload?.text
   param = param.trim() // Remove spaces at the beginning and end of the string
   param = param.replace(/ +/g, ' ') // Replace multiple spaces in the middle with one
   const command = payload.command
   if (param.length === 0) {
      throw new Error(`Command failed: ${command}, argument is empty.`)
   }
   const nannyCode = param.split(' ')[0].toLowerCase()
   const report = await GetReportByNannyCode(nannyCode)
   const nannyAssignees = report?.reportSpecConfig?.nannyAssignee || []
   if (nannyAssignees.length > 0) {
      switch (param.split(' ').length) {
         case 1: {
            stdout = `<@${nannyAssignees[0]}> is ${nannyCode} nanny this week.`
            break
         }
         case 2: {
            const startDay = param.split(' ')[1]
            if (!IsValidDate(startDay)) {
               throw new Error(`Command failed: ${command}, input is not a date.`)
            }
            const startDayWithTZ = ParseDateWithTz(startDay, tz)
            const startMonDate = GetMondayDate(startDayWithTZ)
            const nannyIndex = GetNannyIndexByDay(nannyAssignees, startMonDate)
            stdout = `<@${nannyAssignees[nannyIndex]}> is ${nannyCode} nanny at ${startDay}.`
            break
         }
         case 3: {
            const startDay = param.split(' ')[1]
            const endDay = param.split(' ')[2]
            if (!IsValidDate(startDay) || !IsValidDate(endDay)) {
               throw new Error(`Command failed: ${command}, input is not a date.`)
            }
            const startDayWithTZ = ParseDateWithTz(startDay, tz)
            const endDayWithTZ = ParseDateWithTz(endDay, tz)
            if (startDayWithTZ >= endDayWithTZ) {
               throw new Error(`Command failed: ${command}, end day should be greater than start day.`)
            }
            let startMonDate = GetMondayDate(startDayWithTZ)
            const satDate = new Date(startMonDate.getFullYear(), startMonDate.getMonth(),
               startMonDate.getDate())
            satDate.setDate(satDate.getDate() + 6)
            let nannyIndex = GetNannyIndexByDay(nannyAssignees, startMonDate)
            while (startMonDate <= endDayWithTZ) {
               const monDateStr = FormatDate(startMonDate)
               const satDateStr = FormatDate(satDate)
               stdout += `<@${nannyAssignees[nannyIndex]}> is ${nannyCode} nanny ` +
                  `from ${monDateStr} to ${satDateStr}.` + '\n'
               startMonDate = new Date(startMonDate.setDate(startMonDate.getDate() + 7))
               satDate.setDate(satDate.getDate() + 7)
               nannyIndex += 1
               if (nannyIndex >= nannyAssignees.length) {
                  nannyIndex = 0
               }
            }
            break
         }
         default:
            throw new Error(`Command failed: ${command}, input error.`)
      }
   } else {
      throw new Error(`Command failed: ${command}, nanny members of code ${nannyCode} is empty.`)
   }
   return stdout
}

export function LoadNannyList() {
   try {
      const csvFile = path.join(path.resolve(), '..') + `/persist/config/vsan-nanny.csv`
      const nannyStr = fs.readFileSync(csvFile).toString()
      const lines = nannyStr.split('\n') || []
      const nannys = lines.map(line => {
         const nannyInfo = line.split(',')
         if (nannyInfo.length >= 5) {
            const weekBegins = nannyInfo[0]
            const usFullName = nannyInfo[1]
            const usUserName = nannyInfo[2]
            const globalFullName = nannyInfo[3]
            const globalUserName = nannyInfo[4]
            return { weekBegins, usFullName, usUserName, globalFullName, globalUserName }
         }
         return null
      }).filter(nanny => { return nanny != null })
      nannys.shift()
      nannys.pop()
      vSANNannyCache = nannys
      logger.debug(`Refresh vSAN-Nanny list: ${vSANNannyCache.length}`)
   } catch (e) {
      logger.error(`Failed to load nanny list vsan-nanny.csv:`)
      logger.error(e)
   }
}

const GetDutyInfoByDay = (oneDay) => {
   if (oneDay == null) {
      throw new Error(`Failed to query vSAN nanny duty info by null day`)
   }
   if (oneDay.getDay() !== 1) {
      oneDay = GetMondayDate(oneDay)
   }
   const mondayStr = FormatDate(oneDay, 'MM/DD/YYYY')
   const dutyInfos = vSANNannyCache.filter(nanny => nanny.weekBegins === mondayStr)
   if (dutyInfos.length === 0) {
      throw new Error(`Failed to find ${mondayStr} day in VSAN-Nanny Duty Roster.`)
   }
   return dutyInfos[0]
}

const GenerateOneWeek = (dutyInfo) => {
   let stdout = 'vSAN-nanny of week: ' + `${dutyInfo.weekBegins}` + '\n'
   stdout += `${dutyInfo.usFullName} <@${dutyInfo.usUserName}>` + '\n'
   stdout += `${dutyInfo.globalFullName} <@${dutyInfo.globalUserName}>` + '\n'
   return stdout
}

const GetVSANNannyOfOneDay = (oneDay) => {
   let message = ''
   try {
      const dutyInfo = GetDutyInfoByDay(oneDay)
      message = GenerateOneWeek(dutyInfo)
      message += BuglistLine
   } catch (e) {
      logger.error('Failed to get vsan-nanny of one day:')
      logger.error(e)
      message = BotSorryReply
   }
   return message
}

const GetVSANNannyBetweenDayRange = (startDay, endDay) => {
   let message = ''
   try {
      const weekMsgs = []
      let oneDay = startDay
      while (oneDay <= endDay) {
         const dutyInfo = GetDutyInfoByDay(oneDay)
         const oneWeekMsg = GenerateOneWeek(dutyInfo)
         weekMsgs.push(oneWeekMsg)
         oneDay = new Date(oneDay.setDate(oneDay.getDate() + 7))
      }
      if (weekMsgs.length > 0) {
         message = weekMsgs.join('-----------------------------\n')
         message += BuglistLine
      }
   } catch (e) {
      logger.error('Failed to get vsan-nanny between day range:')
      logger.error(e)
      message = BotSorryReply
   }
   return message
}

const GetNextDutyInfo = (dutyInfos, today) => {
   let nextDutyInfo = null
   let oneMondayDate = GetMondayDate(today)
   const lastMondayDate = GetMondayDate(new Date(dutyInfos[dutyInfos.length - 1].weekBegins))
   while (oneMondayDate <= lastMondayDate) {
      const oneMondayStr = FormatDate(oneMondayDate, 'MM/DD/YYYY')
      const infos = dutyInfos.filter(nanny => nanny.weekBegins === oneMondayStr)
      if (infos.length > 0) {
         nextDutyInfo = infos[0]
         break
      }
      oneMondayDate = new Date(oneMondayDate.setDate(oneMondayDate.getDate() + 7))
   }
   return nextDutyInfo
}

const GetVSANNannyById = (vmwareId, today) => {
   let message = ''
   const USDutyInfos = vSANNannyCache.filter(nanny => nanny.usUserName === vmwareId)
   const GlobalDutyInfos = vSANNannyCache.filter(nanny => nanny.globalUserName === vmwareId)
   if (USDutyInfos.length === 0 && GlobalDutyInfos.length === 0) {
      throw new Error(`Command failed: not find vmwareId ${vmwareId} in VSAN-Nanny Duty Roster.`)
   }
   if (USDutyInfos.length > 0) {
      const dutyInfo = GetNextDutyInfo(USDutyInfos, today)
      if (dutyInfo != null) {
         message = `<@${dutyInfo.usUserName}> will be US vSAN-nanny of week: ${dutyInfo.weekBegins}.` + '\n'
      } else {
         message = BotSorryReply
      }
   }
   if (GlobalDutyInfos.length > 0) {
      const dutyInfo = GetNextDutyInfo(GlobalDutyInfos, today)
      if (dutyInfo != null) {
         message += `<@${dutyInfo.globalUserName}> will be Global vSAN-nanny of week: ${dutyInfo.weekBegins}.` + '\n'
      } else {
         message = BotSorryReply
      }
   }
   return message
}

const GenerateVSANNannyReply = async (payload, tz) => {
   let stdout = ''
   let param = payload?.text || 'now'
   param = param.trim()
   param = param.replace(/ +/g, ' ')
   const command = payload.command
   if (param === 'now') {
      const today = Local2Utc(FormatDate(new Date()), tz)
      stdout = GetVSANNannyOfOneDay(today)
   } else {
      const days = param.split(' ')
      switch (days.length) {
         case 1: {
            const inputStr = days[0]
            if (IsValidDate(inputStr)) { // whois-vsan-nanny <YYYY-MM-DD>
               const oneDay = Local2Utc(days[0], tz)
               stdout = GetVSANNannyOfOneDay(oneDay)
            } else { // whois-vsan-nanny vmwareId
               const today = Local2Utc(FormatDate(new Date()), tz)
               stdout = GetVSANNannyById(inputStr, today)
            }
            break
         }
         case 2: {
            if (!IsValidDate(days[0]) || !IsValidDate(days[1])) {
               throw new Error(`Command failed: ${command}, input is not a date.`)
            }
            const startDay = Local2Utc(days[0], tz)
            const endDay = Local2Utc(days[1], tz)
            if (startDay >= endDay) {
               throw new Error(`Command failed: ${command}, end day should be greater than start day.`)
            }
            stdout = GetVSANNannyBetweenDayRange(startDay, endDay)
            break
         }
         default:
            throw new Error(`Command failed: ${command}, not support more than two days.`)
      }
   }
   return stdout
}

export { GenerateNannyReply, GenerateVSANNannyReply }
