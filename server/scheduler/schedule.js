import dotenv from 'dotenv'
import schedule from 'node-schedule'
import { ReportHistory, REPORT_HISTORY_STATUS } from '../src/model/report-history.js'
import {
   REPORT_STATUS, FlattenMembers, ReportConfiguration
} from '../src/model/report-configuration.js'
import { UpdateP4Branches } from '../src/model/perforce-info.js'
import { UpdateTeamGroup } from '../src/model/team-group.js'
import { ParseDateWithTz, ExecCommand } from '../common/utils.js'
import {
   GetConversationsName, GetUsersName, VerifyBotInChannel
} from '../common/slack-helper.js'
import logger from '../common/logger.js'
import { WebClient } from '@slack/web-api'
import path from 'path'
import cronParser from 'cron-parser'
// check timezone
import moment from 'moment-timezone'

dotenv.config()
const systemTz = moment.tz.guess()
logger.info('system time zone ' + systemTz)

const projectRootPath = path.join(path.resolve(), '..')
const scheduleJobStore = {}
const client = new WebClient(process.env.SLACK_BOT_TOKEN)

const AsyncForEach = async function (array, callback) {
   let results = []
   for (let index = 0; index < array.length; index++) {
      results = await callback(array[index])
   }
   return results
}

const NotificationExecutor = async (report, ContentEvaluate) => {
   let reportHistory = null
   try {
      const mentionUsers = report.mentionUsers?.concat(
         report.mentionGroups?.map(group => group.value) || []) || []
      logger.debug(`mentionusers: ${mentionUsers}`)

      // filter channel IDs which bot is not in
      let adminChannelIDs = report.adminConfig?.channels?.map(
         channel => channel.split('/')[0]) || []
      if (adminChannelIDs != null && adminChannelIDs.length > 0) {
         const results = await Promise.all(
            adminChannelIDs.map(channelID => VerifyBotInChannel(channelID)
               .then(inChannel => ({ channelID, inChannel }))
            ))
         adminChannelIDs = results.filter(result => result.inChannel)
            .map(result => result.channelID)
      }
      const sendConversations = Array.from(new Set(report.conversations?.concat(
         adminChannelIDs || []) || []))
      logger.debug(`Send conversations: ${sendConversations}`)
      reportHistory = new ReportHistory({
         reportConfigId: report._id,
         title: report.title,
         creator: report.creator,
         reportType: report.reportType,
         conversations: sendConversations,
         mentionUsers: mentionUsers,
         sentTime: null,
         content: '',
         status: REPORT_HISTORY_STATUS.PENDING
      })
      await reportHistory.save()

      // 10 mins timeout
      const messageInfo = await ContentEvaluate(report)
      const messages = messageInfo.messages
      logger.info(`stdout of notification ${report.title}: ${JSON.stringify(messageInfo)}`)

      const isSkipEmptyReport = report.skipEmptyReport
      if (isSkipEmptyReport === 'Yes' && messageInfo.isEmpty === true) {
         logger.info(`The option of skip empty report is ${isSkipEmptyReport} `)
         reportHistory.content = JSON.stringify(messages[0])
         reportHistory.status = REPORT_HISTORY_STATUS.SUCCEED
         reportHistory.sentTime = new Date()
         await reportHistory.save()
         return
      }
      // post reports to slack channels
      const results = await Promise.all(
         sendConversations.map(conversation => {
            return AsyncForEach(messages, async message => {
               return await client.chat.postMessage({
                  channel: conversation,
                  text: message
               }).catch((e) => {
                  logger.error(`failed to post message to conversation ${conversation}` +
                     `since error: ${JSON.stringify(e)}`)
                  return null
               })
            })
         })
      )
      // update status and content of report history
      reportHistory.sentTime = new Date()

      const tsMap = Object.fromEntries(
         results.filter(result => {
            return result != null
         }).map(result => {
            return [result.channel, result.ts]
         })
      )
      logger.info(`the tsMap of ${reportHistory._id} is ${JSON.stringify(tsMap)}`)
      if (tsMap.size === 0) {
         throw new Error('Sent notification to all conversations failed.')
      }
      reportHistory.tsMap = tsMap
      reportHistory.content = JSON.stringify(messages[0])
      reportHistory.status = REPORT_HISTORY_STATUS.SUCCEED
      await reportHistory.save()
   } catch (e) {
      logger.error(`failed to handle schedule job since error:`)
      logger.error(e)
      if (reportHistory != null) {
         if (reportHistory.sentTime === null) {
            // record failed or timeout time
            reportHistory.sentTime = new Date()
         }
         reportHistory.content = e.message
         if (e.signal === 'SIGTERM') {
            reportHistory.status = REPORT_HISTORY_STATUS.TIMEOUT
         } else {
            reportHistory.status = REPORT_HISTORY_STATUS.FAILED
         }
         try {
            await reportHistory.save()
         } catch (e1) {
            logger.error(`save failed report history failed again since error: ${JSON.stringify(e1)}`)
         }
         // service e2e verify - send error message to monitoring channel
         let errorMessage = `*Title: ${reportHistory.title}*\n`
         errorMessage += `Sent Time: ${reportHistory.sentTime}\n`
         errorMessage += `Error: ${reportHistory.content}`
         client.chat.postMessage({
            channel: process.env.ISSUE_CHANNEL_ID,
            text: errorMessage
         })
      }
   }
}

