import dotenv from 'dotenv'
import bolt from '@slack/bolt'
import {
   RegisterCommonServiceHandler,
   RegisterCreateReportServiceHandler,
   RegisterManageReportServiceHandler,
   RegisterReportHistoryServiceHandler,
   RegisterRequestApiTokenServiceHandler
} from './bolt_service/index.js'
import { ReportConfiguration, REPORT_STATUS } from './model/report-configuration.js'
import {
   RegisterScheduler, RegisterPerforceInfoScheduler,
   RegisterPerforceMembersScheduler, RegisterTeamGroupScheduler,
   RegisterVSANNannyScheduler
} from './scheduler-adapter.js'
import { performance } from 'perf_hooks'
import { ConnectMongoDatabase } from '../common/db-utils.js'
import { InitSlackClient } from '../common/slack-helper.js'
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
   const updateVSANNannyJob = RegisterVSANNannyScheduler()
   logger.info(`next invocation of vSAN nanny list update is ${updateVSANNannyJob.nextInvocation()}`)
   if (process.env.NODE_ENV !== 'development') {
      updatePerforceInfoJob.invoke()
      updateTeamGroupJob.invoke()
      updateVSANNannyJob.invoke()
   } else {
      updateVSANNannyJob.invoke()// cache vsan-nanny.csv
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

InitSlackClient(app.client)

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
RegisterCommonServiceHandler(app)
RegisterCreateReportServiceHandler(app)
RegisterManageReportServiceHandler(app)
RegisterReportHistoryServiceHandler(app)
RegisterRequestApiTokenServiceHandler(app)

app.start()
logger.info('⚡️ Bolt app is running!')
