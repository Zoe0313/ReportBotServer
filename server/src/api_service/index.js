import { ReportConfiguration } from '../model/report-configuration.js'
import { registerScheduler, unregisterScheduler } from '../scheduler-adapter.js'
import logger from '../../common/logger.js'
import mongoose from 'mongoose'
import { merge } from '../../common/utils.js'

export function registerApiRouters(receiver, app) {
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
      if (req.query.user == null) {
         res.status(400)
         res.json({ result: false, message: 'User ID is null' })
         return
      }
      const filter = {}
      if (req.query.user != null) {
         filter.creator = req.query.user
      }
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
      const report = await ReportConfiguration.findById(req.params.id)
      logger.info(report)
      res.json(report)
   })

   receiver.router.post('/api/v1/server/report_configurations', async (req, res) => {
      try {
         logger.info(req.body)
         const report = await new ReportConfiguration(req.body).save()
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
         const oldReport = await ReportConfiguration.findById(req.params.id)
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
      const result = await ReportConfiguration.findByIdAndRemove(req.params.id)
      if (result) {
         unregisterScheduler(req.params.id)
         res.json({ result: true })
      } else {
         res.json({ result: false, message: 'Delete report configuration failed' })
      }
   })
}
