import logger from '../../common/logger.js'
import { RegisterApiRouters } from './manage-api-service.js'
import { ConnectMongoDatabase } from '../../common/db-utils.js'
import { InitSlackClient } from '../../common/slack-helper.js'
import { WebClient } from '@slack/web-api'
import Koa from 'koa'
import Router from 'koa-router'
import koaBody from 'koa-body'
import http from 'http'
import mount from 'koa-mount'
import serve from 'koa-static'
import path from 'path'

// connect to mongodb
ConnectMongoDatabase()

const client = new WebClient(process.env.SLACK_BOT_TOKEN_REST)
const app = new Koa()
const router = new Router()

InitSlackClient(client)

app.use(koaBody())

RegisterApiRouters(router, client)

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

const serverCallback = app.callback()

// Serve static files
const swaggerPath = path.join(path.resolve(), 'doc/swagger/server')
console.log(swaggerPath)
app.use(mount('/api/v1/', serve(swaggerPath)))

http.createServer(serverCallback).listen(process.env.API_PORT || 443)
