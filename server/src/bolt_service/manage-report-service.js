import {
   formatDate, formatDateTime, merge
} from '../../common/utils.js'
import logger from '../../common/logger.js'
import {
   loadBlocks, getConversationsName, getUserTz,
   transformInputValuesToObj, findBlockById, tryAndHandleError
} from '../../common/slack-helper.js'
import { displayTimeSetting, updateFlattenMembers } from './init-blocks-data-helper.js'
import {
   ReportConfiguration, REPORT_STATUS
} from '../model/report-configuration.js'
import { ReportConfigurationState } from '../model/report-configuration-state.js'
import {
   registerScheduler, unregisterScheduler, nextInvocation, cancelNextInvocation, invokeNow
} from '../scheduler-adapter.js'
import { updateModal } from './create-report-service.js'
import cloneDeep from 'lodash/cloneDeep.js'
import mongoose from 'mongoose'
// import { performance } from 'perf_hooks'

const LIMIT = 5

const REPORT_STATUS_DISPLAY = {
   CREATED: 'Created',
   DRAFT: ':black_square_for_stop: Draft',
   DISABLED: ':black_square_for_stop: Disabled',
   ENABLED: ':white_check_mark: Enabled'
}

async function getState(ts) {
   let state = await ReportConfigurationState.findOne({ ts })
   if (state == null) {
      state = ReportConfigurationState({
         ts,
         page: 1,
         count: null,
         channel: null,
         selectedId: null
      })
      await state.save()
   }
   return state
}

async function saveState(state) {
   if (state != null) {
      await ReportConfigurationState.updateOne({ _id: state._id }, state)
   } else {
      throw new Error('State should not be null.')
   }
}

