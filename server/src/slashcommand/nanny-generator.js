import path from 'path'
import fs from 'fs'
import logger from '../../common/logger.js'
import {
   ParseDateWithTz, FormatDate, Local2Utc
} from '../../common/utils.js'
import { ReportConfiguration } from '../model/report-configuration.js'
import { FindUserInfoByName } from '../model/user-info.js'
const BuglistLine = 'Bug list: https://via.vmw.com/UKKDDr'
const BotSorryReply = `Sorry, I can't get the information now since some error hit when querying the resource.\nPlease refer to the source page - https://wiki.eng.vmware.com/VSAN/Nanny#Vsan-nanny_Duty_Roster for more details.`
let vSANNannyCache = []
const NannyCodeCache = {}

const IsValidDate = (dateStr) => {
   const dateReg = /^(\d{4})-(\d{2})-(\d{2})$/
   return dateStr.length > 0 && !isNaN(Date.parse(dateStr)) && dateReg.test(dateStr)
}

async function GetReportByNannyCode(nannyCode) {
   const filter = {
      status: { $in: ['CREATED', 'ENABLED', 'DRAFT'] },
      'reportSpecConfig.nannyCode': nannyCode
   }
   const report = await ReportConfiguration.findOne(filter)
   if (report == null) {
      throw new Error(`Command failed: ${nannyCode} nanny not found.`)
   }
   return report
}

const GenerateMentionStr = (oneWeekAssigneeStr) => {
   const oneWeekAssignees = oneWeekAssigneeStr.split(',')
   if (oneWeekAssignees.length === 1) {
      return `<@${oneWeekAssigneeStr}>` + ' is'
   }
   return oneWeekAssignees.map(assignee =>
      `<@${assignee}>`
   ).join(' & ') + ' are'
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
   if (nannyCode === 'vsan') {
      stdout = await GenerateVSANNannyReply(param, command, tz)
      return stdout
   }
   const report = await GetReportByNannyCode(nannyCode)
   const nannyAssigneeStr = report?.reportSpecConfig?.nannyAssignee || ''
   const nannyAssignees = nannyAssigneeStr.split('\n')
   if (nannyAssignees.length > 0) {
      switch (param.split(' ').length) {
         case 1: {
            const mentionAssigneeStr = GenerateMentionStr(nannyAssignees[0])
            stdout = `${mentionAssigneeStr} ${nannyCode} nanny this week.`
            break
         }
         case 2: {
            const inputStr = param.split(' ')[1]
            if (IsValidDate(inputStr)) { // whois-nanny <nanny code> <YYYY-MM-DD>
               const startDayWithTZ = ParseDateWithTz(inputStr, tz)
               const startMonDate = GetMondayDate(startDayWithTZ)
               const nannyIndex = GetNannyIndexByDay(nannyAssignees, startMonDate)
               const mentionAssigneeStr = GenerateMentionStr(nannyAssignees[nannyIndex])
               stdout = `${mentionAssigneeStr} ${nannyCode} nanny at ${inputStr}.`
            } else { // whois-nanny <nanny code> vmwareId
               const userInfo = await FindUserInfoByName(inputStr)
               if (userInfo == null) {
                  throw new Error(`Command failed: ${command}, vmwareId ${inputStr} is not found.`)
               }
               const vmwareId = inputStr
               let nannyIndex = -1
               for (let i = 0; i < nannyAssignees.length; i++) {
                  const oneWeekAssignees = nannyAssignees[i].split(',')
                  if (oneWeekAssignees.indexOf(vmwareId) >= 0) {
                     nannyIndex = i
                  }
               }
               if (nannyIndex === 0) {
                  stdout = `<@${vmwareId}> is ${nannyCode} nanny this week.`
               } else if (nannyIndex > 0) {
                  const thisMondayDate = GetMondayDate(ParseDateWithTz(FormatDate(new Date()), tz))
                  const diffWeekSeconds = nannyIndex * (24 * 3600 * 1000 * 7)
                  const oneMondayDate = new Date(thisMondayDate.getTime() + diffWeekSeconds)
                  const oneSaturdayDate = new Date(oneMondayDate.getFullYear(),
                     oneMondayDate.getMonth(), oneMondayDate.getDate())
                  oneSaturdayDate.setDate(oneSaturdayDate.getDate() + 6)
                  const monDateStr = FormatDate(oneMondayDate)
                  const satDateStr = FormatDate(oneSaturdayDate)
                  stdout = `<@${vmwareId}> will be ${nannyCode} nanny from ${monDateStr} to ${satDateStr}.`
               } else {
                  stdout = `<@${vmwareId}> is not in ${nannyCode} nanny list.`
               }
            }
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
            stdout += `From ${startDay} to ${endDay} ${nannyCode} nanny duty roster:` + '\n'
            let startMonDate = GetMondayDate(startDayWithTZ)
            const satDate = new Date(startMonDate.getFullYear(), startMonDate.getMonth(),
               startMonDate.getDate())
            satDate.setDate(satDate.getDate() + 6)
            let nannyIndex = GetNannyIndexByDay(nannyAssignees, startMonDate)
            while (startMonDate <= endDayWithTZ) {
               const monDateStr = FormatDate(startMonDate)
               const satDateStr = FormatDate(satDate)
               const mentionAssigneeStr = GenerateMentionStr(nannyAssignees[nannyIndex]).replace(/is|are/, '')
               stdout += `${mentionAssigneeStr} ${monDateStr} - ${satDateStr}` + '\n'
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

const GenerateVSANNannyReply = async (param, command, tz) => {
   let stdout = ''
   switch (param.split(' ').length) {
      case 1: { // whois-nanny vsan
         const today = Local2Utc(FormatDate(new Date()), tz)
         stdout = GetVSANNannyOfOneDay(today)
         break
      }
      case 2: {
         const inputStr = param.split(' ')[1]
         if (IsValidDate(inputStr)) { // whois-nanny vsan <YYYY-MM-DD>
            const oneDay = Local2Utc(inputStr, tz)
            stdout = GetVSANNannyOfOneDay(oneDay)
         } else { // whois-nanny vsan vmwareId
            const today = Local2Utc(FormatDate(new Date()), tz)
            stdout = GetVSANNannyById(inputStr, today)
         }
         break
      }
      case 3: {
         const day1 = param.split(' ')[1]
         const day2 = param.split(' ')[2]
         if (!IsValidDate(day1) || !IsValidDate(day2)) {
            throw new Error(`Command failed: ${command}, input is not a date.`)
         }
         const startDay = Local2Utc(day1, tz)
         const endDay = Local2Utc(day2, tz)
         if (startDay >= endDay) {
            throw new Error(`Command failed: ${command}, end day should be greater than start day.`)
         }
         stdout = `From ${day1} to ${day2} vsan nanny duty roster:` + '\n'
         stdout += GetVSANNannyBetweenDayRange(startDay, endDay)
         break
      }
      default:
         throw new Error(`Command failed: ${command}, not support more than two days.`)
   }
   return stdout
}

export function AddNannyCode(report) {
   if (report.reportType === 'nanny_reminder' &&
       (report.status === 'ENABLED' || report.status === 'CREATED')) {
      NannyCodeCache[report._id] = report.reportSpecConfig.nannyCode
      logger.debug('Add nanny code, current cache is ' + JSON.stringify(NannyCodeCache))
   }
}

export function RemoveNannyCode(id) {
   delete NannyCodeCache[id.toString()]
   logger.debug('Remove nanny code, current cache is ' + JSON.stringify(NannyCodeCache))
}

export { GenerateNannyReply, NannyCodeCache }
