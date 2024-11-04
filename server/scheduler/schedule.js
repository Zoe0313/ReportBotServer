import dotenv from 'dotenv'
import axios from 'axios'
import schedule from 'node-schedule'
import { ReportHistory, REPORT_HISTORY_STATUS } from '../src/model/report-history.js'
import {
   REPORT_STATUS, FlattenMembers, ReportConfiguration
} from '../src/model/report-configuration.js'
import { UpdateP4Branches } from '../src/model/perforce-info.js'
import { UpdateTeamGroup } from '../src/model/team-group.js'
import { UpdateMailList, QueryUserInfoByName } from '../src/model/mail-info.js'
import { ParseDateWithTz, ExecCommand } from '../common/utils.js'
import logger from '../common/logger.js'
import path from 'path'
import cronParser from 'cron-parser'
import { GenerateNannyRoster } from '../src/bolt_service/init-blocks-data-helper.js'
import {
   LoadNannyList, AddNannyCode, RemoveNannyCode
} from '../src/slashcommand/nanny-generator.js'
// check timezone
import moment from 'moment-timezone'
import https from 'https'

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

const GetUserVmwareIds = async (users) => {
   const results = await Promise.all(users.map(async (user) => {
      const mailInfo = await QueryUserInfoByName(user)
      if (mailInfo == null) {
         logger.debug(`Fail to query VMware ID by broadcom mail ${user} in db.mailinfos`)
         return null
      }
      return mailInfo.vmwareId
   }))
   return results.filter(value => value != null)
}

const GetUserGIds = async (users) => {
   const results = await Promise.all(users.map(async (user) => {
      const mailInfo = await QueryUserInfoByName(user)
      if (mailInfo == null) {
         logger.debug(`Fail to query GId by broadcom mail ${user} in db.mailinfos`)
         return null
      }
      return mailInfo.gid
   }))
   return results.filter(value => value != null)
}

