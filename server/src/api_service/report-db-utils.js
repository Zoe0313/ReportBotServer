import { ReportHistory } from '../model/report-history.js'
import {
   ReportConfiguration, REPORT_STATUS
} from '../model/report-configuration.js'
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
   logger.info(`${JSON.stringify(docs)}`)
   for (const doc of docs) {
      const reportType = doc._id
      const count = doc.count
      metrics += `slackbot_sent_report_count{status="${reportStatus.toLowerCase()}", reportType="${reportType}"} ${count}\n`
   }
   return metrics
}

const GetReportConfigurationCount = async () => {
   // The sum of used report configurations count group by report type
   // return metrics example:
   // slackbot_report_configuration_count{reportType=/"bugzilla/"} 56
   let metrics = ''
   const filter = {
      status: { $ne: REPORT_STATUS.CREATED }
   }
   const totalCount = await ReportConfiguration.countDocuments(filter)
   metrics += `slackbot_report_configuration_count{reportType=""} ${totalCount}\n`
   const docs = await ReportConfiguration.aggregate().match(filter).group({
      _id: '$reportType', count: { $sum: 1 }
   })
   for (const doc of docs) {
      const reportType = doc._id
      const count = doc.count
      metrics += `slackbot_report_configuration_count{reportType="${reportType}"} ${count}\n`
   }
   logger.info(`metrics: ${metrics}`)
   return metrics
}

const GetMetrics = async () => {
   let metrics = await GetSentReportCount()
   metrics += await GetReportConfigurationCount()
   logger.info(`metrics: ${metrics}`)
   return metrics
}

export { GetMetrics }