export function registerManageReportServiceHandler(app) {
   const listReports = async (isUpdate, ts, ack, body, client) => {
      logger.info('display or update list, ts ' + ts)
      const state = await getState(ts)
      const user = body.user?.id
      if (user == null) {
         throw new Error('User is none in body, can not list the reports.')
      }
      const tz = await getUserTz(user)
      let offset = (state.page - 1) * LIMIT
      const filter = {
         status: { $ne: REPORT_STATUS.CREATED }
      }
      if (!process.env.ADMIN_USER_ID.includes(user)) {
         filter.creator = user
      }
      const count = await ReportConfiguration.countDocuments(filter)
      if (offset >= count) {
         state.page = 1
         offset = 0
      }
      state.count = count
      const reportConfigurations = await ReportConfiguration.find(filter)
         .skip(offset).limit(LIMIT).sort({
            updatedAt: -1
         })

      // list header
      const listHeader = loadBlocks('report/list-header')
      listHeader[0].text.text = `There are ${count} notifications in your account.`

      // list item detail
      let listItemDetail = loadBlocks('report/list-item-detail')
      const report = await ReportConfiguration.findById(state.selectedId)
      if (state.selectedId == null || report == null) {
         state.selectedId = null
         listItemDetail = []
      } else {
         const [conversations, mentionUsers] = await Promise.all([
            getConversationsName(report.conversations),
            getConversationsName(report.mentionUsers)
         ])
         logger.info(conversations)
         logger.info(mentionUsers)
         const nextInvocationTime = await nextInvocation(report._id)
         const nextReportSendingTime = nextInvocationTime
            ? formatDateTime(new Date(nextInvocationTime), tz)
            : 'No longer executed'
         logger.info(nextReportSendingTime)

         // report title
         listItemDetail[1].text.text = `*Title: ${report.title}*`
         if (process.env.ADMIN_USER_ID.includes(user)) {
            listItemDetail[1].text.text += `  created by ${getConversationsName([report.creator])}`
         }
         // report type
         const reportTypeOptions = findBlockById(loadBlocks('modal/report-basic'), 'reportType')
            .element.options
         listItemDetail[2].fields[0].text += reportTypeOptions.find(
            option => option.value === report.reportType).text.text
         // report status
         listItemDetail[2].fields[1].text += REPORT_STATUS_DISPLAY[report.status]
         // report channels to be sent
         listItemDetail[2].fields[2].text += conversations
         // users to be notified
         listItemDetail[2].fields[3].text += mentionUsers
         // scheduler start date
         listItemDetail[2].fields[4].text += formatDate(report.repeatConfig.startDate)
         // scheduler end date
         listItemDetail[2].fields[5].text += formatDate(report.repeatConfig.endDate)
         // repeat config summary
         listItemDetail[2].fields[6].text += displayTimeSetting(report, tz)
         // next sending time
         listItemDetail[2].fields[7].text += nextReportSendingTime

         // edit button
         listItemDetail[3].elements[0].value = report._id
         // remove button
         listItemDetail[3].elements[1].value = report._id
         // enable or disable button, only display one button
         listItemDetail[3].elements.splice(report.status === REPORT_STATUS.ENABLED ? 2 : 3, 1)
      }

      // list items
      const listItemTemplate = loadBlocks('report/list-item-template')[0]
      const listItems = reportConfigurations.map(report => {
         const creator = process.env.ADMIN_USER_ID.includes(user) ? ` - ${getConversationsName([report.creator])}` : ''
         const icon = report.status === 'ENABLED' ? ':white_check_mark:' : ':black_square_for_stop:'
         const content = `*${report.title} - ${report.reportType}*${creator} ${icon}\n${displayTimeSetting(report, tz)}`
         const listItem = cloneDeep(listItemTemplate)
         listItem.text.text = content
         listItem.accessory.value = report._id
         if (report._id.toString() === state.selectedId) {
            listItem.accessory.style = 'primary'
            listItem.accessory.text.text = 'close'
         }
         return listItem
      })

      // list pagination
      let listPagination = loadBlocks('report/list-pagination')
      const listPaginationElements = []
      if (state.page > 1) {
         listPaginationElements.push(listPagination[0].elements[0])
      }
      if (state.page * LIMIT < count) {
         listPaginationElements.push(listPagination[0].elements[1])
      }
      if (listPaginationElements.length > 0) {
         listPagination[0].elements = listPaginationElements
      } else {
         listPagination = []
      }
      const blocks = listHeader.concat(listItems).concat(listItemDetail).concat(listPagination)
      if (ack) {
         await ack()
      }
      if (isUpdate) {
         state.channel = body.channel ? body.channel.id : state.channel
         await client.chat.update({
            channel: state.channel,
            ts,
            text: 'Manage all reports',
            blocks
         })
      } else {
         const response = await client.chat.postMessage({
            channel: user,
            text: 'Manage all reports',
            blocks
         })
         state.channel = response.channel
         state.ts = response.ts
      }
      await saveState(state)
   }

   // List all reports
   app.action({
      block_id: 'block_welcome',
      action_id: 'action_list'
   }, async ({ ack, body, client }) => {
      tryAndHandleError({ ack, body, client }, async () => {
         await listReports(false, body.message?.ts, ack, body, client)
      }, 'Failed to open notification configs list.')
   })

   // Choose report to display detail
   app.action('action_choose_report_item', async ({ ack, body, payload, say, client }) => {
      const ts = body.message.ts

      tryAndHandleError({ ack, body, client }, async () => {
         const state = await getState(ts)
         const selected = payload.value
         logger.info('choose report id ' + selected)
         if (state.selectedId === selected) {
            state.selectedId = null
         } else {
            state.selectedId = selected
         }
         await saveState(state)
         await listReports(true, ts, ack, body, client)
      }, 'Failed to view notification detail.')
   })

   // previous 5 reports
   app.action({
      block_id: 'block_list_pagination',
      action_id: 'action_previous_page'
   }, async ({ ack, body, client }) => {
      const ts = body.message.ts

      tryAndHandleError({ ack, body, client }, async () => {
         const state = await getState(ts)
         if (state.page > 1) {
            state.page -= 1
            await saveState(state)
            await listReports(true, ts, ack, body, client)
         } else {
            await ack()
         }
      }, 'Failed to display previous 5 notification.')
   })

   // next 5 reports
   app.action({
      block_id: 'block_list_pagination',
      action_id: 'action_next_page'
   }, async ({ ack, body, client }) => {
      const ts = body.message.ts

      tryAndHandleError({ ack, body, client }, async () => {
         const state = await getState(ts)
         const count = await ReportConfiguration.countDocuments()
         if (state.page * LIMIT < count) {
            state.page += 1
            await saveState(state)
            await listReports(true, ts, ack, body, client)
         } else {
            await ack()
         }
      }, 'Failed to display next 5 notification.')
   })

   // change report status
   app.action('action_change_report_status', async ({ ack, body, payload, client }) => {
      const ts = body.message.ts
      const status = payload.value
      tryAndHandleError({ ack, body, client }, async () => {
         const state = await getState(ts)
         const id = state.selectedId
         logger.info(`change report status, id: ${id}, status: ${status}`)
         if (!id) {
            throw new Error('report id is null')
         }
         await ReportConfiguration.updateOne({ _id: id }, { status })
         const report = await ReportConfiguration.findById(id)
         if (report.status === 'ENABLED') {
            registerScheduler(report)
         } else {
            unregisterScheduler(id)
         }
         await listReports(true, ts, ack, body, client)
         await client.chat.postMessage({
            channel: body.user.id,
            thread_ts: ts,
            blocks: [],
            text: `Change status to ${status} successful.`
         })
      }, `Failed to change notification status to ${status}.`)
   })

   // display remove modal
   app.action({
      block_id: 'block_list_detail_actions',
      action_id: 'action_remove_report'
   }, async ({ ack, body, payload, client }) => {
      tryAndHandleError({ ack, body, client }, async () => {
         const id = payload.value
         logger.info(`display remove report confirm modal, id: ${id}`)
         if (!id) {
            throw Error('id is null when remove report')
         }
         const report = await ReportConfiguration.findById(id)
         const blocks = loadBlocks('modal/confirmation')
         blocks[0].text.text = `Are you sure remove the notification configuration *${report.title}*?`
         await ack()
         await client.views.open({
            trigger_id: body.trigger_id,
            view: {
               type: 'modal',
               callback_id: 'view_remove_confirmation',
               private_metadata: body.message.ts,
               title: {
                  type: 'plain_text',
                  text: 'Confirmation'
               },
               blocks,
               submit: {
                  type: 'plain_text',
                  text: 'Yes'
               }
            }
         })
      }, 'Failed to display remove confirmation modal.')
   })

   // confirm remove
   app.view('view_remove_confirmation', async ({ ack, body, payload, client }) => {
      const ts = payload.private_metadata

      tryAndHandleError({ ack, body, client }, async () => {
         const state = await getState(ts)
         const id = state.selectedId
         logger.info(`remove report, id: ${id} ts: ${ts}`)
         if (!id) {
            throw Error('id is null when remove report')
         }
         await ReportConfiguration.deleteOne({ _id: id })
         unregisterScheduler(id)
         await listReports(true, ts, ack, body, client)
         await client.chat.postMessage({
            channel: body.user.id,
            thread_ts: ts,
            blocks: [],
            text: 'Removed notification successful.'
         })
      }, 'Failed to remove notification.')
   })

   // display edit modal
   app.action({
      block_id: 'block_list_detail_actions',
      action_id: 'action_edit_report'
   }, async ({ ack, body, client }) => {
      tryAndHandleError({ ack, body, client }, async () => {
         const ts = body.message.ts
         const state = await getState(ts)
         const id = state.selectedId
         if (!id) {
            throw new Error('report id is null')
         }
         await updateModal({ ack, body, client }, { isInit: true, id })
      }, 'Failed to open edit notification modal.')
   })

   // confirm edit
   app.view('view_edit_report', async ({ ack, body, payload, view, client }) => {
      const ts = payload.private_metadata
      tryAndHandleError({ ack, body, client }, async () => {
         const state = await getState(ts)
         const id = state.selectedId
         logger.info(`edit report, id: ${id}`)
         if (!id) {
            throw new Error('report id is null when editing report config')
         }
         const user = body.user.id
         const tz = await getUserTz(user)
         const oldReport = await ReportConfiguration.findById(id)
         if (!oldReport) {
            throw new Error(`cannot find report ${id} in db`)
         }
         const inputObj = transformInputValuesToObj(view.state.values)
         logger.info(inputObj)

         const report = merge(oldReport, merge(inputObj, {
            repeatConfig: {
               tz,
               date: formatDate(inputObj.repeatConfig.date)
            }
         }))
         logger.info(report)

         await report.save()
         if (report.reportType === 'perforce_checkin') {
            updateFlattenMembers(report)
         }
         registerScheduler(report)
         logger.info(`Edit successful. report id ${id}`)
         await listReports(true, ts, ack, body, client)
         await client.chat.postMessage({
            channel: body.user.id,
            thread_ts: ts,
            blocks: [],
            text: 'Edited notification successful.'
         })
      }, async (e) => {
         if (e instanceof mongoose.Error.ValidationError) {
            const ackErrors = {}
            Object.keys(e.errors).forEach(errorKey => {
               ackErrors[errorKey] = e.errors[errorKey].message
            })
            logger.warn(JSON.stringify(ackErrors))
            await ack({
               response_action: 'errors',
               errors: ackErrors
            })
         } else {
            await ack()
            await client.chat.postMessage({
               channel: body.user.id,
               blocks: [],
               text: 'Failed to edit report configuration. Please contact developers to resolve it.'
            })
            throw e
         }
      })
   })

   const actionText = {
      invoke_now: 'send the notification to selected channels now',
      invoke_to_me_now: 'send the notification to me now',
      cancel_next: 'cancel next invocation of notification'
   }

   // display confirmation modal for more actions overflow
   app.action({
      block_id: 'block_list_detail_title',
      action_id: 'action_report_more_actions'
   }, async ({ ack, body, payload, client }) => {
      const action = payload.selected_option.value
      const ts = body.message.ts

      tryAndHandleError({ ack, body, client }, async () => {
         const state = await getState(ts)
         const id = state.selectedId
         if (!id) {
            throw Error('id is null when remove report')
         }
         logger.info(`display confirmation modal, action: ${action}, id: ${id}`)
         const report = await ReportConfiguration.findById(id)
         const blocks = loadBlocks('modal/confirmation')
         blocks[0].text.text = `Are you sure ${actionText[action]} *${report.title}*?`
         await ack()
         await client.views.open({
            trigger_id: body.trigger_id,
            view: {
               type: 'modal',
               callback_id: 'view_more_action_confirmation',
               private_metadata: JSON.stringify({
                  action, ts, id
               }),
               title: {
                  type: 'plain_text',
                  text: 'Confirmation'
               },
               blocks,
               submit: {
                  type: 'plain_text',
                  text: 'Yes'
               }
            }
         })
      }, 'Failed to open confirmation modal.')
   })

   // confirm cancel next report sending
   app.view('view_more_action_confirmation', async ({ ack, body, client }) => {
      logger.info(`view_more_action_confirmation private_metadata: ${body.view.private_metadata}`)
      const privateMetadata = JSON.parse(body.view.private_metadata)
      const action = privateMetadata.action
      tryAndHandleError({ ack, body, client }, async () => {
         const id = privateMetadata.id
         if (!id) {
            throw new Error('report id is null')
         }
         const ts = privateMetadata.ts
         logger.info(`execute ${action}, id: ${id}`)
         switch (action) {
            case 'invoke_now':
               invokeNow(id)
               await ack()
               break
            case 'invoke_to_me_now':
               invokeNow(id, body.user.id)
               await ack()
               break
            case 'cancel_next':
               await cancelNextInvocation(id)
               await listReports(true, ts, ack, body, client)
               break
            default:
               throw new Error('unknow action for action_report_more_actions')
         }
      }, `Failed to ${actionText[action]}.`)
   })
}
