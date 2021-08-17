import { ReportConfiguration } from '../model/report-configuration.js'
import { registerSchedule, unregisterSchedule } from '../scheduler-adapter.js'
import logger from '../../common/logger.js'

export function registerApiRouters(receiver, app) {
   receiver.router.get('/health', (req, res) => {
      if (app.receiver.client.badConnection) {
         res.status(500)
         res.json({ result: false, message: 'Internal Server Error' })
         return
      }
      res.status(200)
      res.json({ result: true })
   })

   receiver.router.get('/report_configurations', async (req, res) => {
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
         .offset(req.query.offset).limit(req.query.limit)
      logger.info(reports)
      res.json(reports)
   })

   receiver.router.get('/report_configurations/:id', async (req, res) => {
      if (req.params.id == null) {
         res.status(400)
         res.json({ result: false, message: 'invalid id' })
         return
      }
      const report = await ReportConfiguration.findById(req.params.id)
      logger.info(report)
      res.json(report)
   })

   receiver.router.post('/report_configurations', async (req, res) => {
      try {
         logger.info(req.body)
         const report = await new ReportConfiguration(req.body).save()
         registerSchedule(report)
         res.json(report)
      } catch (e) {
         res.status(500)
         res.json({ result: false, message: 'Internal Server Error' })
         logger.error(e)
      }
   })

   receiver.router.put('/report_configurations/:id', async (req, res) => {
      try {
         logger.info(req.body)
         logger.info(req.params.id)
         await ReportConfiguration.updateOne({ _id: req.params.id }, req.body)
         const report = await ReportConfiguration.findById(req.params.id)
         registerSchedule(report)
         res.json(report)
      } catch (e) {
         res.status(500)
         res.json({ result: false, message: 'Internal Server Error' })
         logger.error(e)
      }
   })

   receiver.router.delete('/report_configurations/:id', async (req, res) => {
      logger.info(req.params.id)
      const result = await ReportConfiguration.findByIdAndRemove(req.params.id)
      if (result) {
         unregisterSchedule(req.params.id)
         res.json({ result: true })
      } else {
         res.json({ result: false, message: 'delete report configuration failed' })
      }
   })
}
