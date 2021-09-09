import dotenv from 'dotenv'
import bolt from '@slack/bolt'
import express from 'express'
import {
   registerCommonServiceHandler,
   registerCreateReportServiceHandler,
   registerManageReportServiceHandler,
   registerReportHistoryServiceHandler
} from './bolt_service/index.js'
import { registerApiRouters } from './api_service/index.js'
import { ReportConfiguration, REPORT_STATUS } from './model/report-configuration.js'
import {
   registerScheduler, registerPerforceInfoScheduler, registerPerforceMembersScheduler
} from './scheduler-adapter.js'
import { performance } from 'perf_hooks'
import { connectMongoDatabase } from '../common/db-utils.js'
import { initSlackClient } from '../common/slack-helper.js'
import logger from '../common/logger.js'
dotenv.config()

// connect to mongodb
connectMongoDatabase(async () => {
   const reports = await ReportConfiguration.find({ status: REPORT_STATUS.ENABLED })
   reports.forEach(report => registerScheduler(report))
   const updatePerforceInfoJob = registerPerforceInfoScheduler()
   logger.info(`next invocation of p4 info update is ${updatePerforceInfoJob.nextInvocation()}`)
   const flattenMembersJob = registerPerforceMembersScheduler()
   logger.info(`next invocation of p4 members update is ${flattenMembersJob.nextInvocation()}`)
})

// init express receiver for HTTP request
const receiver = new bolt.ExpressReceiver({
   signingSecret: process.env.SLACK_SIGNING_SECRET
})

receiver.router.use(express.json())

// new bolt app with slack bolt token
// get token from https://api.slack.com/apps and write them in .env file
const app = new bolt.App({
   socketMode: true,
   token: process.env.SLACK_BOT_TOKEN,
   appToken: process.env.SLACK_APP_TOKEN,
   signingSecret: process.env.SLACK_SIGNING_SECRET
   // receiver
})
initSlackClient(app.client)

// handler performance
app.use(async ({ body, next }) => {
   const user = body?.user?.id || body?.message?.user ||
      body?.event?.user?.id || body?.event?.user || body?.event?.message?.user
   const type = body?.actions?.map(action => action.action_id)?.join(', ') ||
      body?.subtype || body?.type
   const t0 = performance.now()
   await next()
   const t1 = performance.now()
   if (body?.event?.type !== 'user_change') {
      logger.debug(`${user} did ${type} took ${(t1 - t0)} milliseconds.`)
   }
})

// global error handler
app.error((error) => {
   const errorMessage = `original message: ${error.original}, ` +
      `stack: ${error.original?.stack}`
   logger.error(error)
   logger.error(errorMessage)
   if (process.env.ISSUE_CHANNEL_ID) {
      try {
         app.client.chat.postMessage({
            channel: process.env.ISSUE_CHANNEL_ID,
            blocks: [],
            text: errorMessage
         })
      } catch (e) {
         logger.error(e)
      }
   }
})

// register handlers for slack bolt UI
registerCommonServiceHandler(app)
registerCreateReportServiceHandler(app)
registerManageReportServiceHandler(app)
registerReportHistoryServiceHandler(app)

// register handlers for restful HTTP APIs
registerApiRouters(receiver, app)

app.start()
receiver.start(process.env.PORT || 3000)
logger.info('⚡️ Bolt app is running!')
