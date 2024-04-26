import dotenv from 'dotenv'
import axios from 'axios'
import { ReportConfiguration, REPORT_STATUS } from './model/report-configuration.js'
import {
   RegisterScheduler, RegisterPerforceInfoScheduler,
   RegisterPerforceMembersScheduler, RegisterTeamGroupScheduler,
   RegisterVSANNannyScheduler
} from './scheduler-adapter.js'
import Koa from 'koa'
import Router from 'koa-router'
import koaBody from 'koa-body'
import http from 'http'
import { performance } from 'perf_hooks'
import { ConnectMongoDatabase } from '../common/db-utils.js'
import logger from '../common/logger.js'
dotenv.config()

// connect to mongodb
ConnectMongoDatabase(async () => {
   const reports = await ReportConfiguration.find({ status: REPORT_STATUS.ENABLED })
   reports.forEach(report => RegisterScheduler(report))
   const updatePerforceInfoJob = RegisterPerforceInfoScheduler()
   logger.info(`next invocation of p4 info update is ${updatePerforceInfoJob.nextInvocation()}`)
   const flattenMembersJob = RegisterPerforceMembersScheduler()
   logger.info(`next invocation of p4 members update is ${flattenMembersJob.nextInvocation()}`)
   const updateTeamGroupJob = RegisterTeamGroupScheduler()
   logger.info(`next invocation of team group members update is ${updateTeamGroupJob.nextInvocation()}`)
   const updateVsanNannyJob = RegisterVSANNannyScheduler()
   logger.info(`next invocation of vsan nannys update is ${updateVsanNannyJob.nextInvocation()}`)
   if (process.env.NODE_ENV !== 'development') {
      updatePerforceInfoJob.invoke()
      updateTeamGroupJob.invoke()
      updateVsanNannyJob.invoke()
   }
})

const app = new Koa()
const router = new Router()

app.use(koaBody())

// handler performance
app.use(async ({ body, next }) => {
   const user = body?.user?.id || body?.message?.user || body?.user_id ||
      body?.event?.user?.id || body?.event?.user || body?.event?.message?.user
   const type = body?.actions?.map(action => action.action_id)?.join(', ') ||
      body?.subtype || body?.type || body?.command
   const t0 = performance.now()
   await next()
   const t1 = performance.now()
   if (body?.event?.type !== 'user_change') {
      logger.debug(`${user} did ${type} took ${(t1 - t0)} milliseconds.`)
   }
})

// global error handler
app.on('error', error => {
   const errorMessage = `original message: ${error.original}, ` +
      `stack: ${error.original?.stack}`
   logger.error(error)
   logger.error(errorMessage)
   if (process.env.ISSUE_GCHAT_WEBHOOK) {
      try {
         const CONTENT_TYPE_JSON_UTF = { 'Content-Type': 'application/json; charset=UTF-8' }
         axios.post(
            process.env.ISSUE_GCHAT_WEBHOOK,
            JSON.stringify({ text: errorMessage }),
            { headers: CONTENT_TYPE_JSON_UTF }
         )
      } catch (e) {
         logger.error(e)
      }
   }
})

app.use(router.routes())
   .use(router.allowedMethods())

const serverCallback = app.callback()
http.createServer(serverCallback).listen(process.env.PORT || 3000)

logger.info('⚡️ Bolt app is running!')
