import mongoose from 'mongoose'
import { performance } from 'perf_hooks'
import {
   ReportConfiguration, FlattenMembers, REPORT_STATUS
} from '../model/report-configuration.js'
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

   router.get('/api/v1/team_members/:teamCode', async (ctx, next) => {
      const teamCode = ctx.params.teamCode
      if (teamCode == null) {
         ctx.response.status = 400
         ctx.response.body = {
            result: false,
            message: 'Bad request: team code not given.'
         }
         return
      }
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
   })

   router.get('/api/v1/team_members/:managerName/:filterType', async (ctx, next) => {
      const managerName = ctx.params.managerName
      const filterType = ctx.params.filterType
      if (managerName == null) {
         ctx.response.status = 400
         ctx.response.body = {
            result: false,
            message: 'Bad request: manager name not given.'
         }
         return
      }
      if (filterType !== 'direct' && filterType !== 'all') {
         ctx.response.status = 400
         ctx.response.body = {
            result: false,
            message: `Bad request: invalid filter type. Please use 'all' or 'direct'.`
         }
         return
      }
      try {
         const managerInfo = await FindUserInfoByName(managerName)
         if (managerInfo == null) {
            ctx.response.status = 404
            ctx.response.body = {
               result: false,
               message: 'Bad request: manager name not found.'
            }
            return
         }
         const team = {
            code: managerName,
            name: managerName + ' engineers',
            membersFilters: [{
               condition: 'include', type: filterType + '_reporters', members: [managerInfo.slackId]
            }]
         }
         team.members = await FlattenMembers(team.membersFilters)
         if (team.members.length <= 1) {
            ctx.response.status = 400
            ctx.response.body = {
               result: false,
               message: 'Bad request: the given manager name is an individual engineer, ' +
                  'no one reports to him/her.'
            }
            return
         }
         ctx.response.status = 200
         ctx.response.body = team.members
      } catch (error) {
         const errorMsg = `Failed to get members of ${managerName} team.`
         logger.error(errorMsg + '\n' + error)
         ctx.response.status = 500
         ctx.response.body = { result: false, message: errorMsg }
      }
   })

   router.get('/api/v1/report_configurations', async (ctx, next) => {
      const slackId = ctx.state.slackId
      const vmwareId = ctx.state.vmwareId
      const offset = parseInt(ctx?.query?.offset || 0)
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
            .skip(offset).limit(limit)
         logger.info(`The total number of ${vmwareId}'s reports is ${total}.`)
         logger.info(`The number of reports querying from db is ${reports.length}.`)
         ctx.response.status = 200
         ctx.response.body = { total, reports }
      } catch (error) {
         const errorMsg = `Fail to list ${vmwareId}'s report configurations.`
         logger.error(errorMsg + '\n' + error)
         ctx.response.status = 500
         ctx.response.body = { result: false, message: errorMsg }
      }
   })

   router.get('/api/v1/report_configuration/:id', async (ctx, next) => {
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

   router.post('/api/v1/create_report_configuration', async (ctx, next) => {
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

   router.post('/api/v1/edit_report_configuration/:id', async (ctx, next) => {
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
            const errorMsg = e.errors.title.message
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

   router.put('/api/v1/change_status/:status/:id', async (ctx, next) => {
      const reportId = ctx.params.id
      if (reportId == null) {
         ctx.response.status = 400
         ctx.response.body = { result: false, message: 'Bad request: report id not given.' }
         return
      }
      const reportStatus = ctx.params.status
      if (!CHANGE_REPORT_STATUS_ENUM.includes(reportStatus)) {
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
         if (report.status === REPORT_STATUS.ENABLED) {
            RegisterScheduler(report)
         } else {
            UnregisterScheduler(reportId)
         }
         ctx.response.status = 200
         ctx.response.body = {
            result: true, message: `Report '${report.title}' ${reportStatus}d.`
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

   router.post('/api/v1/invoke_now/:id', async (ctx, next) => {
      const reportId = ctx.params.id
      if (reportId == null) {
         ctx.response.status = 400
         ctx.response.body = { result: false, message: 'Bad request: report id not given.' }
         return
      }
      try {
         await InvokeNow(reportId, 'test space')
         const report = await ReportConfiguration.findById(reportId)
         let statusReminder = ''
         if (report.status !== REPORT_STATUS.ENABLED) {
            statusReminder = ` But the report status is '${report.status}'. ` +
               `Please enable it by 'PUT /api/v1/change_status/enable/${reportId}'`
         }
         ctx.response.status = 200
         ctx.response.body = {
            result: true, message: 'Send report successfully!' + statusReminder
         }
      } catch (error) {
         const errorMsg = 'Fail to send report immediately in test space.'
         logger.error(errorMsg + '\n' + error)
         ctx.response.status = 500
         ctx.response.body = { result: false, message: errorMsg }
      }
   })

   router.put('/api/v1/delete_report_configuration/:id', async (ctx, next) => {
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
         const errorMsg = 'Fail to delete report.'
         ctx.response.status = 500
         ctx.response.body = { result: false, message: errorMsg }
         logger.error(errorMsg + '\n' + error)
      }
   })
}

export {
   RegisterApiRouters
}
