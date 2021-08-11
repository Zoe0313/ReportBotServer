import dotenv from 'dotenv'
dotenv.config()

import bolt from '@slack/bolt'
import express from 'express'
import {
   commonService, createReportService, manageReportService, reportHistoryService
} from './bolt_service/index.js'
import { registerApiRouters } from './api_service/index.js'
import { connectMongoDatabase } from './database-adapter.js'
import { ReportConfiguration, REPORT_STATUS } from './model/report-configuration.js'
import { registerSchedule } from './scheduler-adapter.js'
import { performance } from 'perf_hooks'
import logger from './logger.js'

connectMongoDatabase(async () => {
   const reports = await ReportConfiguration.find({ status: REPORT_STATUS.ENABLED })
   reports.forEach(report => registerSchedule(report))
})

const receiver = new bolt.ExpressReceiver({ signingSecret: process.env.SLACK_SIGNING_SECRET })

receiver.router.use(express.json())

const app = new bolt.App({
   socketMode: true,
   token: process.env.SLACK_BOT_TOKEN,
   appToken: process.env.SLACK_APP_TOKEN,
   signingSecret: process.env.SLACK_SIGNING_SECRET
   // receiver
})

app.use(async ({ body, next }) => {
   const user = body?.user?.id || body?.message?.user || body?.event?.message?.user
   const type = body?.subtype || body?.type
   const t0 = performance.now()
   await next()
   const t1 = performance.now()
   logger.info(`${user} did ${type} took ${(t1 - t0)} milliseconds.`)
})

app.error((error) => {
   console.error(error);
})

commonService(app)
createReportService(app)
manageReportService(app)
reportHistoryService(app)

registerApiRouters(receiver, app)

app.start()
receiver.start(process.env.PORT || 3000)
logger.info('⚡️ Bolt app is running!')