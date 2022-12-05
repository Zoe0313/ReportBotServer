import { ReportHistory } from '../model/report-history.js'
import { ReportConfiguration } from '../model/report-configuration.js'
import logger from '../../common/logger.js'

const GetSentReportCount = async () => {
   // The sum of report histories count group by report status
   // return metrics example:
   // slackbot_sent_report_count{status="succeed"} 196
   let metrics = ''
   const docs = await ReportHistory.aggregate().group({
      _id: '$status', count: { $sum: 1 }
   })
   for (const doc of docs) {
      const reportStatus = doc._id
      const count = doc.count
      metrics += `slackbot_sent_report_count{status="${reportStatus.toLowerCase()}"} ${count}\n`
      metrics += await FilterSentCountByStatus(reportStatus)
   }
   return metrics
}

async function FilterSentCountByStatus(reportStatus) {
   // Match specified report status, the sum of report histories count group by report type
   // return metrics example:
   // slackbot_sent_report_count{status="succeed", reportType="bugzilla"} 105
   let metrics = ''
   const docs = await ReportHistory.aggregate().match({
      status: reportStatus
   }).group({
      _id: '$reportType', count: { $sum: 1 }
   })
   for (const doc of docs) {
      const reportType = doc._id
      const count = doc.count
      metrics += `slackbot_sent_report_count{status="${reportStatus.toLowerCase()}", reportType="${reportType}"} ${count}\n`
   }
   return metrics
}

const GetReportConfigurationCount = async () => {
   // The sum of used report configurations count group by report configuration status
   // return metrics example:
   // slackbot_report_configuration_count{status="enabled"} 72
   let metrics = ''
   const docs = await ReportConfiguration.aggregate().group({
      _id: '$status', count: { $sum: 1 }
   })
   for (const doc of docs) {
      const configStatus = doc._id
      const count = doc.count
      metrics += `slackbot_report_configuration_count{status="${configStatus.toLowerCase()}"} ${count}\n`
      metrics += await FilterReportConfigurationCountByStatus(configStatus)
   }
   return metrics
}

async function FilterReportConfigurationCountByStatus(configStatus) {
   // Match specified report configuration status, the sum of report configurations count
   // group by report type.
   // return metrics example:
   // slackbot_report_configuration_count{status="enabled", reportType="bugzilla"} 55
   let metrics = ''
   const docs = await ReportConfiguration.aggregate().match({
      status: configStatus
   }).group({
      _id: '$reportType', count: { $sum: 1 }
   })
   for (const doc of docs) {
      const reportType = doc._id
      const count = doc.count
      metrics += `slackbot_report_configuration_count{status="${configStatus.toLowerCase()}", reportType="${reportType}"} ${count}\n`
   }
   return metrics
}

const GetMetrics = async () => {
   let metrics = await GetSentReportCount()
   metrics += await GetReportConfigurationCount()
   logger.info(`metrics: ${metrics}`)
   return metrics
}

export { GetMetrics }
