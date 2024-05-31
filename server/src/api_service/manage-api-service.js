import mongoose from 'mongoose'
import path from 'path'
import fs from 'fs'
import { performance } from 'perf_hooks'
import {
   ReportConfiguration, FlattenMembers, REPORT_STATUS
} from '../model/report-configuration.js'
import { ReportHistory } from '../model/report-history.js'
import { SlackbotApiToken } from '../model/api-token.js'
import { AddApiHistoryInfo } from '../model/api-history.js'
import { FindUserInfoByName } from '../model/user-info.js'
import { TeamGroup } from '../model/team-group.js'
import {
   RegisterScheduler, UnregisterScheduler, InvokeNow
} from '../scheduler-adapter.js'
import logger from '../../common/logger.js'
import { FormatDate, Merge } from '../../common/utils.js'
import { GetMetrics } from './metrics.js'
import {
   UpdateFlattenMembers, GenerateNannyRoster
} from '../bolt_service/init-blocks-data-helper.js'

const CHANGE_REPORT_STATUS_ENUM = ['enable', 'disable']

async function UpdateReportConfiguration(slackId, reqData, oldReport) {
   const ParseRequestData = async (slackId, requestData) => {
      const tz = requestData.repeatConfig?.tz || 'Asia/Chongqing'// TBD
      const perforceCheckIn = requestData.reportSpecConfig?.perforceCheckIn
      const nannyRoster = await GenerateNannyRoster(requestData, false, tz)
      const reportObj = Merge(requestData, {
         creator: slackId,
         mentionUsers: requestData.mentionUsers?.split(',') || [],
         mentionGroups: [],
         skipEmptyReport: requestData.skipEmptyReport || 'No',
         webhooks: requestData.webhooks?.split(',') || [],
         reportSpecConfig: {
            perforceCheckIn: {
               teams: perforceCheckIn?.teams?.split(',') || [],
               branches: perforceCheckIn?.branches?.split(',') || [],
               needCheckinApproved: perforceCheckIn?.needCheckinApproved || 'Yes'
            },
            bugzillaAssignee: requestData.reportSpecConfig?.bugzillaAssignee?.split(',') || [],
            nannyAssignee: requestData.reportSpecConfig?.nannyAssignee || '',
            nannyRoster: nannyRoster,
            jira: {
               fields: requestData.jira?.fields?.split(',') || []
            }
         },
         repeatConfig: {
            tz,
            dayOfWeek: requestData.repeatConfig?.dayOfWeek || [],
            date: FormatDate(requestData.repeatConfig?.date || null),
            startDate: FormatDate(requestData.repeatConfig?.startDate || new Date()),
            endDate: requestData.repeatConfig?.endDate || null
         }
      })
      return reportObj
   }
   logger.debug(`request data: ${JSON.stringify(reqData)}`)
   let report = null
   if (oldReport != null) {
      logger.debug(`Start to edit report configuration.`)
      const reportObj = await ParseRequestData(slackId, reqData)
      report = Merge(oldReport, reportObj)
   } else {
      logger.debug(`Start to create report configuration.`)
      reqData.status = REPORT_STATUS.ENABLED
      const reportObj = await ParseRequestData(slackId, reqData)
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
      if (url.endsWith('/server/health') || url.endsWith('/metrics')) {
         await next()
         logger.debug(`${method} ${url} ${performance.now() - t0} cost`)
         return
      }
      const ipAddr = ctx.request.ip
      const token = 'd89f55072b9d4fbda1e38a66c83adaad'
      // const token = ctx.request.headers.authorization?.substring('Bearer '.length)
      const apiToken = await SlackbotApiToken.findOne({ token })
      if (apiToken == null || apiToken.userId == null) {
         const errorMsg = 'Authorization failure'
         ctx.response.status = 401
         ctx.response.body = { result: false, message: errorMsg }
         AddApiHistoryInfo({ userId: '', ipAddr: ipAddr }, { channel: '', text: '' }, ctx.response)
         return
      }
      ctx.state.slackId = apiToken.userId
      ctx.state.vmwareId = apiToken.userName
      ctx.state.ipAddr = ipAddr
      await next()
      logger.debug(`${apiToken.userName} did "${method} ${url}" took ${performance.now() - t0}ms cost`)
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

   router.get('/api/v1/report/configuration', async (ctx, next) => {
      const slackId = ctx.state.slackId
      const vmwareId = ctx.state.vmwareId
      const page = parseInt(ctx?.query?.page || 0)
      const limit = parseInt(ctx?.query?.limit || 1)
      const filter = {
         status: { $nin: [REPORT_STATUS.CREATED, REPORT_STATUS.REMOVED] }
      }
      if (!process.env.ADMIN_USER_ID.includes(slackId)) {
         filter.creator = slackId
      }
      try {
         const total = await ReportConfiguration.countDocuments(filter)
         const reports = await ReportConfiguration.find(filter)
            .skip(page).limit(limit)
         logger.info(`The total number of ${vmwareId}'s reports is ${total}.`)
         logger.info(`The number of reports querying from db is ${reports.length}.`)
         ctx.response.status = 200
         ctx.response.body = { total, page, limit, reports }
      } catch (error) {
         const errorMsg = `Fail to list ${vmwareId}'s report configurations.`
         logger.error(errorMsg + '\n' + error)
         ctx.response.status = 500
         ctx.response.body = { result: false, message: errorMsg }
      }
   })

   router.post('/api/v1/report/configuration', async (ctx, next) => {
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
         const slackId = ctx.state.slackId
         const report = await UpdateReportConfiguration(slackId, reqData, null)
         RegisterScheduler(report)
         logger.info(`Create successful. ID: ${report._id}`)
         ctx.response.status = 200
         ctx.response.body = report
      } catch (e) {
         if (e instanceof mongoose.Error.ValidationError) {
            const errorMsg = e.errors.title.message
            ctx.response.status = 400
            ctx.response.body = { result: false, message: 'Bad request: ' + errorMsg }
         } else {
            ctx.response.status = 500
            ctx.response.body = { result: false, message: 'Internal Server Error' }
         }
         logger.error('Fail to create report configuration, error:')
         logger.error(e)
      }
   })

   router.get('/api/v1/report/:id/configuration', async (ctx, next) => {
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

   router.put('/api/v1/report/:id/configuration', async (ctx, next) => {
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
         const slackId = ctx.state.slackId
         const report = await UpdateReportConfiguration(slackId, reqData, oldReport)
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

   router.patch('/api/v1/report/:id/configuration', async (ctx, next) => {
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

   router.delete('/api/v1/report/:id/configuration', async (ctx, next) => {
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

   router.get('/api/v1/report/:id/history', async (ctx, next) => {
      const reportId = ctx.params.id
      if (reportId == null) {
         ctx.response.status = 400
         ctx.response.body = { result: false, message: 'Bad request: report id not given.' }
         return
      }
      const page = parseInt(ctx?.query?.page || 0)
      const limit = parseInt(ctx?.query?.limit || 1)
      const filter = {
         reportConfigId: reportId
      }
      try {
         const total = await ReportHistory.countDocuments(filter)
         const histories = await ReportHistory.find(filter)
            .skip(page).limit(limit)
         logger.info(`The total number of histories of report Id ${reportId} is ${total}.`)
         logger.info(`The number of histories querying from db is ${histories.length}.`)
         ctx.response.status = 200
         ctx.response.body = { total, page, limit, histories }
      } catch (error) {
         const errorMsg = `Fail to list the histories of report Id ${reportId}.`
         logger.error(errorMsg + '\n' + error)
         ctx.response.status = 500
         ctx.response.body = { result: false, message: errorMsg }
      }
   })

   router.post('/api/v1/report/:id/history', async (ctx, next) => {
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
         const reportHistory = await InvokeNow(reportId)
         ctx.response.status = 200
         ctx.response.body = reportHistory
      } catch (error) {
         const errorMsg = 'Fail to send report immediately in test space.'
         logger.error(errorMsg + '\n' + error)
         ctx.response.status = 500
         ctx.response.body = { result: false, message: errorMsg }
      }
   })
}

export {
   RegisterApiRouters
}
