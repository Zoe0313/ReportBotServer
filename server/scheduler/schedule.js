import dotenv from 'dotenv'
import axios from 'axios'
import schedule from 'node-schedule'
import { ReportHistory, REPORT_HISTORY_STATUS } from '../src/model/report-history.js'
import {
   REPORT_STATUS, FlattenMembers, ReportConfiguration
} from '../src/model/report-configuration.js'
import { UpdateP4Branches } from '../src/model/perforce-info.js'
import { UpdateTeamGroup } from '../src/model/team-group.js'
import { ParseDateWithTz, ExecCommand } from '../common/utils.js'
import {
   GetUsersName, VMwareId2GoogleUserInfo
} from '../common/slack-helper.js'
import logger from '../common/logger.js'
import path from 'path'
import cronParser from 'cron-parser'
import { GenerateNannyRoster } from '../src/bolt_service/init-blocks-data-helper.js'
import {
   LoadNannyList, AddNannyCode, RemoveNannyCode
} from '../src/slashcommand/nanny-generator.js'
// check timezone
import moment from 'moment-timezone'

dotenv.config()
const systemTz = moment.tz.guess()
logger.info('system time zone ' + systemTz)

const projectRootPath = path.join(path.resolve(), '..')
const scheduleJobStore = {}
const updateNannyScheduleJobStore = {}
const CONTENT_TYPE_JSON_UTF = { 'Content-Type': 'application/json; charset=UTF-8' }

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
      const mentionUsers = report.mentionUsers || []
      logger.debug(`mentionusers: ${mentionUsers}`)

      let isWebhookEmpty = false
      const sendWebhooks = Array.from(new Set(report.webhooks || []))
      if (sendWebhooks.length === 0) {
         sendWebhooks.push(process.env.ISSUE_GCHAT_WEBHOOK)
         isWebhookEmpty = true
      }
      logger.debug(`Send webhooks: ${JSON.stringify(sendWebhooks)}`)
      reportHistory = new ReportHistory({
         reportConfigId: report._id,
         title: report.title,
         creator: report.creator,
         reportType: report.reportType,
         conversations: sendWebhooks,
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

      // post reports to Google spaces
      const results = await Promise.all(
         sendWebhooks.map(webhook => {
            return AsyncForEach(messages, async message => {
               if (isWebhookEmpty === true) {
                  message = `[*Webhook Empty* ID_${report._id}]\n` + message
               }
               const appMessage = { text: message }
               const webhookWithId = webhook + messageInfo.webhookUserIds
               try {
                  const response = await axios.post(
                     webhookWithId,
                     JSON.stringify(appMessage),
                     { headers: CONTENT_TYPE_JSON_UTF }
                  )
                  logger.debug(JSON.stringify(response.data))
                  return { webhook: webhookWithId, result: response.data }
               } catch (e) {
                  const errorMessage = `Fail to post message by webhook ${webhookWithId}` +
                     `, error: ${JSON.stringify(e)}`
                  logger.error(errorMessage)
                  return { webhook: webhookWithId, result: null }
               }
            })
         })
      )
      const tsMap = Object.fromEntries(
         results.filter(data => {
            return data.result != null
         }).map(data => {
            // we use 'thread.name' to send thread message.
            // we couldn't delete sent message by webhook and thread.name. (to be design)
            return [data.webhook, data.result.thread.name]
         })
      )
      logger.info(`the tsMap of Google Chat is ${JSON.stringify(tsMap)}`)
      if (tsMap.size === 0) {
         throw new Error('Sent notification to all spaces failed.')
      }
      // check the via link is stable or not. If unstable, send bugzilla full link to thread.
      if (report.reportType === 'bugzilla') {
         try {
            await axios({
               method: 'get', url: 'https://via.vmw.com/', timeout: 5000
            })
         } catch (e) {
            logger.error(`Via link is unstable. Error: ${JSON.stringify(e)}`)
            const threadMessage = 'via short link service is in maintenance, please use the <' +
               `${report.reportSpecConfig.bugzillaLink}` + '|full link>'
            // send thread message in Google Chat
            for (const webhook in tsMap) {
               const threadName = tsMap[webhook]
               const appMessage = { text: threadMessage, thread: { name: threadName } }
               const webhookWithOpt = webhook +
                  '&messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD'
               try {
                  await axios.post(
                     webhookWithOpt,
                     JSON.stringify(appMessage),
                     { headers: CONTENT_TYPE_JSON_UTF }
                  )
               } catch (e) {
                  logger.error(`Fail to post message to Google Space thread ${threadName}` +
                     `since error: ${JSON.stringify(e)}`)
               }
            }
         }
      }
      // update status and content of report history
      reportHistory.sentTime = new Date()
      // reportHistory.tsMap = tsMap // validation error
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
         axios.post(
            process.env.ISSUE_GCHAT_WEBHOOK,
            JSON.stringify({ text: errorMessage }),
            { headers: CONTENT_TYPE_JSON_UTF }
         )
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
            --needCheckinApproved '${report.reportSpecConfig.perforceCheckIn.needCheckinApproved}' \
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
         let assignees = await GetUsersName(report.reportSpecConfig.bugzillaAssignee)
         assignees = assignees.filter(value => value != null)
         if (assignees.length > 0) {
            command = `PYTHONPATH=${projectRootPath} python3 ${scriptPath} \
               --title '${reportTitle}' \
               --users '${assignees.join(',')}'`
            logger.debug(`execute the bugzilla by assignee report generator: ${command}`)
            stdout = await ExecCommand(command, timeout)
         }
         if (stdout === '') {
            throw new Error(`Fail to generate bugzilla_by_assignee report because of ` +
               `${report.reportSpecConfig.bugzillaAssignee} not find in db.userinfos`)
         }
         break
      }
      case 'nanny_reminder': {
         const MentionNannys = (text, nannyVMwareIds, mentionKey) => {
            for (let i = 0; i < nannyVMwareIds.length; i++) {
               const vmwareId = nannyVMwareIds[i]
               let nannyMentionKey = `@${mentionKey}`
               let nannyFullNameKey = `${mentionKey}` + '-full-name'
               if (nannyVMwareIds.length > 1) {
                  nannyMentionKey = nannyMentionKey + `${i + 1}`
                  nannyFullNameKey = nannyFullNameKey + `${i + 1}`
               }
               const gUserInfo = VMwareId2GoogleUserInfo(vmwareId)
               // Mention nanny in Google Chat by <users/Google user ID>
               if (gUserInfo.gid.length > 0) {
                  text = text.replace(nannyMentionKey, `<users/${gUserInfo.gid}>`)
               } else {
                  text = text.replace(nannyMentionKey, `@${vmwareId}`)
               }
               if (gUserInfo.full_name.length > 0) {
                  text = text.replace(nannyFullNameKey, gUserInfo.full_name)
               } else {
                  text = text.replace(nannyFullNameKey, `@${vmwareId}`)
               }
            }
            return text
         }
         stdout = report.reportSpecConfig.text
         const assignees = report.reportSpecConfig.nannyAssignee.split('\n')
         const thisTimeNannys = assignees[0].split(',')
         const nextTimeNannys = assignees[1].split(',')
         let resultText = stdout
         if (stdout.indexOf('this-nanny') >= 0) {
            resultText = MentionNannys(resultText, thisTimeNannys, 'this-nanny')
         }
         if (stdout.indexOf('next-nanny') >= 0) {
            resultText = MentionNannys(resultText, nextTimeNannys, 'next-nanny')
         }
         stdout = resultText
         break
      }
      case 'jira_list': {
         let assignees = await GetUsersName([report.creator])
         assignees = assignees.filter(value => value != null)
         let creatorName = ''
         if (assignees.length > 0) {
            creatorName = assignees[0]
         } else if (report.reportSpecConfig.jira.jql.indexOf('currentUser()') >= 0) {
            throw new Error(`Fail to generate jira list report because of ` +
               `${report.creator} not find in db.userinfos`)
         }
         scriptPath = projectRootPath + '/generator/src/notification/jira_list_report.py'
         command = `PYTHONPATH=${projectRootPath} python3 ${scriptPath} \
            --title '${reportTitle}' \
            --jql '${escape(report.reportSpecConfig.jira.jql)}' \
            --fields '${report.reportSpecConfig.jira.fields.join(',')}' \
            --groupby '${report.reportSpecConfig.jira.groupby}' \
            --creator '${creatorName}'`
         logger.debug(`execute the jira report generator: ${command}`)
         stdout = await ExecCommand(command, timeout)
         break
      }
      // case 'svs':
      // case 'fastsvs':
      // case 'customized':
      default:
         throw new Error(`report type ${report.reportType} not supported.`)
   }
   let mentionUserIds = '' // shown by google chat format: <users/user ID>
   let gIdsStr = '' // used in google chat webhook
   if (report.mentionUsers != null && report.mentionUsers.length > 0) { // need to mention user in message
      const vmwareIds = await GetUsersName(report.mentionUsers)
      const googleUserIds = vmwareIds.map(vmwareId => {
         return VMwareId2GoogleUserInfo(vmwareId).gid
      }).filter(value => value.length > 0)
      mentionUserIds = '\n' + googleUserIds.map(userId => {
         return `<users/${userId}>`
      }).join(', ')
      gIdsStr = '&id=' + googleUserIds.join(',')
   }
   // If the report type is text or nanny_reminder, we return the report content by array directly.
   if (report.reportType === 'text' || report.reportType === 'nanny_reminder') {
      stdout += mentionUserIds
      return { messages: [stdout], isEmpty: false, webhookUserIds: gIdsStr }
   }
   try {
      const output = JSON.parse(stdout)
      // Here output's format is {“messages”: [“……“, “……“], “isEmpty”: False}
      if (typeof output === 'object' && Array.isArray(output.messages)) {
         const messages = output.messages?.map(message => unescape(message)) || []
         if (messages.length > 0) {
            messages[messages.length - 1] += mentionUserIds
         }
         return { messages: messages, isEmpty: output.isEmpty, webhookUserIds: gIdsStr }
      }
   } catch (e) {
      logger.error(`Fail to parse report generator stdout:`)
      logger.error(e)
   }
   return { messages: [stdout], isEmpty: false, webhookUserIds: gIdsStr }
}

