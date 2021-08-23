import dotenv from 'dotenv'

import schedule from 'node-schedule'
import { ReportHistory, REPORT_HISTORY_STATUS } from '../src/model/report-history.js'
import { parseDateWithTz, convertTimeWithTz } from '../common/utils.js'
import { getConversationsName } from '../common/slack-helper.js'
import logger from '../common/logger.js'
import { exec } from 'child_process'
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

const execCommand = function(cmd, timeout) {
   return new Promise((resolve, reject) => {
      exec(cmd, { timeout }, (error, stdout, stderr) => {
         if (error) {
            logger.error(stderr)
            reject(error)
         } else {
            resolve(stdout)
         }
      })
   })
}

const commonHandler = async (report) => {
   logger.info(`schedule for ${report.title} ${report._id}`)
   // const REPORT_TYPE_ENUM = ['bugzilla', 'perforce', 'svs', 'fastsvs', 'text', 'customized']
   const handleExecCommand = async (command, report) => {
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
         let stdout = await execCommand(command, 10 * 60 * 1000)
         if (report.mentionUsers != null && report.mentionUsers.length > 0) {
            const mentionUsers = '\n' + (await getConversationsName(report.mentionUsers))
            stdout += mentionUsers
         }
         logger.info(stdout)

         // post reports to slack channels
         const results = await Promise.all(
            report.conversations.map(conversation => {
               return client.chat.postMessage({
                  channel: conversation,
                  text: stdout
               }).catch((e) => {
                  logger.error(`failed to post message to conversation ${conversation}, error: ${e}`)
                  return null
               })
            })
         )

         // update statue and content of report history
         reportHistory.sentTime = new Date()

         const tsMap = Object.fromEntries(
            results.filter(result => {
               return result != null
            }).map(result => {
               return [result.channel, result.ts]
            })
         )
         logger.info(tsMap)
         reportHistory.tsMap = tsMap
         reportHistory.content = stdout
         reportHistory.status = REPORT_HISTORY_STATUS.SUCCEED
         await reportHistory.save()
      } catch (e) {
         logger.error('failed to handle schedule job')
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
               logger.error('save failed report history failed again')
               logger.error(e1)
            }
         }
      }
   }

   // exec the different report generator
   switch (report.reportType) {
      case 'bugzilla':
         const scriptPath = generatorPath + 'bugzilla/reportGenerator.py'
         await handleExecCommand(`python3 ${scriptPath} --title '${report.title}' ` +
            `--url '${report.reportSpecConfig.bugzillaLink}'`, report)
         break
      // case 'perforce':
      // case 'svs':
      // case 'fastsvs':
      // case 'text':
      // case 'customized':
      default:
         logger.error(`report type ${report.reportType} not supported.`)
   }
}

const unregisterSchedule = function (id) {
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

const registerSchedule = function (report) {
   if (process.env.ENABLE_SCHEDULE !== 'true' && process.env.ENABLE_SCHEDULE !== true) {
      return
   }
   const id = report._id.toString()
   let job = scheduleJobStore[id]
   if (job != null) {
      logger.info(`cancel previous schedule job ${id} ${report.title}`)
      job.cancel()
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
      commonHandler(report)
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

export { registerSchedule, unregisterSchedule, nextInvocation, cancelNextInvocation }
