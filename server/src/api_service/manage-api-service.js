import mongoose from 'mongoose'
import path from 'path'
import fs from 'fs'
import { performance } from 'perf_hooks'
import {
   ReportConfiguration, FlattenMembers, REPORT_STATUS
} from '../model/report-configuration.js'
import { ReportHistory } from '../model/report-history.js'
import { TeamGroup } from '../model/team-group.js'
import { FindUserInfoByName } from '../model/user-info.js'
import {
   RegisterScheduler, UnregisterScheduler, InvokeNow
} from '../scheduler-adapter.js'
import logger from '../../common/logger.js'
import { FormatDate, Merge } from '../../common/utils.js'
import { GetMetrics } from './metrics.js'
import {
   UpdateFlattenMembers, GenerateNannyRoster
} from '../bolt_service/init-blocks-data-helper.js'
import { VMwareId2GoogleUserInfo } from '../../common/slack-helper.js'

const CHANGE_REPORT_STATUS_ENUM = ['enable', 'disable']

async function UpdateReportConfiguration(reqData, oldReport) {
   const ParseRequestData = async (requestData) => {
      const nannyList = requestData?.nannyReminder?.nannyAssignees || []
      const reportObj = {
         title: requestData.title,
         creator: requestData.creator,
         vmwareId: requestData.vmwareId,
         status: requestData.status,
         reportType: requestData.reportType,
         mentionUsers: requestData.mentionUsers || [],
         skipEmptyReport: requestData.skipEmptyReport ? 'Yes' : 'No',
         webhooks: requestData?.webhooks || [],
         reportSpecConfig: {
            bugzillaLink: requestData?.bugzilla?.bugzillaLink || null,
            bugzillaList2Table: requestData?.bugzilla?.list2table ? 'Yes' : 'No',
            foldBugzillaList: requestData?.bugzilla?.foldPRList ? 'Yes' : 'No',
            bugzillaAssignee: requestData.bugzillaAssignee?.bugzillaAssignees || [],
            text: requestData.text || null,
            nannyCode: requestData?.nannyReminder?.nannyCode || null,
            nannyAssignee: nannyList.length > 0 ? nannyList.join('\n') : null,
            nannyRoster: requestData?.nannyReminder?.nannyRoster || null
         },
         repeatConfig: {
            repeatType: requestData.repeatConfig.repeatType,
            tz: requestData.repeatConfig.tz,
            startDate: new Date(requestData.repeatConfig?.startDate),
            endDate: requestData.repeatConfig?.endDate || null,
            cronExpression: requestData.repeatConfig?.cronExpression || '',
            date: FormatDate(requestData.repeatConfig?.date) || null,
            time: requestData.repeatConfig?.time || null,
            dayOfMonth: requestData.repeatConfig?.dayOfMonth || null,
            dayOfWeek: requestData.repeatConfig?.dayOfWeek || [],
            minsOfHour: requestData.repeatConfig?.minsOfHour || null
         }
      }
      return reportObj
   }
   logger.debug(`request data: ${JSON.stringify(reqData)}`)
   let report = null
   if (oldReport != null) {
      logger.debug(`Start to edit report configuration.`)
      const reportObj = await ParseRequestData(reqData)
      report = Merge(oldReport, reportObj)
   } else {
      logger.debug(`Start to create report configuration.`)
      const reportObj = await ParseRequestData(reqData)
      report = new ReportConfiguration(reportObj)
   }
   const saved = await report.save()
   logger.debug(`report saved:\n${saved}`)
   // if perforce_checkin type, flatten member list and save to report configuration
   if (report.reportType === 'perforce_checkin' ||
      report.reportType === 'perforce_review_check') {
      await UpdateFlattenMembers(report)
   }
   return report
}

