import { ReportConfiguration } from '../model/report-configuration.js'
import { registerSchedule, unregisterSchedule } from '../scheduler-adapter.js'

export function registerApiRouters(receiver, app) {
    receiver.router.get('/health', (req, res) => {
        if (app.receiver.client.badConnection) {
            res.status(500).send('Internal Server Error')
            return
        }
        res.status(200).send(true)
    })

    receiver.router.get('/report_configurations', async (req, res) => {
        const reports = await ReportConfiguration.find({ creator: 'U014LBYG63D' })
        console.log(reports)
        res.json(reports)
    })

    receiver.router.get('/report_configurations/:id', async (req, res) => {
        const report = await ReportConfiguration.findById(req.params.id)
        console.log(report)
        res.json(report)
    })

    receiver.router.post('/report_configurations', async (req, res) => {
        try {
            console.log(req.body)
            const report = await new ReportConfiguration(req.body).save()
            registerSchedule(report)
            res.json(report)
        } catch (e) {
            res.status(500)
            res.send(e.message)
        }
    })

    receiver.router.put('/report_configurations/:id', async (req, res) => {
        try {
            console.log(req.body)
            console.log(req.params.id)
            await ReportConfiguration.updateOne({ _id: req.params.id }, req.body)
            const report = await ReportConfiguration.findById(req.params.id)
            registerSchedule(report)
            res.json(report)
        } catch (e) {
            res.status(500)
            res.send(e.message)
        }
    })

    receiver.router.delete('/report_configurations/:id', async (req, res) => {
        console.log(req.params.id)
        const result = await ReportConfiguration.findByIdAndRemove(req.params.id)
        if (result) {
            unregisterSchedule(req.params.id)
            res.send(true)
        } else {
            res.send(false)
        }
    })

}