const NotificationExecutor = async (report, ContentEvaluate) => {
   let reportHistory = null
   try {
      // check the webhooks
      const sendWebhooks = Array.from(new Set(report.webhooks || []))
      if (sendWebhooks.length === 0) {
         console.warn(`*Webhook Empty* ID_${report._id}  Title: ${report.title}`)
         return
      }
      logger.debug(`Send webhooks: ${JSON.stringify(sendWebhooks)}`)

      // generate report in 10 minutes timeout
      const messageInfo = await ContentEvaluate(report)
      const messages = messageInfo.messages
      logger.info(`stdout of notification ${report.title}: ${JSON.stringify(messageInfo)}`)
      const sendIfPRDiff = report.reportSpecConfig?.sendIfPRDiff || 'No'
      logger.info(`report option skipEmptyReport:${report.skipEmptyReport} ` +
         `sendIfPRDiff:${sendIfPRDiff}`)
      // skip report by options in report configuration
      if (report.skipEmptyReport === 'Yes' && messageInfo.isEmpty === true) {
         logger.info('The option of skip empty report is Yes.')
         return
      } else if (sendIfPRDiff === 'Yes' && messageInfo.isEmpty === true) {
         logger.info('The option of skip report if no diff PRs is Yes.')
         return
      }
      // initialize the report send history
      reportHistory = new ReportHistory({
         reportConfigId: report._id,
         title: report.title,
         creator: report.creator,
         reportType: report.reportType,
         conversations: sendWebhooks,
         mentionUsers: report.mentionUsers || [],
         sentTime: null,
         content: '',
         status: REPORT_HISTORY_STATUS.PENDING
      })
      await reportHistory.save()
      // post reports to Google spaces
      const results = await Promise.all(
         sendWebhooks.map(webhook => {
            return AsyncForEach(messages, async message => {
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
      // If via short link service is unstable, send bugzilla full link in thread message
      if (report.reportType === 'bugzilla') {
         const threadMessages = messageInfo.thread
         try {
            const agent = new https.Agent({ rejectUnauthorized: false })
            await axios.get('https://vsanvia.broadcom.net/', { httpsAgent: agent })
         } catch (e) {
            logger.error(`vSAN via link is unstable. Error: ${JSON.stringify(e)}`)
            const viaUnstableMessage = 'vSAN via short link service is in maintenance, ' +
               'please use the <' + `${report.reportSpecConfig.bugzillaLink}` + '|full link>'
            threadMessages.push(viaUnstableMessage)
         }
         // send thread message in Google Chat
         for (const webhook in tsMap) {
            const threadName = tsMap[webhook]
            logger.debug('Send thread message, webhook: ' + threadName)
            const webhookWithOpt = webhook +
               '&messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD'
            AsyncForEach(threadMessages, async threadMessage => {
               const appMessage = { text: threadMessage, thread: { name: threadName } }
               try {
                  await axios.post(
                     webhookWithOpt,
                     JSON.stringify(appMessage),
                     { headers: CONTENT_TYPE_JSON_UTF }
                  )
               } catch (e) {
                  logger.error(`Fail to post message to Space thread ${threadName}` +
                     `since error: ${JSON.stringify(e)}`)
               }
            })
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
         if (report.reportSpecConfig?.bugzillaList2Table != null &&
             report.reportSpecConfig?.bugzillaList2Table === 'Yes') {
            command += ` --list2table 'Yes'`
         } else {
            command += ` --list2table 'No'`
         }
         if (report.reportSpecConfig?.foldBugzillaList != null &&
             report.reportSpecConfig?.foldBugzillaList === 'Yes') {
            command += ` --foldMessage 'Yes'`
         } else {
            command += ` --foldMessage 'No'`
         }
         if (report.reportSpecConfig?.sendIfPRDiff != null &&
             report.reportSpecConfig?.sendIfPRDiff === 'Yes') {
            command += ` --sendIfPRDiff 'Yes'`
         } else {
            command += ` --sendIfPRDiff 'No'`
         }
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
         const assignees = await GetUserVmwareIds(report.reportSpecConfig.bugzillaAssignee)
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
         const MentionNannys = async (text, nannyAccounts, mentionKey) => {
            for (let i = 0; i < nannyAccounts.length; i++) {
               const account = nannyAccounts[i].trim()
               let nannyMentionKey = `@${mentionKey}`
               let nannyFullNameKey = `${mentionKey}` + '-full-name'
               if (nannyAccounts.length > 1) {
                  nannyMentionKey = nannyMentionKey + `${i + 1}`
                  nannyFullNameKey = nannyFullNameKey + `${i + 1}`
               }
               const mailInfo = await QueryUserInfoByName(account)
               if (mailInfo == null) {
                  text = text.replace(nannyMentionKey, `@${account}`)
                     .replace(nannyFullNameKey, `@${account}`)
               } else {
                  // Mention nanny in Google Chat by <users/Google user ID>
                  text = text.replace(nannyMentionKey, `<users/${mailInfo.gid}>`)
                     .replace(nannyFullNameKey, mailInfo.fullName)
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
            resultText = await MentionNannys(resultText, thisTimeNannys, 'this-nanny')
         }
         if (stdout.indexOf('next-nanny') >= 0) {
            resultText = await MentionNannys(resultText, nextTimeNannys, 'next-nanny')
         }
         stdout = resultText
         break
      }
      case 'jira_list': {
         const assignees = await GetUserVmwareIds([report.creator])
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
      const googleUserIds = await GetUserGIds(report.mentionUsers)
      mentionUserIds = '\n' + googleUserIds.map(userId => {
         return `<users/${userId}>`
      }).join(', ')
      gIdsStr = '&id=' + googleUserIds.join(',')
   }
   // If the report type is text or nanny_reminder, we return the report content by array directly.
   if (report.reportType === 'text' || report.reportType === 'nanny_reminder') {
      stdout += mentionUserIds
      return { messages: [stdout], isEmpty: false, webhookUserIds: gIdsStr, thread: [] }
   }
   try {
      const output = JSON.parse(stdout)
      // Here output's format is {"messages": ["..."], "isEmpty": False, "webhookUserIds": "", "thread": ["..."]}
      if (typeof output === 'object' && Array.isArray(output.messages)) {
         const messages = output.messages?.map(message => unescape(message)) || []
         if (messages.length > 0) {
            messages[messages.length - 1] += mentionUserIds
         }
         const thread = output.thread?.map(message => unescape(message)) || []
         return {
            messages: messages,
            isEmpty: output.isEmpty,
            webhookUserIds: gIdsStr,
            thread: thread
         }
      }
   } catch (e) {
      logger.error(`Fail to parse report generator stdout:`)
      logger.error(e)
   }
   return { messages: [stdout], isEmpty: false, webhookUserIds: gIdsStr, thread: [] }
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

const InvokeNow = async function (id) {
   if (id == null) {
      throw new Error('report id is null, can not cancel next report sending')
   }
   logger.info(`start to immediately invoke for report ${id}`)
   const job = scheduleJobStore[id.toString()]
   if (job != null) {
      job.invoke()
   } else {
      logger.warn(`failed to immediately invoke since no job for report ${id}`)
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
      await UpdateTeamGroup()
      await UpdateMailList()
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
         '/generator/src/nanny/RefreshNannyList.py'
      logger.debug(`execute the refresh nanny list command: ${command}`)
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
