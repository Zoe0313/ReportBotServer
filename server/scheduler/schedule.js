import dotenv from 'dotenv'

import schedule from 'node-schedule'
import { ReportHistory, REPORT_HISTORY_STATUS } from '../src/model/report-history.js'
import {
   REPORT_STATUS, flattenPerforceCheckinMembers, ReportConfiguration
} from '../src/model/report-configuration.js'
import { updateP4Branches } from '../src/model/perforce-info.js'
import { parseDateWithTz, convertTimeWithTz, execCommand } from '../common/utils.js'
import { getConversationsName } from '../common/slack-helper.js'
import logger from '../common/logger.js'
import { WebClient } from '@slack/web-api'
import path from 'path'
// check timezone
import moment from 'moment-timezone'

dotenv.config()
const systemTz = moment.tz.guess()
logger.info('system time zone ' + systemTz)

const generatorPath = path.join(path.resolve(), '../generator/')
const scheduleJobStore = {}
const client = new WebClient(process.env.SLACK_BOT_TOKEN)

const notificationExecutor = async (report, contentEvaluate) => {
   let reportHistory = null
   try {
      reportHistory = new ReportHistory({
         reportConfigId: report._id,
         title: report.title,
         creator: report.creator,
         reportType: report.reportType,
         conversations: report.conversations,
         mentionUsers: report.mentionUsers,
         sentTime: null,
         content: '',
         status: REPORT_HISTORY_STATUS.PENDING
      })
      await reportHistory.save()

      // 10 mins timeout
      let stdout = await contentEvaluate(report)
      if (report.mentionUsers != null && report.mentionUsers.length > 0) {
         const mentionUsers = '\n' + (await getConversationsName(report.mentionUsers))
         stdout += mentionUsers
      }
      logger.info(`stdout of notification ${report.title}: ${stdout}`)

      // post reports to slack channels
      const results = await Promise.all(
         report.conversations.map(conversation => {
            return client.chat.postMessage({
               channel: conversation,
               text: stdout
            }).catch((e) => {
               logger.error(`failed to post message to conversation ${conversation}` +
                  `since error: ${JSON.stringify(e)}`)
               return null
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
      reportHistory.content = stdout
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
      }
   }
}

const schedulerCommonHandler = async (report) => {
   logger.info(`schedule for ${report.title} ${report._id}`)
   await notificationExecutor(report, contentEvaluate)
}

const contentEvaluate = async (report) => {
   // exec the different report generator
   const timeout = 10 * 60 * 1000
   let scriptPath = ''
   switch (report.reportType) {
      case 'bugzilla':
         scriptPath = generatorPath + 'bugzilla/reportGenerator.py'
         return await execCommand(`python3 ${scriptPath} --title '${report.title}' ` +
               `--url '${report.reportSpecConfig.bugzillaLink}'`, timeout)
      case 'text':
         return report.reportSpecConfig.text
      case 'perforce_checkin':
         scriptPath = generatorPath + 'src/notification/p4_report.py'
         let startTime = report.createdAt.getTime()
         const reportHistories = await ReportHistory.find({
            reportConfigId: report._id,
            status: REPORT_HISTORY_STATUS.SUCCEED
         }).sort({ sentTime: -1 })

         // check time range is from last triggered time to current time
         if (reportHistories.length > 0) {
            startTime = reportHistories[0].sentTime.getTime()
         }

         return await execCommand(`
            python3 ${scriptPath} \
            --branches '${report.reportSpecConfig.perforceCheckIn.branches.join(',')}' \
            --users '${report.reportSpecConfig.perforceCheckIn.flattenMembers.join(',')}' \
            --startTime ${startTime} \
            --endTime ${new Date().getTime()}
            `, timeout)
      // case 'svs':
      // case 'fastsvs':
      // case 'customized':
      default:
         throw new Error(`report type ${report.reportType} not supported.`)
   }
}

const unregisterScheduler = function (id) {
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

const registerScheduler = function (report) {
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
   const convertedTime = convertTimeWithTz(repeatConfig.time, repeatConfig.tz, systemTz)

   switch (repeatConfig.repeatType) {
      case 'not_repeat':
         const dateStr = `${repeatConfig.date} ${repeatConfig.time}`
         const date = parseDateWithTz(dateStr, repeatConfig.tz)
         scheduleOption = date
         break
      case 'hourly':
         rule.minute = repeatConfig.minsOfHour
         scheduleOption.rule = rule
         break
      case 'daily':
         rule.hour = convertedTime.split(':')[0]
         rule.minute = convertedTime.split(':')[1]
         scheduleOption.rule = rule
         break
      case 'weekly':
         rule.dayOfWeek = repeatConfig.dayOfWeek
         rule.hour = convertedTime.split(':')[0]
         rule.minute = convertedTime.split(':')[1]
         scheduleOption.rule = rule
         break
      case 'monthly':
         rule.date = repeatConfig.dayOfMonth
         rule.hour = convertedTime.split(':')[0]
         rule.minute = convertedTime.split(':')[1]
         scheduleOption.rule = rule
         break
      case 'cron_expression':
         rule = repeatConfig.cronExpression
         scheduleOption.rule = rule
         break
      default:
         throw new Error('invalid repeat type')
   }

   job = schedule.scheduleJob(scheduleOption, function (report) {
      schedulerCommonHandler(report)
   }.bind(null, report))
   if (job != null) {
      scheduleJobStore[report._id] = job
      logger.info(`success to schedule job ${report._id} ${report.title} ${JSON.stringify(scheduleOption)}`)
   } else {
      logger.warn(`fail to schedule job ${report._id} ${report.title} ${JSON.stringify(scheduleOption)}`)
   }
   return job
}

const nextInvocation = function (id) {
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

const cancelNextInvocation = function (id) {
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

const invokeNow = async function (id, sendToUserId) {
   if (id == null) {
      throw new Error('scheduler id is null, can not cancel next report sending')
   }
   logger.info(`start to immediately invoke for job ${id}`)
   const job = scheduleJobStore[id.toString()]
   if (job != null) {
      if (sendToUserId) {
         const report = await ReportConfiguration.findById(id)
         const stdout = await contentEvaluate(report)
         client.chat.postMessage({
            channel: sendToUserId,
            text: stdout
         })
      } else {
         job.invoke()
      }
   } else {
      logger.warn(`failed to immediately invoke since no job for ${id}`)
   }
}

// register scheduler for updating branches of all perforce projects in db
const registerPerforceInfoScheduler = function () {
   const job = schedule.scheduleJob('0 21 * * *', function () {
      updateP4Branches()
   })
   return job
}

// register scheduler for flatten members of all perforce checkin report in db
const registerPerforceMembersScheduler = function () {
   const job = schedule.scheduleJob('30 21 * * *', async function () {
      const allMembersFilters = (await ReportConfiguration.find({ reportType: 'perforce_checkin' }))
         .map(report => ({
            report,
            membersFilters: report.reportSpecConfig?.perforceCheckIn?.membersFilters || []
         }))
      await Promise.all(allMembersFilters.map(report => {
         return flattenPerforceCheckinMembers(report.membersFilters).then(members => {
            if (report.reportSpecConfig?.perforceCheckIn != null) {
               report.reportSpecConfig.perforceCheckIn.flattenMembers = members
               report.save()
            }
         })
      }))
   })
   return job
}

export {
   registerScheduler, unregisterScheduler, nextInvocation,
   cancelNextInvocation, invokeNow,
   registerPerforceInfoScheduler, registerPerforceMembersScheduler
}