function RegisterApiRouters(router) {
   router.use(async (ctx, next) => {
      logger.debug(`${JSON.stringify(ctx)}`)
      const t0 = performance.now()
      const method = ctx.request.method
      const url = ctx.request.url
      if (url.startsWith('/api/v1/')) {
         await next()
         logger.debug(`${method} ${url} ${performance.now() - t0} cost`)
         return
      }
      const ipAddr = ctx.request.ip
      const vmwareId = ctx.query?.user || null
      console.log('request param user:', vmwareId)
      const userInfo = await FindUserInfoByName(vmwareId)
      if (userInfo == null) {
         const errorMsg = 'Authorization failure'
         ctx.response.status = 401
         ctx.response.body = { result: false, message: errorMsg }
         return
      }
      ctx.state.slackId = userInfo.slackId
      ctx.state.vmwareId = userInfo.userName
      ctx.state.ipAddr = ipAddr
      await next()
      logger.debug(`${userInfo.userName} did "${method} ${url}" took ${performance.now() - t0}ms cost`)
   })

   router.get('/api/v1/server/health', (ctx, next) => {
      ctx.response.status = 200
      ctx.response.body = { result: true }
   })

   router.get('/api/v1/metrics', async (ctx, next) => {
      try {
         const metrics = await GetMetrics()
         ctx.response.status = 200
         ctx.response.body = metrics
      } catch (error) {
         const errorMsg = 'Fail to get metrics.'
         logger.error(errorMsg + '\n' + error)
         ctx.response.status = 500
         ctx.response.body = { result: false, message: errorMsg }
      }
   })

   router.get('/api/v1/log/:filename', async (ctx, next) => {
      const logName = ctx.params.filename
      if (logName == null) {
         ctx.response.status = 400
         ctx.response.body = { result: false, message: 'Bad request: file name not given.' }
         return
      }
      // only open the read access of path persist/legacy/log for user
      const logPath = path.join(path.resolve(), '..') +
         `/persist/legacy/log/${logName}`
      try {
         const logContent = fs.readFileSync(logPath).toString()
         ctx.response.status = 200
         ctx.response.body = logContent
      } catch (error) {
         const errorMsg = `Fail to get the content of log: ${logName}`
         logger.error(`Fail to get the content of log: ${logPath}`)
         logger.error(error)
         ctx.response.status = 500
         ctx.response.body = { result: false, message: errorMsg }
      }
   })

   router.get('/api/v1/report/:filename', async (ctx, next) => {
      const fileName = ctx.params.filename
      if (fileName == null) {
         ctx.response.status = 400
         ctx.response.body = { result: false, message: 'Bad request: file name not given.' }
         return
      }
      // only open the read access of path persist/legacy/report for user
      const reportPath = path.join(path.resolve(), '..') +
         `/persist/legacy/report/${fileName}`
      try {
         const reportContent = fs.readFileSync(reportPath).toString()
         ctx.response.status = 200
         ctx.response.body = reportContent
      } catch (error) {
         const errorMsg = `Fail to get the content of report: ${fileName}`
         logger.error(`Fail to get the content of report: ${reportPath}`)
         logger.error(error)
         ctx.response.status = 500
         ctx.response.body = { result: false, message: errorMsg }
      }
   })

   router.get('/api/v1/team/members', async (ctx, next) => {
      const filterType = ctx.query?.filterType || null
      const filterName = ctx.query?.filterName || null
      const includeIndirectReport = (ctx.query?.includeIndirectReport?.toLowerCase() === 'true')
      if (filterType !== 'group' && filterType !== 'manager') {
         ctx.response.status = 400
         ctx.response.body = {
            result: false,
            message: 'Bad request: only 2 options for filter type "group" and "manager".'
         }
         return
      }
      if (filterName == null) {
         ctx.response.status = 400
         ctx.response.body = {
            result: false,
            message: 'Bad request: filter name not given.'
         }
         return
      }
      if (filterType === 'group') {
         const teamCode = filterName
         logger.debug(`team code: ${teamCode}`)
         try {
            const team = await TeamGroup.findOne({ code: teamCode })
            ctx.response.status = 200
            ctx.response.body = team.members
         } catch (error) {
            const errorMsg = `Fail to get members of ${teamCode} team.`
            logger.error(errorMsg + '\n' + error)
            ctx.response.status = 500
            ctx.response.body = { result: false, message: errorMsg }
         }
         return
      }
      if (filterType === 'manager') {
         const managerName = filterName
         logger.debug(`manager name: ${managerName}`)
         let reporterType = 'direct_reporters'
         if (includeIndirectReport === true) {
            reporterType = 'all_reporters'
         }
         try {
            const managerInfo = await FindUserInfoByName(managerName)
            if (managerInfo == null) {
               ctx.response.status = 404
               ctx.response.body = {
                  result: false,
                  message: `Bad request: not find manager info by ${managerName}.`
               }
               return
            }
            const membersFilters = [{
               condition: 'include',
               type: reporterType,
               members: [managerInfo.slackId]
            }]
            const members = await FlattenMembers(membersFilters)
            if (members.length <= 1) {
               ctx.response.status = 400
               ctx.response.body = {
                  result: false,
                  message: 'Bad request: the given manager name is an individual engineer, ' +
                     'no one reports to him/her.'
               }
               return
            }
            ctx.response.status = 200
            ctx.response.body = members
         } catch (error) {
            let errorMsg = `Failed to get direct reporters of ${managerName} team.`
            if (includeIndirectReport === true) {
               errorMsg = `Failed to get all reporters of ${managerName} team.`
            }
            logger.error(errorMsg + '\n' + error)
            ctx.response.status = 500
            ctx.response.body = { result: false, message: errorMsg }
         }
      }
   })

   router.get('/service/admins', async (ctx, next) => {
      const account = ctx.state.vmwareId
      if (!process.env.ADMIN_VMWARE_ID.includes(account)) {
         ctx.response.status = 404
         ctx.response.body = { result: false, message: `${account} is not system administrator.` }
         return
      }
      ctx.response.status = 200
      ctx.response.body = {
         result: true,
         message: `You are the system administrator of vSAN Bot service.`
      }
   })

   router.get('/service/googleinfo', async (ctx, next) => {
      const vmwareId = ctx.query?.vmwareId || null
      const gUserInfo = VMwareId2GoogleUserInfo(vmwareId)
      // Mention nanny in Google Chat by <users/Google user ID>
      if (gUserInfo.gid.length === 0) {
         ctx.response.status = 404
         ctx.response.body = { result: false, message: `Not Found by vmwareId ${vmwareId}` }
         return
      }
      ctx.response.status = 200
      ctx.response.body = gUserInfo
   })

   router.get('/report/configuration', async (ctx, next) => {
      const slackId = ctx.state.slackId
      const account = ctx.state.vmwareId
      const filter = {
         status: { $nin: [REPORT_STATUS.REMOVED] }
      }
      if (!process.env.ADMIN_USER_ID.includes(slackId)) {
         filter.creator = slackId
      }
      try {
         const total = await ReportConfiguration.countDocuments(filter)
         const reports = await ReportConfiguration.find(filter).sort({ updatedAt: -1 })
         logger.info(`The total number of ${account}'s reports is ${total}.`)
         logger.info(`The number of reports querying from db is ${reports.length}.`)
         ctx.response.status = 200
         ctx.response.body = { total, reports }
      } catch (error) {
         const errorMsg = `Fail to list ${account}'s report configurations.`
         logger.error(errorMsg + '\n' + error)
         ctx.response.status = 500
         ctx.response.body = { result: false, message: errorMsg }
      }
   })

   router.post('/report/configuration', async (ctx, next) => {
      const reqData = ctx.request.body
      if (reqData == null) {
         ctx.response.status = 400
         ctx.response.body = {
            result: false, message: 'Bad request: report configuration not given.'
         }
         return
      }
      if (reqData?.reportType == null) {
         ctx.response.status = 400
         ctx.response.body = { result: false, message: 'Bad request: report type not given.' }
         return
      }
      try {
         reqData.creator = ctx.state.slackId
         const report = await UpdateReportConfiguration(reqData, null)
         RegisterScheduler(report)
         logger.info(`Create successful. ID: ${report._id}`)
         ctx.response.status = 200
         ctx.response.body = report
      } catch (e) {
         if (e instanceof mongoose.Error.ValidationError) {
            const errorMsg = e.errors
            ctx.response.status = 400
            ctx.response.body = { result: false, message: `Bad request: ${JSON.stringify(errorMsg)}` }
         } else {
            ctx.response.status = 500
            ctx.response.body = { result: false, message: 'Internal Server Error' }
         }
         logger.error('Fail to create report configuration, error:')
         logger.error(e)
      }
   })

   router.get('/report/:id/configuration', async (ctx, next) => {
      const reportId = ctx.params.id
      if (reportId == null) {
         ctx.response.status = 400
         ctx.response.body = { result: false, message: 'Bad request: report id not given.' }
         return
      }
      try {
         const report = await ReportConfiguration.findById(reportId)
         if (report == null) {
            ctx.response.status = 404
            ctx.response.body = {
               result: false, message: `Not found: report configuration by id ${reportId}`
            }
            return
         }
         logger.info(`Succeed to find report by ID ${reportId}.`)
         ctx.response.status = 200
         ctx.response.body = report
      } catch (error) {
         const errorMsg = `Fail to find report by ID ${reportId}.`
         logger.error(errorMsg + '\n' + error)
         ctx.response.status = 500
         ctx.response.body = { result: false, message: 'Internal Server Error' }
      }
   })

   router.put('/report/:id/configuration', async (ctx, next) => {
      const reportId = ctx.params.id
      if (reportId == null) {
         ctx.response.status = 400
         ctx.response.body = { result: false, message: 'Bad request: report id not given.' }
         return
      }
      const reqData = ctx.request.body
      if (reqData == null) {
         ctx.response.status = 400
         ctx.response.body = {
            result: false, message: 'Bad request: report configuration not given.'
         }
         return
      }
      try {
         const oldReport = await ReportConfiguration.findById(reportId)
         if (oldReport == null) {
            ctx.response.status = 404
            ctx.response.body = {
               result: false, message: `Not found: report configuration by id ${reportId}`
            }
            return
         }
         const report = await UpdateReportConfiguration(reqData, oldReport)
         if (report.status === REPORT_STATUS.ENABLED) {
            RegisterScheduler(report)
         } else {
            UnregisterScheduler(reportId)
         }
         logger.info(`Edit successful. ID: ${report._id}`)
         ctx.response.status = 200
         ctx.response.body = report
      } catch (e) {
         if (e instanceof mongoose.Error.ValidationError) {
            const errorMsg = e.errors.title
            ctx.response.status = 400
            ctx.response.body = { result: false, message: 'Bad request: ' + errorMsg }
         } else {
            ctx.response.status = 500
            ctx.response.body = { result: false, message: 'Internal Server Error' }
         }
         logger.error('Fail to edit report configuration, error:')
         logger.error(e)
      }
   })

   router.patch('/report/:id/configuration', async (ctx, next) => {
      const reportId = ctx.params.id
      if (reportId == null) {
         ctx.response.status = 400
         ctx.response.body = { result: false, message: 'Bad request: report id not given.' }
         return
      }
      const reportStatus = ctx.query?.status || null
      if (!CHANGE_REPORT_STATUS_ENUM.includes(reportStatus) || reportStatus == null) {
         ctx.response.status = 400
         ctx.response.body = {
            result: false,
            message: `Bad request: invalid report status. Please use 'enable' or 'disable'.`
         }
         return
      }
      try {
         let status = REPORT_STATUS.DISABLED
         if (reportStatus === 'enable') {
            status = REPORT_STATUS.ENABLED
         }
         await ReportConfiguration.updateOne({ _id: reportId }, { status })
         const report = await ReportConfiguration.findById(reportId)
         if (report == null) {
            ctx.response.status = 404
            ctx.response.body = {
               result: false,
               message: `Not found: report configuration by id ${reportId}`
            }
            return
         }
         if (report.status === REPORT_STATUS.ENABLED) {
            RegisterScheduler(report)
         } else {
            UnregisterScheduler(reportId)
         }
         ctx.response.status = 200
         ctx.response.body = {
            result: true,
            message: `Report '${report.title}' ${report?.status?.toLowerCase()}.`
         }
      } catch (error) {
         const errorMsg = 'Fail to update report status.'
         if (error instanceof mongoose.Error.ValidationError) {
            ctx.response.status = 400
            ctx.response.body = 'Bad request: ' + error.errors
         } else {
            ctx.response.status = 500
            ctx.response.body = { result: false, message: errorMsg }
         }
         logger.error(errorMsg + '\n' + error)
      }
   })

   router.delete('/report/:id/configuration', async (ctx, next) => {
      const reportId = ctx.params.id
      if (reportId == null) {
         ctx.response.status = 400
         ctx.response.body = { result: false, message: 'Bad request: report id not given.' }
         return
      }
      try {
         await ReportConfiguration.updateOne({ _id: reportId }, { status: REPORT_STATUS.REMOVED })
         UnregisterScheduler(reportId)
         ctx.response.status = 200
         ctx.response.body = { result: true, message: 'Deleted.' }
      } catch (error) {
         const errorMsg = 'Fail to delete report configuration.'
         ctx.response.status = 500
         ctx.response.body = { result: false, message: errorMsg }
         logger.error(errorMsg + '\n' + error)
      }
   })

   router.get('/report/:id/history', async (ctx, next) => {
      const reportId = ctx.params.id
      if (reportId == null) {
         ctx.response.status = 400
         ctx.response.body = { result: false, message: 'Bad request: report id not given.' }
         return
      }
      const filter = {
         reportConfigId: reportId
      }
      try {
         const total = await ReportHistory.countDocuments(filter)
         const histories = await ReportHistory.find(filter).sort({ updatedAt: -1 })
         logger.info(`The total number of histories of report Id ${reportId} is ${total}.`)
         logger.info(`The number of histories querying from db is ${histories.length}.`)
         ctx.response.status = 200
         ctx.response.body = { total, histories }
      } catch (error) {
         const errorMsg = `Fail to list the histories of report Id ${reportId}.`
         logger.error(errorMsg + '\n' + error)
         ctx.response.status = 500
         ctx.response.body = { result: false, message: errorMsg }
      }
   })

   router.post('/report/:id/history', async (ctx, next) => {
      const reportId = ctx.params.id
      if (reportId == null) {
         ctx.response.status = 400
         ctx.response.body = { result: false, message: 'Bad request: report id not given.' }
         return
      }
      try {
         const report = await ReportConfiguration.findById(reportId)
         if (report == null) {
            ctx.response.status = 404
            ctx.response.body = {
               result: false,
               message: `Not found: report configuration by id ${reportId}`
            }
            return
         }
         await InvokeNow(reportId)
         ctx.response.status = 200
         ctx.response.body = { result: true, message: 'Succeed to send report immediately.' }
      } catch (error) {
         const errorMsg = 'Fail to send report immediately.'
         logger.error(errorMsg + '\n' + error)
         ctx.response.status = 500
         ctx.response.body = { result: false, message: errorMsg }
      }
   })
}

export {
   RegisterApiRouters
}
