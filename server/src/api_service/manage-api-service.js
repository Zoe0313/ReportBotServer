import { ReportConfiguration, FlattenMembers } from '../model/report-configuration.js'
import { SlackbotApiToken } from '../model/api-token.js'
import { AddApiHistoryInfo } from '../model/api-history.js'
import { FindUserInfoByName } from '../model/user-info.js'
import { TeamGroup } from '../model/team-group.js'
import { RegisterScheduler, UnregisterScheduler } from '../scheduler-adapter.js'
import logger from '../../common/logger.js'
import mongoose from 'mongoose'
import { performance } from 'perf_hooks'
import { Merge } from '../../common/utils.js'
import { GetMetrics } from './report-db-utils.js'

function RegisterApiRouters(router, client) {
   router.use(async (ctx, next) => {
      if (ctx.url.endsWith('/server/health') || ctx.url.endsWith('/metrics')) {
         await next()
         return
      }

      const ipAddr = ctx.request.ip
      const token = ctx.request.headers.authorization?.substring('Bearer '.length)
      const apiToken = await SlackbotApiToken.findOne({ token })
      if (apiToken == null || apiToken.userId == null) {
         const errorMsg = 'Authorization failure'
         ctx.response.status = 401
         ctx.response.body = { result: false, message: errorMsg }
         AddApiHistoryInfo({ userId: '', ipAddr: ipAddr }, { channel: '', text: '' }, ctx.response)
         return
      }
      ctx.state.userId = apiToken.userId
      ctx.state.ipAddr = ipAddr
      await next()
   })

   router.get('/api/v1/server/health', (ctx, next) => {
      ctx.response.status = 200
      ctx.response.body = { result: true }
   })

   router.get('/api/v1/metrics', async (ctx, next) => {
      const t0 = performance.now()
      try {
         const metrics = await GetMetrics()
         ctx.response.status = 200
         ctx.response.body = metrics
      } catch (error) {
         const errorMsg = `Failed to get sent report count: ${error}`
         logger.error(errorMsg)
         ctx.response.status = 500
         ctx.response.body = { result: false, message: errorMsg }
      }
      logger.debug(`API /metrics ${performance.now() - t0} cost`)
   })

   router.get('/api/v1/team_members/:teamCode', async (ctx, next) => {
      const t0 = performance.now()
      const teamCode = ctx.params.teamCode
      try {
         if (teamCode == null || teamCode === '') {
            ctx.response.status = 400
            ctx.response.body = { result: false, message: 'Bad request: team code not given.' }
            return
         }
         const team = await TeamGroup.findOne({ code: teamCode })
         ctx.response.status = 200
         ctx.response.body = team.members
      } catch (e) {
         const errorMsg = `Failed to get members of ${teamCode} team.`
         logger.error(errorMsg)
         ctx.response.status = 500
         ctx.response.body = { result: false, message: errorMsg }
      }
      logger.debug(`API /team_members/${teamCode} ${performance.now() - t0} cost`)
   })

   router.get('/api/v1/team_members/:managerName/:filterType', async (ctx, next) => {
      const t0 = performance.now()
      const managerName = ctx.params.managerName
      const filterType = ctx.params.filterType
      try {
         if (managerName == null || managerName === '') {
            ctx.response.status = 400
            ctx.response.body = { result: false, message: 'Bad request: manager name not given.' }
            return
         }
         const managerInfo = await FindUserInfoByName(managerName)
         if (managerInfo == null) {
            ctx.response.status = 400
            ctx.response.body = {
               result: false, message: 'Bad request: manager name is invalid.'
            }
            return
         }
         if (filterType == null || filterType === '') {
            ctx.response.status = 400
            ctx.response.body = {
               result: false, message: 'Bad request: filter type not given.'
            }
            return
         }
         if (filterType !== 'direct' && filterType !== 'all') {
            ctx.response.status = 400
            ctx.response.body = {
               result: false,
               message: 'Bad request: filter type is invalid, please use /all or /direct.'
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
      } catch (e) {
         const errorMsg = `Failed to get members of ${managerName} team.`
         logger.error(errorMsg)
         ctx.response.status = 500
         ctx.response.body = { result: false, message: errorMsg }
      }
      logger.debug(`API /team_members/${managerName}/${filterType} ${performance.now() - t0} cost`)
   })

   router.get('/api/v1/report_configurations', async (ctx, next) => {
      const userId = ctx.state.userId
      const filter = { creator: userId }
      const reports = await ReportConfiguration.find(filter)
         .skip(ctx.query.offset).limit(ctx.query.limit)
      logger.info(reports)
      ctx.response.status = 200
      ctx.response.body = reports
   })

   router.get('/api/v1/report_configurations/:id', async (ctx, next) => {
      if (ctx.params.id == null) {
         ctx.response.status = 400
         ctx.response.body = { result: false, message: 'Bad request: invalid id' }
         return
      }
      const userId = ctx.state.userId
      const report = await ReportConfiguration.findOne({ _id: ctx.params.id, creator: userId })
      logger.info(report)
      ctx.response.status = 200
      ctx.response.body = report
   })

   router.post('/api/v1/report_configurations', async (ctx, next) => {
      try {
         logger.info(ctx.request.body)
         const userId = ctx.state.userId
         const report = await new ReportConfiguration(ctx.request.body)
         report.creator = userId
         await report.save()
         RegisterScheduler(report)
         ctx.response.body = report
      } catch (e) {
         if (e instanceof mongoose.Error.ValidationError) {
            ctx.response.status = 400
            ctx.response.body = 'Bad request: ' + e.errors
         } else {
            ctx.response.status = 500
            ctx.response.body = { result: false, message: 'Internal Server Error' }
         }
         logger.error(e)
      }
   })

   router.put('/api/v1/report_configurations/:id', async (ctx, next) => {
      try {
         logger.info(ctx.params.id)
         const userId = ctx.state.userId
         const oldReport = await ReportConfiguration.findOne({
            _id: ctx.params.id, creator: userId
         })
         if (oldReport == null) {
            ctx.response.status = 404
            ctx.response.body = { result: false, message: 'report configuration not found' }
            return
         }
         const report = Merge(oldReport, ctx.request.body)
         logger.info(`original report: ${oldReport}\nnew report: ${report}`)
         await report.save()
         RegisterScheduler(report)
         ctx.response.body = report
      } catch (e) {
         if (e instanceof mongoose.Error.ValidationError) {
            ctx.response.status = 400
            ctx.response.body = 'Bad request: ' + e.errors
         } else {
            ctx.response.status = 500
            ctx.response.body = { result: false, message: 'Internal Server Error' }
         }
         logger.error(e)
      }
   })

   router.delete('/api/v1/report_configurations/:id', async (ctx, next) => {
      logger.info(ctx.params.id)
      const userId = ctx.state.userId
      const result = await ReportConfiguration.findOneAndRemove({
         _id: ctx.params.id, creator: userId
      })
      if (result) {
         UnregisterScheduler(ctx.params.id)
         ctx.response.status = 200
         ctx.response.body = { result: true }
      } else {
         ctx.response.status = 200
         ctx.response.body = { result: false, message: 'Delete report configuration failed' }
      }
   })

   router.post('/api/v1/channel/:channelId/messages', async (ctx, next) => {
      let errorMsg = ''
      let request = { channel: '', text: '' }
      if (ctx.request.body.text == null || ctx.request.body.text === '') {
         errorMsg = 'Bad request: the message is not given, can not post the empty message.'
      } else if (ctx.params.channelId == null || ctx.params.channelId === '') {
         errorMsg = 'Bad request: channel ID is not given when posting message.'
         request = { channel: '', text: ctx.request.body.text }
      }
      if (errorMsg !== '') {
         ctx.response.status = 400
         ctx.response.body = { result: false, message: errorMsg }
         AddApiHistoryInfo(ctx.state, request, ctx.response)
         return
      }
      console.log(process.env.LOGGER_PATH)
      logger.debug(`the message "${ctx.request.body.text}" will be sent to channel ${ctx.params.channelId}`)
      request = {
         channel: ctx.params.channelId,
         text: ctx.request.body.text
      }
      try {
         const result = await client.chat.postMessage(request)
         logger.debug(`post message result for ${ctx.state.userId} is: ${JSON.stringify(result)}`)
         ctx.response.status = 200
         ctx.response.body = result
      } catch (error) {
         const errorMsg = `post message occur error: ${error}`
         logger.error(errorMsg)
         ctx.response.status = 500
         ctx.response.body = { result: false, message: errorMsg }
      }
      AddApiHistoryInfo(ctx.state, request, ctx.response)
   })

   router.post('/api/v1/user/:userName/messages', async (ctx, next) => {
      let errorMsg = ''
      let request = { channel: '', text: '' }
      if (ctx.request.body.text == null || ctx.request.body.text === '') {
         errorMsg = 'Bad request: the message is not given, can not post the empty message.'
      } else if (ctx.params.userName == null || ctx.params.userName === '') {
         errorMsg = 'Bad request: user name is not given when posting message.'
         request = { channel: '', text: ctx.request.body.text }
      }
      if (errorMsg !== '') {
         ctx.response.status = 400
         ctx.response.body = { result: false, message: errorMsg }
         AddApiHistoryInfo(ctx.state, request, ctx.response)
         return
      }
      const userInfo = await FindUserInfoByName(ctx.params.userName)
      if (userInfo == null) {
         errorMsg = `${ctx.params.userName} not found`
         request = { channel: '', text: ctx.request.body.text }
         ctx.response.status = 400
         ctx.response.body = { result: false, message: errorMsg }
         AddApiHistoryInfo(ctx.state, request, ctx.response)
         return
      }
      logger.debug(`the message "${ctx.request.body.text}" will be sent to user ${ctx.params.userName}`)
      logger.debug(`user name "${ctx.params.userName}" 's slack id: ${userInfo.slackId}`)
      request = {
         channel: userInfo.slackId,
         text: ctx.request.body.text
      }
      try {
         const result = await client.chat.postMessage(request)
         logger.debug(`post message result for ${ctx.state.userId} is: ${JSON.stringify(result)}`)
         ctx.response.status = 200
         ctx.response.body = result
      } catch (error) {
         const errorMsg = `post message occur error: ${error}`
         logger.error(errorMsg)
         ctx.response.status = 500
         ctx.response.body = { result: false, message: errorMsg }
      }
      AddApiHistoryInfo(ctx.state, request, ctx.response)
   })
}

export {
   RegisterApiRouters
}
