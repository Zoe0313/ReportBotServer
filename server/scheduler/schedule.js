import dotenv from 'dotenv'
dotenv.config()

import schedule from 'node-schedule'
import { ReportHistory } from '../src/model/report-history.js'
import { parseDateWithTz, convertTimeWithTz } from '../common/utils.js'
import logger from '../common/logger.js'
import { exec } from 'child_process'
import { WebClient } from '@slack/web-api'
import path from 'path'

// check timezone
import moment from 'moment-timezone'
const systemTz = moment.tz.guess()
logger.info('system time zone ' + systemTz)

const generatorPath = path.join(path.resolve(), '../generator/')
const scheduleJobStore = {}
const client = new WebClient(process.env.SLACK_BOT_TOKEN)

const execCommand = function (cmd) {
   return new Promise((resolve, reject) => {
      exec(cmd, (error, stdout, stderr) => {
         if (error) {
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
      try {
         const stdout = await execCommand(command)
         logger.info(stdout)
         await Promise.all(
            report.conversations.map(conversation => {
               client.chat.postMessage({
                  channel: conversation,
                  text: stdout
               })
            })
         )
         const reportHistory = new ReportHistory({
            reportConfigId: report._id,
            title: report.title,
            creator: report.creator,
            reportType: report.reportType,
            conversations: report.conversations,
            reportUsers: report.reportUsers,
            sentTime: new Date(),
            content: stdout,
            result: true
         })
         reportHistory.save()
      } catch (e) {
         logger.error(e)
         const reportHistory = new ReportHistory({
            reportConfigId: report._id,
            title: report.title,
            creator: report.creator,
            reportType: report.reportType,
            conversations: report.conversations,
            reportUsers: report.reportUsers,
            sentTime: new Date(),
            content: e.message,
            result: false
         })
         reportHistory.save()
      }
   }
   switch (report.reportType) {
      case 'bugzilla':
         const scriptPath = generatorPath + 'bugzilla/reportGenerator.py'
         await handleExecCommand(`python3 ${scriptPath} --title '${report.title}' --url '${report.reportLink}'`, report)
         break
      case 'perforce':
      case 'svs':
      case 'fastsvs':
      case 'text':
      case 'customized':
      default:
         logger.error(`report type ${report.reportType} not supported.`)
   }
}

const unregisterSchedule = function (id) {
   if (id == null) {
      throw new Error('scheduler id is null, can not unregister scheduler')
   }
   logger.info(`start to cancel previous schedule job ${id}`)
   let job = scheduleJobStore[id]
   if (job != null) {
      logger.info(`cancel previous schedule job ${id}`)
      job.cancel()
   } else {
      logger.info(`failed to cancel previous schedule job ${id}`)
   }
   delete scheduleJobStore[id]
}

const registerSchedule = function (report) {
   if (process.env.ENABLE_SCHEDULE != 'true') {
      return
   }
   const id = report._id
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
      logger.info(`fail to schedule job ${report._id} ${report.title} ${JSON.stringify(scheduleOption)}`) 
   }
   return job
}

const nextInvocation = function (id) {
   if (id == null) {
      throw new Error('scheduler id is null, can not query next scheduler')
   }
   logger.info(`start to query next invocation for job ${id}`)
   let job = scheduleJobStore[id]
   if (job != null) {
      return job.nextInvocation()
   } else {
      logger.info(`failed to query next invocation since no job for ${id}`)
      return null
   }
}

const cancelNextInvocation = function (id) {
   if (id == null) {
      throw new Error('scheduler id is null, can not cancel next report sending')
   }
   logger.info(`start to cancel next invocation for job ${id}`)
   let job = scheduleJobStore[id]
   if (job != null) {
      job.cancelNext()
   } else {
      logger.info(`failed to cancel next invocation since no job for ${id}`)
   }
}


export { registerSchedule, unregisterSchedule, nextInvocation, cancelNextInvocation }