const SchedulerCommonHandler = async (report) => {
   logger.info(`schedule for ${report.title} ${report._id}`)
   await NotificationExecutor(report, ContentEvaluate)
}

const ContentEvaluate = async (report) => {
   const CalculatePeriod = () => {
      let startTime = new Date()
      const endTime = new Date()
      switch (report.repeatConfig.repeatType) {
         case 'hourly':
            startTime.setHours(endTime.getHours() - 1)
            break
         case 'daily':
            startTime.setDate(endTime.getDate() - 1)
            break
         case 'weekly':
            startTime.setDate(endTime.getDate() - 7)
            break
         case 'monthly':
            startTime.setMonth(endTime.getMonth() - 1)
            break
         case 'cron_expression':
            const interval = cronParser.parseExpression(report.repeatConfig.cronExpression)
            startTime = interval.prev()
            console.log(startTime)
            break
         default:
            // not_repeat type is default
            startTime.setDate(endTime.getDate() - 1)
            break
      }
      return { startTime, endTime }
   }
   // exec the different report generator
   let timeout = 10 * 60 * 1000
   let scriptPath = ''
   let stdout = ''
   let command = ''
   const reportTitle = report.title.replace(/'/g, '%27')
   switch (report.reportType) {
      case 'bugzilla': {
         scriptPath = projectRootPath + '/generator/src/notification/bugzilla_report.py'
         command = `PYTHONPATH=${projectRootPath} python3 ${scriptPath} ` +
            `--title '${reportTitle}' ` +
            `--url '${report.reportSpecConfig.bugzillaLink}'`
         logger.debug(`execute the bugzilla report generator: ${command}`)
         stdout = await ExecCommand(command, timeout)
         break
      }
      case 'text': {
         stdout = report.reportSpecConfig.text
         break
      }
      case 'perforce_checkin': {
         scriptPath = projectRootPath + '/generator/src/notification/perforce_checkin_report.py'
         const { startTime, endTime } = CalculatePeriod()
         logger.info(JSON.stringify(startTime))
         command = `PYTHONPATH=${projectRootPath} python3 ${scriptPath} \
            --title '${reportTitle}' \
            --branches '${report.reportSpecConfig.perforceCheckIn.branches.join(',')}' \
            --users '${report.reportSpecConfig.perforceCheckIn.flattenMembers.join(',')}' \
            --startTime ${startTime.getTime() / 1000} \
            --endTime ${endTime.getTime() / 1000}`
         logger.debug(`execute the perforce checkin report generator: ${command}`)
         stdout = await ExecCommand(command, timeout)
         break
      }
      case 'perforce_review_check': {
         timeout = 60 * 60 * 1000
         scriptPath = projectRootPath + '/generator/src/notification/' +
            'perforce_review_check_report.py'
         const { startTime, endTime } = CalculatePeriod()
         logger.info(JSON.stringify(startTime))
         command = `PYTHONPATH=${projectRootPath} python3 ${scriptPath} \
            --title '${reportTitle}' \
            --branches '${report.reportSpecConfig.perforceReviewCheck.branches.join(',')}' \
            --users '${report.reportSpecConfig.perforceReviewCheck.flattenMembers.join(',')}' \
            --startTime ${startTime.getTime() / 1000} \
            --endTime ${endTime.getTime() / 1000}`
         logger.debug(`execute the perforce review check report generator: ${command}`)
         stdout = await ExecCommand(command, timeout)
         break
      }
      case 'bugzilla_by_assignee': {
         scriptPath = projectRootPath + '/generator/src/notification/bugzilla_assignee_report.py'
         const assignees = await GetUsersName(report.reportSpecConfig.bugzillaAssignee)
         command = `PYTHONPATH=${projectRootPath} python3 ${scriptPath} ` +
         `--title '${reportTitle}' ` +
         `--users '${assignees.join(',')}'`
         logger.debug(`execute the bugzilla by assignee report generator: ${command}`)
         stdout = await ExecCommand(command, timeout)
         break
      }
      // case 'svs':
      // case 'fastsvs':
      // case 'customized':
      default:
         throw new Error(`report type ${report.reportType} not supported.`)
   }
   let mentionUserNames = ''
   const mentionUsers = report.mentionUsers?.concat(
      report.mentionGroups?.map(group => group.value) || []) || []
   logger.debug(`mentionusers: ${mentionUsers}`)
   if (mentionUsers != null && mentionUsers.length > 0) {
      mentionUserNames = '\n' + (await GetConversationsName(mentionUsers))
   }
   // If the report type is text, we return the report content by array directly.
   if (report.reportType === 'text') {
      stdout += mentionUserNames
      return { messages: [stdout], isEmpty: false }
   }
   try {
      const output = JSON.parse(stdout)
      // Here output's format is {“messages”: [“……“, “……“], “isEmpty”: False}
      if (typeof output === 'object' && Array.isArray(output.messages)) {
         const messages = output.messages?.map(message => unescape(message)) || []
         if (messages.length > 0) {
            messages[messages.length - 1] += mentionUserNames
         }
         return { messages: messages, isEmpty: output.isEmpty }
      }
   } catch (e) {
      logger.error(`failed to JSON.parse(stdout):`)
      logger.error(e)
   }
   return { messages: [stdout], isEmpty: false }
}

const UnregisterScheduler = function (id) {
   if (id == null) {
      throw new Error('scheduler id is null, can not unregister scheduler')
   }
   logger.info(`start to cancel previous schedule job ${id}`)
   const job = scheduleJobStore[id.toString()]
   if (job != null) {
      logger.info(`cancel previous schedule job ${id}`)
      job.cancel()
   } else {
      logger.warn(`failed to cancel previous schedule job ${id}`)
   }
   delete scheduleJobStore[id.toString()]
}

const RegisterScheduler = function (report) {
   if (process.env.ENABLE_SCHEDULE !== 'true' && process.env.ENABLE_SCHEDULE !== true) {
      return
   }
   const id = report._id.toString()
   let job = scheduleJobStore[id]
   if (job != null) {
      logger.info(`cancel previous schedule job ${id} of ${report.title}`)
      job.cancel()
   }

   if (report.status !== REPORT_STATUS.ENABLED) {
      logger.info(`this report ${id} is ${report.status}, not enabled, skip the register.`)
      return null
   }

   const repeatConfig = report.repeatConfig
   let scheduleOption = { start: repeatConfig.startDate, end: repeatConfig.endDate }
   let rule = new schedule.RecurrenceRule()

   switch (repeatConfig.repeatType) {
      case 'not_repeat':
         const dateStr = `${repeatConfig.date} ${repeatConfig.time}`
         const date = ParseDateWithTz(dateStr, repeatConfig.tz)
         scheduleOption = date
         break
      case 'hourly':
         rule.minute = repeatConfig.minsOfHour
         scheduleOption.rule = rule
         break
      case 'daily':
         rule.hour = repeatConfig.time.split(':')[0]
         rule.minute = repeatConfig.time.split(':')[1]
         scheduleOption.tz = repeatConfig.tz
         scheduleOption.rule = rule
         break
      case 'weekly':
         rule.dayOfWeek = repeatConfig.dayOfWeek
         rule.hour = repeatConfig.time.split(':')[0]
         rule.minute = repeatConfig.time.split(':')[1]
         scheduleOption.tz = repeatConfig.tz
         scheduleOption.rule = rule
         break
      case 'monthly':
         rule.date = repeatConfig.dayOfMonth
         rule.hour = repeatConfig.time.split(':')[0]
         rule.minute = repeatConfig.time.split(':')[1]
         scheduleOption.tz = repeatConfig.tz
         scheduleOption.rule = rule
         break
      case 'cron_expression':
         rule = repeatConfig.cronExpression
         scheduleOption.tz = repeatConfig.tz
         scheduleOption.rule = rule
         break
      default:
         throw new Error('invalid repeat type')
   }

   job = schedule.scheduleJob(scheduleOption, async function (report) {
      const currentReport = await ReportConfiguration.findById(id)
      SchedulerCommonHandler(currentReport)
   })
   if (job != null) {
      logger.debug(`next invocation of report ${report.title} ${job.nextInvocation()}`)
      scheduleJobStore[report._id] = job
      logger.info(`success to schedule job ${report._id} ${report.title} ${JSON.stringify(scheduleOption)}`)
   } else {
      logger.warn(`fail to schedule job ${report._id} ${report.title} ${JSON.stringify(scheduleOption)}`)
   }
   return job
}

const NextInvocation = function (id) {
   if (id == null) {
      throw new Error('scheduler id is null, can not query next scheduler')
   }
   logger.info(`start to query next invocation for job ${id}`)
   const job = scheduleJobStore[id.toString()]
   if (job != null) {
      return job.nextInvocation()
   } else {
      logger.warn(`failed to query next invocation since no job for ${id}`)
      return null
   }
}

const CancelNextInvocation = function (id) {
   if (id == null) {
      throw new Error('scheduler id is null, can not cancel next report sending')
   }
   logger.info(`start to cancel next invocation for job ${id}`)
   const job = scheduleJobStore[id.toString()]
   if (job != null) {
      job.cancelNext()
   } else {
      logger.warn(`failed to cancel next invocation since no job for ${id}`)
   }
}

const InvokeNow = async function (id, sendToUserId) {
   if (id == null) {
      throw new Error('scheduler id is null, can not cancel next report sending')
   }
   logger.info(`start to immediately invoke for job ${id}`)
   const job = scheduleJobStore[id.toString()]
   if (job != null) {
      if (sendToUserId) {
         const report = await ReportConfiguration.findById(id)
         const messageInfo = await ContentEvaluate(report)
         const messages = messageInfo.messages
         logger.debug(`send notification to me now: ${JSON.stringify(messageInfo)}`)
         AsyncForEach(messages, async message => {
            await client.chat.postMessage({
               channel: sendToUserId,
               text: message
            })
         })
      } else {
         job.invoke()
      }
   } else {
      logger.warn(`failed to immediately invoke since no job for ${id}`)
   }
}

// register scheduler for updating branches of all perforce projects in db
const RegisterPerforceInfoScheduler = function () {
   const job = schedule.scheduleJob('0 21 * * *', function () {
      UpdateP4Branches()
   })
   return job
}

// register scheduler for flatten members of all perforce checkin report in db
const RegisterPerforceMembersScheduler = function () {
   const job = schedule.scheduleJob('10 21 * * *', async function () {
      const allMembersFilters = (await ReportConfiguration.find({ reportType: 'perforce_checkin' }))
         .map(report => ({
            report,
            membersFilters: report.reportSpecConfig?.perforceCheckIn?.membersFilters || []
         }))
      await Promise.all(allMembersFilters.map(report => {
         return FlattenMembers(report.membersFilters).then(members => {
            if (report.reportSpecConfig?.perforceCheckIn != null) {
               report.reportSpecConfig.perforceCheckIn.flattenMembers = members
               report.save()
            }
         })
      }))
   })
   return job
}

const RegisterTeamGroupScheduler = function () {
   const job = schedule.scheduleJob('20 21 * * *', async function () {
      UpdateTeamGroup()
   })
   return job
}
export {
   RegisterScheduler, UnregisterScheduler, NextInvocation,
   CancelNextInvocation, InvokeNow,
   RegisterPerforceInfoScheduler, RegisterPerforceMembersScheduler,
   RegisterTeamGroupScheduler
}