const ScheduleOption = function (repeatConfig) {
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
   return scheduleOption
}

const UnregisterScheduler = async function (id) {
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

   const report = await ReportConfiguration.findById(id)
   if (report != null && report.reportType === 'nanny_reminder') {
      // unregister update nanny roster scheduler job
      UnregisterUpdateNannyScheduler(id)
      // remove the nanny code of disabled/removed report
      RemoveNannyCode(id)
   }
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

   // Add/Update the nanny code of created/enabled nanny report
   AddNannyCode(report)

   if (report.status !== REPORT_STATUS.ENABLED) {
      logger.info(`this report ${id} is ${report.status}, not enabled, skip the register.`)
      return null
   }

   const repeatConfig = report.repeatConfig
   const scheduleOption = ScheduleOption(repeatConfig)
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
   if (report.reportType === 'nanny_reminder') {
      RegisterUpdateNannyScheduler(report)
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
         logger.debug(`send notification to test space now: ${JSON.stringify(messageInfo)}`)
         AsyncForEach(messages, async message => {
            await axios.post(
               process.env.DEV_GCHAT_WEBHOOK,
               JSON.stringify({ text: message }),
               { headers: CONTENT_TYPE_JSON_UTF }
            )
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

const UpdateNannyRoster = async function (report) {
   const tz = report.repeatConfig.tz
   if (report.reportSpecConfig?.nannyRoster != null) {
      report.reportSpecConfig.nannyRoster = await GenerateNannyRoster(report, true, tz)
      await report.save()
   }
   logger.info(`Recycle nanny roster:\n${report.reportSpecConfig?.nannyRoster}`)
}

const UnregisterUpdateNannyScheduler = function (id) {
   if (id == null) {
      throw new Error('scheduler id is null, can not unregister scheduler')
   }
   logger.info(`Start to cancel previous update nanny list schedule job ${id}`)
   const job = updateNannyScheduleJobStore[id.toString()]
   if (job != null) {
      logger.info(`Cancel update nanny roster schedule job ${id}`)
      job.cancel()
   } else {
      logger.warn(`Failed to cancel previous update nanny list schedule job ${id}`)
   }
   delete updateNannyScheduleJobStore[id.toString()]
}

const RegisterUpdateNannyScheduler = function (report) {
   const id = report._id.toString()
   let job = updateNannyScheduleJobStore[id]
   if (job != null) {
      logger.info(`Cancel previous update nanny list schedule job ${id} of ${report.title}`)
      job.cancel()
   }

   if (report.status !== REPORT_STATUS.ENABLED) {
      logger.info(`this report ${id} is ${report.status}, not enabled, skip the register.`)
      return null
   }

   const repeatConfig = report.repeatConfig
   switch (repeatConfig.repeatType) {
      case 'hourly':
         repeatConfig.minsOfHour = '0'
         break
      case 'daily':
         repeatConfig.time = '00:00'
         break
      case 'weekly':
         repeatConfig.dayOfWeek = [1] // the type of dayOfWeek is a array of number, not number.
         repeatConfig.time = '00:00'
         break
      case 'monthly':
         repeatConfig.dayOfMonth = 1
         repeatConfig.time = '00:00'
         break
   }
   const scheduleOption = ScheduleOption(repeatConfig)
   job = schedule.scheduleJob(scheduleOption, async function (report) {
      const currentReport = await ReportConfiguration.findById(id)
      UpdateNannyRoster(currentReport)
   })
   if (job != null) {
      logger.debug(`Next invocation of report ${report.title} ${job.nextInvocation()}`)
      updateNannyScheduleJobStore[report._id] = job
      logger.info(`Success to schedule update nanny job ${report._id} ${report.title} ${JSON.stringify(scheduleOption)}`)
   } else {
      logger.warn(`Fail to schedule update nanny job ${report._id} ${report.title} ${JSON.stringify(scheduleOption)}`)
   }
   return job
}

const UpdateVSANNanny = async () => {
   try {
      const command = `PYTHONPATH=${projectRootPath} python3 ${projectRootPath}` +
         '/generator/src/utils/RefreshVsanNannyList.py'
      logger.debug(`execute the refresh vsan-nanny.csv command: ${command}`)
      await ExecCommand(command, 60 * 1000)
   } catch (e) {
      logger.error(`Fail to update vsan-nanny.csv since error: ${e.message}`)
   }
}

const RegisterVSANNannyScheduler = function () {
   const job = schedule.scheduleJob('30 1 * * 1', async function () {
      await UpdateVSANNanny()
      LoadNannyList()
   })
   return job
}

export {
   RegisterScheduler, UnregisterScheduler, NextInvocation,
   CancelNextInvocation, InvokeNow, ContentEvaluate,
   RegisterPerforceInfoScheduler, RegisterPerforceMembersScheduler,
   RegisterTeamGroupScheduler, RegisterVSANNannyScheduler
}
