import { ReportConfiguration } from '../model/report-configuration.js'
import { SlackbotApiToken } from '../model/api-token.js'
import { registerScheduler, unregisterScheduler } from '../scheduler-adapter.js'
import logger from '../../common/logger.js'
import mongoose from 'mongoose'
import { merge } from '../../common/utils.js'

export function registerApiRouters(receiver, app) {
   receiver.router.use(async (req, res, next) => {
      const token = req.get('Authorization')?.substring('Bearer '.length)
      console.log(token)
      const apiToken = await SlackbotApiToken.findOne({ token })
      if (apiToken == null || apiToken.userId == null) {
         res.status(401)
         res.json({ message: 'Authorization failed' })
         return
      }
      res.locals.userId = apiToken.userId
      await next()
   })

   receiver.router.get('/api/v1/server/health', (req, res) => {
      if (app.receiver.client.badConnection) {
         res.status(500)
         res.json({ result: false, message: 'Internal Server Error' })
         return
      }
      res.status(200)
      res.json({ result: true })
   })

   receiver.router.get('/api/v1/server/report_configurations', async (req, res) => {
      const userId = res.locals.userId
      const filter = { creator: userId }
      const reports = await ReportConfiguration.find(filter)
         .skip(req.query.offset).limit(req.query.limit)
      logger.info(reports)
      res.json(reports)
   })

   receiver.router.get('/api/v1/server/report_configurations/:id', async (req, res) => {
      if (req.params.id == null) {
         res.status(400)
         res.json({ result: false, message: 'Invalid id' })
         return
      }
      const userId = res.locals.userId
      const report = await ReportConfiguration.findOne({ _id: req.params.id, creator: userId })
      logger.info(report)
      res.json(report)
   })

   receiver.router.post('/api/v1/server/report_configurations', async (req, res) => {
      try {
         logger.info(req.body)
         const userId = res.locals.userId
         const report = await new ReportConfiguration(req.body)
         report.creator = userId
         await report.save()
         registerScheduler(report)
         res.json(report)
      } catch (e) {
         if (e instanceof mongoose.Error.ValidationError) {
            res.status(400)
            res.json(e.errors)
         } else {
            res.status(500)
            res.json({ result: false, message: 'Internal Server Error' })
         }
         logger.error(e)
      }
   })

   receiver.router.put('/api/v1/server/report_configurations/:id', async (req, res) => {
      try {
         logger.info(req.params.id)
         const userId = res.locals.userId
         const oldReport = await ReportConfiguration.findOne({
            _id: req.params.id, creator: userId
         })
         if (oldReport == null) {
            res.status(404)
            res.json({ result: false, message: 'report configuration not found' })
            return
         }
         const report = merge(oldReport, req.body)
         logger.info(`original report: ${oldReport}\nnew report: ${report}`)
         await report.save()
         registerScheduler(report)
         res.json(report)
      } catch (e) {
         if (e instanceof mongoose.Error.ValidationError) {
            res.status(400)
            res.json(e.errors)
         } else {
            res.status(500)
            res.json({ result: false, message: 'Internal Server Error' })
         }
         logger.error(e)
      }
   })

   receiver.router.delete('/api/v1/server/report_configurations/:id', async (req, res) => {
      logger.info(req.params.id)
      const userId = res.locals.userId
      const result = await ReportConfiguration.findOneAndRemove({
         _id: req.params.id, creator: userId
      })
      if (result) {
         unregisterScheduler(req.params.id)
         res.json({ result: true })
      } else {
         res.json({ result: false, message: 'Delete report configuration failed' })
      }
   })

   receiver.router.post('/api/v1/server/messages', async (req, res) => {
      const result = await app.client.chat.postMessage(req.body)
      logger.info(`post message result for ${res.locals.userId} is: ${JSON.stringify(result)}`)
      res.json(result)
   })
}
