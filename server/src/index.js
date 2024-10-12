import dotenv from 'dotenv'
import axios from 'axios'
import Koa from 'koa'
import Router from 'koa-router'
import koaBody from 'koa-body'
import http from 'http'
import mount from 'koa-mount'
import serve from 'koa-static'
import path from 'path'
import fs from 'fs'
import { ConnectMongoDatabase } from '../common/db-utils.js'
import { ReportConfiguration, REPORT_STATUS } from './model/report-configuration.js'
import {
   RegisterScheduler, RegisterPerforceInfoScheduler,
   RegisterPerforceMembersScheduler, RegisterTeamGroupScheduler
} from './scheduler-adapter.js'
import { RegisterApiRouters } from './api_service/manage-api-service.js'
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
   if (process.env.NODE_ENV !== 'development') {
      updatePerforceInfoJob.invoke()
   }
   updateTeamGroupJob.invoke()
})

const app = new Koa()
app.use(serve('src/static'))
app.use(koaBody())
const router = new Router()

router.get(['/', '/reports', '/history'], (ctx, next) => {
   ctx.body = fs.readFileSync('src/static/index.html', 'utf8')
   next()
})

RegisterApiRouters(router)

app.use(async (ctx, next) => {
   try {
      await next()
   } catch (err) {
      ctx.status = err.status || 500
      ctx.body = err
      ctx.app.emit('error', err, ctx)
   }
})

// global error handler
app.on('error', error => {
   logger.error(error)
   if (process.env.ISSUE_GCHAT_WEBHOOK) {
      try {
         const CONTENT_TYPE_JSON_UTF = { 'Content-Type': 'application/json; charset=UTF-8' }
         axios.post(
            process.env.ISSUE_GCHAT_WEBHOOK,
            JSON.stringify({ text: error }),
            { headers: CONTENT_TYPE_JSON_UTF }
         )
      } catch (e) {
         logger.error(e)
      }
   }
})

const swaggerPath = path.join(path.resolve(), 'doc/swagger/server')
console.log(swaggerPath)

app.use(router.routes())
   .use(router.allowedMethods())
   .use(mount('/api/v1/', serve(swaggerPath)))

const serverCallback = app.callback()
http.createServer(serverCallback).listen(process.env.PORT || 3000)

logger.info('⚡️ Bolt app is running!')
