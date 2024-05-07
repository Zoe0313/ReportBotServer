import logger from '../../common/logger.js'
import { RegisterApiRouters } from './manage-api-service.js'
import { ConnectMongoDatabase } from '../../common/db-utils.js'
import Koa from 'koa'
import Router from 'koa-router'
import koaBody from 'koa-body'
import http from 'http'
import mount from 'koa-mount'
import serve from 'koa-static'
import path from 'path'
import axios from 'axios'

// connect to mongodb
ConnectMongoDatabase()

const app = new Koa()
const router = new Router()

app.use(koaBody())

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

app.on('error', err => {
   const errorMessage = err
   logger.error(errorMessage)
   if (process.env.ISSUE_GCHAT_WEBHOOK) {
      try {
         const headers = { 'Content-Type': 'application/json; charset=UTF-8' }
         axios.post(
            process.env.ISSUE_GCHAT_WEBHOOK,
            JSON.stringify({ text: errorMessage }),
            { headers: headers }
         )
      } catch (e) {
         logger.error(e)
      }
   }
})

app.use(router.routes())
   .use(router.allowedMethods())

const serverCallback = app.callback()

// Serve static files
const swaggerPath = path.join(path.resolve(), 'doc/swagger/server')
console.log(swaggerPath)
app.use(mount('/api/v1/', serve(swaggerPath)))

http.createServer(serverCallback).listen(process.env.API_PORT || 4433)
