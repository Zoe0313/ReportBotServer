import { formatDate } from '../../common/utils.js'
import logger from '../../common/logger.js'
import { loadBlocks, getUserTz } from '../../common/slack-helper.js'
import { ReportConfiguration, REPORT_STATUS } from '../model/report-configuration.js'
import { registerSchedule } from '../scheduler-adapter.js'

export function registerCreateReportService(app) {

   // New report message configuration
   app.action({
      'block_id': 'block_welcome',
      'action_id': 'action_create'
   }, async ({ ack, body, client }) => {
      logger.info('open create report config modal')
      if (ack) {
         await ack()
      }
      try {
         const reportModalBasic = loadBlocks('modal/report-basic')
         const reportModalTime = loadBlocks('modal/report-time')
         const blocks = reportModalBasic.concat(reportModalTime)
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
            submit_disabled: true,
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
      try {
         const reportType = body.view.state.values
            ?.block_report_type?.action_report_type?.selected_option?.value
         const repeatType = body.view.state.values
            ?.block_repeat_type?.action_repeat_type?.selected_option?.value
         logger.info(`select report type ${reportType} of report scheduler`)
         logger.info(`select repeat type ${repeatType} of report scheduler`)

         const reportModalBasic = loadBlocks('modal/report-basic')
         const reportModalReportType = loadBlocks(`report_type/${reportType}`)
         const reportModalTime = loadBlocks('modal/report-time')
         const reportModalRepeatType = loadBlocks(`repeat_type/${repeatType}`)
         const blocks = reportModalBasic.concat(reportModalReportType)
            .concat(reportModalTime).concat(reportModalRepeatType)
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
      } catch (e) {
         throw e
      }
   }

   app.action({
      'block_id': 'block_repeat_type',
      'action_id': 'action_repeat_type'
   }, async (event) => {
      await updateModal(event)
   })

   app.action({
      'block_id': 'block_report_type',
      'action_id': 'action_report_type'
   }, async (event) => {
      await updateModal(event)
   })

   // Precheck and create a report request
   app.view('view_create_report', async ({ ack, body, view, client }) => {
      await ack()
      const user = body['user']['id']
      const tz = await getUserTz(client, user)
      const inputObj = {}
      const inputValues = Object.values(view['state']['values'])
      inputValues.forEach(actions => {
         Object.keys(actions).forEach(actionKey => {
            inputObj[actionKey] = actions[actionKey]
         })
      })
      logger.info(inputObj)
      const parseIntNullable = (num) => num ? parseInt(num) : null
      const report = new ReportConfiguration({
         title: inputObj.action_title?.value,
         creator: user,
         status: REPORT_STATUS.CREATED,
         reportType: inputObj.action_report_type?.selected_option?.value,
         reportLink: inputObj.action_report_link?.value,
         conversations: inputObj.action_conversation?.selected_conversations,
         mentionUsers: inputObj.action_report_users?.selected_users,
         repeatConfig: {
            repeatType: inputObj.action_repeat_type?.selected_option?.value,
            tz,
            startDate: inputObj.action_start_date?.selected_date,
            endDate: inputObj.action_end_date?.selected_date,
            cronExpression: inputObj.action_cron_expression?.value,
            date: formatDate(inputObj.action_date?.selected_date),
            time: inputObj.action_time?.selected_time,
            dayOfMonth: parseIntNullable(inputObj.action_day_of_month?.value),
            dayOfWeek: inputObj.action_day_of_week?.selected_options
               ?.map(option => parseIntNullable(option.value)),
            minsOfHour: parseIntNullable(inputObj.action_mins_of_hour?.value),
         }
      })
      logger.info(report)
      try {
         const saved = await report.save()
         logger.info(`Create successful. saved report id ${saved._id}`)
         const blocks = loadBlocks('precheck-report')
         // create inited status report
         blocks.find(block => block.block_id === 'block_create_last')
            .elements.forEach(element => element.value = saved._id)
         await client.chat.postMessage({
            channel: user,
            blocks: blocks,
            text: 'Precheck your new report'
         })
      } catch (e) {
         await client.chat.postMessage({
            channel: body.user.id,
            blocks: [],
            text: 'Failed to open precheck confirmation. ' + 
               'Please contact developers to resolve it.'
         })
         throw e
      }
   })

   // Listen to the action_create_done action
   app.action({
      'block_id': 'block_create_last',
      'action_id': 'action_create_done'
   }, async ({ ack, payload, body, say, client }) => {
      await ack()
      // change to enable status
      logger.info(body)
      const ts = body['message']['ts']
      const id = payload.value
      if (!ts || !id) {
         return
      }
      logger.info(`report id : ${id}`)
      logger.info(`ts : ${ts}`)
      try {
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
      'block_id': 'block_create_last',
      'action_id': 'action_create_save'
   }, async ({ ack, payload, body, say, client }) => {
      await ack()
      // change to draft status
      const ts = body['message']['ts']
      const id = payload.value
      logger.info(`report id : ${id}`)
      try {
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
      'block_id': 'block_create_last',
      'action_id': 'action_create_cancel'
   }, async ({ ack, payload, body, say, client }) => {
      await ack()
      // remove record in db
      const ts = body['message']['ts']
      const id = payload.value
      logger.info(`report id : ${id}`)
      try {
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