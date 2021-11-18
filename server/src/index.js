import dotenv from 'dotenv'
import bolt from '@slack/bolt'
import {
   registerCommonServiceHandler,
   registerCreateReportServiceHandler,
   registerManageReportServiceHandler,
   registerReportHistoryServiceHandler,
   registerRequestApiTokenServiceHandler
} from './bolt_service/index.js'
import { ReportConfiguration, REPORT_STATUS } from './model/report-configuration.js'
import {
   registerScheduler, registerPerforceInfoScheduler,
   registerPerforceMembersScheduler, registerTeamGroupScheduler
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
   const updateTeamGroupJob = registerTeamGroupScheduler()
   logger.info(`next invocation of team group members update is ${updateTeamGroupJob.nextInvocation()}`)
   if (process.env.NODE_ENV !== 'development') {
      updatePerforceInfoJob.invoke()
      updateTeamGroupJob.invoke()
   }
})

// new bolt app with slack bolt token
// get token from https://api.slack.com/apps and write them in .env file
const app = new bolt.App({
   socketMode: true,
   token: process.env.SLACK_BOT_TOKEN,
   appToken: process.env.SLACK_APP_TOKEN,
   userToken: process.env.SLACK_USER_TOKEN,
   signingSecret: process.env.SLACK_SIGNING_SECRET
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
registerRequestApiTokenServiceHandler(app)

app.start()
logger.info('⚡️ Bolt app is running!')
