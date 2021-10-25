import { ReportConfiguration } from '../model/report-configuration.js'
import { SlackbotApiToken } from '../model/api-token.js'
import { registerScheduler, unregisterScheduler } from '../scheduler-adapter.js'
import logger from '../../common/logger.js'
import mongoose from 'mongoose'
import { merge } from '../../common/utils.js'
import Koa from 'koa'
import Router from 'koa-router'
import koaBody from 'koa-body'
import { connectMongoDatabase } from '../../common/db-utils.js'
import { WebClient } from '@slack/web-api'
import fs from 'fs'
import https from 'https'
// import mount from 'koa-mount'
// import serve from 'koa-static'
// import path from 'path'

function registerApiRouters(router, client) {
   router.use(async (ctx, next) => {
      if (ctx.url.endsWith('/server/health')) {
         await next()
         return
      }
      const token = ctx.request.headers.authorization?.substring('Bearer '.length)
      const apiToken = await SlackbotApiToken.findOne({ token })
      if (apiToken == null || apiToken.userId == null) {
         ctx.response.status = 401
         ctx.response.body = { message: 'Authorization failure' }
         return
      }
      ctx.state.userId = apiToken.userId
      await next()
   })

   router.get('/api/v1/server/health', (ctx, next) => {
      ctx.response.status = 200
      ctx.response.body = { result: true }
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
         ctx.response.body = { result: false, message: 'Invalid id' }
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
         registerScheduler(report)
         ctx.response.body = report
      } catch (e) {
         if (e instanceof mongoose.Error.ValidationError) {
            ctx.response.status = 400
            ctx.response.body = e.errors
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
         const report = merge(oldReport, ctx.request.body)
         logger.info(`original report: ${oldReport}\nnew report: ${report}`)
         await report.save()
         registerScheduler(report)
         ctx.response.body = report
      } catch (e) {
         if (e instanceof mongoose.Error.ValidationError) {
            ctx.response.status = 400
            ctx.response.body = e.errors
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
         unregisterScheduler(ctx.params.id)
         ctx.response.status = 200
         ctx.response.body = { result: true }
      } else {
         ctx.response.status = 200
         ctx.response.body = { result: false, message: 'Delete report configuration failed' }
      }
   })

   router.post('/api/v1/channel/:channelId/messages', async (ctx, next) => {
      ctx.assert(ctx.request.body.text != null, 400,
         'The message is not given, can not post the empty message.', { result: false })
      ctx.assert(ctx.params.channelId != null, 400, 'Channel ID is not given when posting message.',
         { result: false })
      logger.debug(`the message "${ctx.request.body.text}" will be sent to channel ${ctx.params.channelId}`)
      const request = {
         channel: ctx.params.channelId,
         text: ctx.request.body.text
      }
      const result = await client.chat.postMessage(request)
      logger.debug(`post message result for ${ctx.state.userId} is: ${JSON.stringify(result)}`)
      ctx.response.body = result
   })
}

// connect to mongodb
connectMongoDatabase()

const client = new WebClient(process.env.SLACK_BOT_TOKEN)
const app = new Koa()
const router = new Router()

app.use(koaBody())

registerApiRouters(router, client)

app.use(async (ctx, next) => {
   try {
      await next()
   } catch (err) {
      ctx.status = err.status || 500
      ctx.body = err
      ctx.app.emit('error', err, ctx)
   }
})

app.on('error', err => {
   logger.error('api server error', err)
})

app
   .use(router.routes())
   .use(router.allowedMethods())

// // Serve static files
// const swaggerPath = path.join(path.resolve(), './doc/swagger/scheduler')
// console.log(swaggerPath)
// app.use(mount('/api/v1/scheduler', serve(swaggerPath)))
const clientTls = {
   key: fs.readFileSync('src/key.pem'),
   cert: fs.readFileSync('src/cert.pem')
}
const serverCallback = app.callback()
https.createServer(clientTls, serverCallback).listen(process.env.PORT || 443)
