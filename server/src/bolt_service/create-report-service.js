import logger from '../../common/logger.js'
import { formatDate, merge } from '../../common/utils.js'
import {
   loadBlocks, getUserTz, initReportTypeBlocks, transformInputValuesToObj, findBlockById
} from '../../common/slack-helper.js'
import { ReportConfiguration, REPORT_STATUS } from '../model/report-configuration.js'
import { registerSchedule } from '../scheduler-adapter.js'
import mongoose from 'mongoose'

export function registerCreateReportServiceHandler(app) {
   // New report message configuration
   app.action({
      block_id: 'block_welcome',
      action_id: 'action_create'
   }, async ({ ack, body, client }) => {
      logger.info('open create report config modal')
      if (ack) {
         await ack()
      }
      try {
         const reportModalBasic = loadBlocks('modal/report-basic')
         const reportTypeBlock = loadBlocks('report_type/bugzilla')
         const reportAdvanced = loadBlocks('modal/report-advanced')
         const reportModalRecurrence = loadBlocks('modal/report-recurrence')
         const reportModalTime = loadBlocks('modal/report-time')
         const blocks = reportModalBasic.concat(reportTypeBlock).concat(reportAdvanced)
            .concat(reportModalRecurrence).concat(reportModalTime)
         findBlockById(blocks, 'repeatConfig.startDate').element.initial_date =
            formatDate(new Date())
         initReportTypeBlocks(null, blocks)
         await client.views.open({
            trigger_id: body.trigger_id,
            view: {
               type: 'modal',
               callback_id: 'view_create_report',
               title: {
                  type: 'plain_text',
                  text: 'Create your new report'
               },
               blocks,
               submit: {
                  type: 'plain_text',
                  text: 'Submit'
               }
            },
            submit_disabled: true
         })
      } catch (e) {
         await client.chat.postMessage({
            channel: body.user.id,
            blocks: [],
            text: 'Failed to open create report configuration modal. ' +
               'Please contact developers to resolve it.'
         })
         throw e
      }
   })

   const updateModal = async ({ ack, payload, body, client }) => {
      await ack()

      const reportType = body.view.state.values?.reportType
         ?.action_report_type?.selected_option?.value
      const repeatType = body.view.state.values['repeatConfig.repeatType']
         ?.action_repeat_type?.selected_option?.value
      logger.info(`select report type ${reportType} of report scheduler`)
      logger.info(`select repeat type ${repeatType} of report scheduler`)

      const reportModalBasic = loadBlocks('modal/report-basic')
      const reportModalReportType = loadBlocks(`report_type/${reportType}`)
      const reportAdvanced = loadBlocks('modal/report-advanced')
      const reportModalRecurrence = loadBlocks('modal/report-recurrence')
      const reportModalRepeatType = loadBlocks(`repeat_type/${repeatType}`)
      const reportModalTime = loadBlocks('modal/report-time')
      const blocks = reportModalBasic.concat(reportModalReportType).concat(reportAdvanced)
         .concat(reportModalRecurrence).concat(reportModalRepeatType).concat(reportModalTime)
      await client.views.update({
         view_id: body.view.id,
         hash: body.view.hash,
         view: {
            type: 'modal',
            callback_id: 'view_create_report',
            title: {
               type: 'plain_text',
               text: 'Create your new report'
            },
            blocks,
            submit: {
               type: 'plain_text',
               text: 'Submit'
            }
         }
      })
   }

   app.action({
      block_id: 'repeatConfig.repeatType',
      action_id: 'action_repeat_type'
   }, async (event) => {
      await updateModal(event)
   })

   app.action({
      block_id: 'reportType',
      action_id: 'action_report_type'
   }, async (event) => {
      await updateModal(event)
   })

   // Precheck and create a report request
   app.view('view_create_report', async ({ ack, body, view, client }) => {
      try {
         const user = body.user.id
         const tz = await getUserTz(client, user)
         const inputObj = transformInputValuesToObj(view.state.values)

         const report = new ReportConfiguration(
            merge(inputObj, {
               creator: user,
               status: REPORT_STATUS.CREATED,
               repeatConfig: {
                  tz,
                  date: formatDate(inputObj.repeatConfig.date)
               }
            })
         )
         logger.debug(report)

         const saved = await report.save()
         logger.info(`Create successful. saved report id ${saved._id}`)
         const blocks = loadBlocks('precheck-report')
         // create inited status report
         blocks.find(block => block.block_id === 'block_create_last')
            .elements.forEach(element => { element.value = saved._id })
         await ack()
         await client.chat.postMessage({
            channel: user,
            blocks: blocks,
            text: 'Precheck your new report'
         })
      } catch (e) {
         if (e instanceof mongoose.Error.ValidationError) {
            const ackErrors = {}
            Object.keys(e.errors).forEach(errorKey => {
               ackErrors[errorKey] = e.errors[errorKey].message
            })
            await ack({
               response_action: 'errors',
               errors: ackErrors
            })
         } else {
            await ack()
            await client.chat.postMessage({
               channel: body.user.id,
               blocks: [],
               text: 'Failed to open precheck confirmation. ' +
                  'Please contact developers to resolve it.'
            })
            throw e
         }
      }
   })

   // Listen to the action_create_done action
   app.action({
      block_id: 'block_create_last',
      action_id: 'action_create_done'
   }, async ({ ack, payload, body, say, client }) => {
      await ack()
      try {
         // change to enable status
         logger.info(body)
         const ts = body.message.ts
         const id = payload.value
         if (!ts || !id) {
            return
         }
         logger.info(`report id : ${id}`)
         logger.info(`ts : ${ts}`)
         const report = await ReportConfiguration.findById(id)
         logger.info(`report : ${report}`)
         report.status = REPORT_STATUS.ENABLED
         await report.save()
         registerSchedule(report)
         const blocks = loadBlocks('done-create')
         await client.chat.update({
            channel: body.channel.id,
            ts,
            blocks: blocks,
            text: 'Create and enable new report configuration!'
         })
      } catch (e) {
         await client.chat.postMessage({
            channel: body.user.id,
            blocks: [],
            text: 'Failed to enable new report configuration. ' +
               'Please contact developers to resolve it.'
         })
         throw e
      }
   })

   // Listen to the action_create_save action
   app.action({
      block_id: 'block_create_last',
      action_id: 'action_create_save'
   }, async ({ ack, payload, body, say, client }) => {
      await ack()
      try {
         // change to draft status
         const ts = body.message.ts
         const id = payload.value
         logger.info(`report id : ${id}`)
         const report = await ReportConfiguration.findById(id)
         report.status = REPORT_STATUS.DRAFT
         await report.save()
         await client.chat.update({
            channel: body.channel.id,
            ts,
            blocks: [],
            text: 'Saved draft report configuration.'
         })
      } catch (e) {
         await client.chat.postMessage({
            channel: body.user.id,
            blocks: [],
            text: 'Failed to save report configuration as draft. ' +
               'Please contact developers to resolve it.'
         })
         throw e
      }
   })

   // Listen to the action_create_cancel action
   app.action({
      block_id: 'block_create_last',
      action_id: 'action_create_cancel'
   }, async ({ ack, payload, body, say, client }) => {
      await ack()
      try {
         // remove record in db
         const ts = body.message.ts
         const id = payload.value
         logger.info(`report id : ${id}`)
         await ReportConfiguration.deleteOne({ _id: id })
         await client.chat.update({
            channel: body.channel.id,
            ts,
            blocks: [],
            text: 'Cancel creation.'
         })
      } catch (e) {
         await client.chat.postMessage({
            channel: body.user.id,
            blocks: [],
            text: 'Failed to cancel this report configuration. ' +
               'Please contact developers to resolve it.'
         })
         throw e
      }
   })
}
