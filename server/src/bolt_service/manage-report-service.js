import {
   formatDate, formatDateTime, convertTimeWithTz, parseDateWithTz, merge
} from '../../common/utils.js'
import logger from '../../common/logger.js'
import {
   loadBlocks, getConversationsName, getUserTz,
   transformInputValuesToObj, initReportTypeBlocks, findBlockById
} from '../../common/slack-helper.js'
import { ReportConfiguration, REPORT_STATUS } from '../model/report-configuration.js'
import { ReportConfigurationState } from '../model/report-configuration-state.js'
import {
   registerSchedule, unregisterSchedule, nextInvocation, cancelNextInvocation
} from '../scheduler-adapter.js'
import cloneDeep from 'lodash/cloneDeep.js'
import mongoose from 'mongoose'
import { performance } from 'perf_hooks'

const LIMIT = 5

const WEEK = {
   1: 'Monday',
   2: 'Tuesday ',
   3: 'Wednesday ',
   4: 'Thursday',
   5: 'Friday',
   6: 'Saturday',
   0: 'Sunday'
}

const REPORT_STATUS_DISPLAY = {
   CREATED: 'Created',
   DRAFT: ':black_square_for_stop: Draft',
   DISABLED: ':black_square_for_stop: Disabled',
   ENABLED: ':white_check_mark: Enabled'
}

function displayTimeSetting(report, tz) {
   const repeatConfig = report.repeatConfig
   const dayOfWeekStr = repeatConfig.dayOfWeek
      ? repeatConfig.dayOfWeek.map(day => WEEK[day]).join(', ')
      : 'Empty'
   const convertedTime = convertTimeWithTz(repeatConfig.time, repeatConfig.tz, tz)
   switch (repeatConfig.repeatType) {
      case 'not_repeat': {
         const date = parseDateWithTz(`${repeatConfig.date} ${repeatConfig.time}`, repeatConfig.tz)
         return `Not Repeat - ${formatDateTime(date, tz)}`
      }
      case 'hourly': return `Hourly - ${repeatConfig.minsOfHour} mins of every hour`
      case 'daily': return `Daily - ${convertedTime} of every day`
      case 'weekly': return `Weekly - ${dayOfWeekStr} - ${convertedTime}`
      case 'monthly': return `Monthly - ${repeatConfig.dayOfMonth}th of every month - ${convertedTime}`
      case 'cron_expression': return `Cron Expression - ${repeatConfig.cronExpression}`
      default: return 'Unknown'
   }
}

function setTimeSettingInitialValue(report, blocks, tz) {
   const repeatConfig = report.repeatConfig
   const convertedTime = convertTimeWithTz(repeatConfig.time, repeatConfig.tz, tz)
   switch (repeatConfig.repeatType) {
      case 'not_repeat':
         const date = parseDateWithTz(`${repeatConfig.date} ${repeatConfig.time}`, repeatConfig.tz)
         const dateStr = formatDateTime(date, tz)
         if (dateStr != null && dateStr.split(' ').length === 2) {
            findBlockById(blocks, 'repeatConfig.date')
               .element.initial_date = dateStr.split(' ')[0]
            findBlockById(blocks, 'repeatConfig.time')
               .element.initial_time = dateStr.split(' ')[1]
         }
         break
      case 'hourly':
         if (repeatConfig.minsOfHour != null) {
            findBlockById(blocks, 'repeatConfig.minsOfHour')
               .element.initial_value = repeatConfig.minsOfHour.toString()
         }
         break
      case 'daily':
         if (convertedTime != null) {
            findBlockById(blocks, 'repeatConfig.time')
               .element.initial_time = convertedTime
         }
         break
      case 'weekly':
         const dayOfWeekOptions = findBlockById(blocks, 'repeatConfig.dayOfWeek')
            .element.options
            .filter(option => repeatConfig.dayOfWeek?.includes(parseInt(option.value)))
         if (dayOfWeekOptions.length > 0) {
            findBlockById(blocks, 'repeatConfig.dayOfWeek')
               .element.initial_options = dayOfWeekOptions
         }
         if (convertedTime != null) {
            findBlockById(blocks, 'repeatConfig.time')
               .element.initial_time = convertedTime
         }
         break
      case 'monthly':
         if (repeatConfig.dayOfMonth != null) {
            findBlockById(blocks, 'repeatConfig.dayOfMonth')
               .element.initial_value = repeatConfig.dayOfMonth.toString()
         }
         if (convertedTime != null) {
            findBlockById(blocks, 'repeatConfig.time')
               .element.initial_time = convertedTime
         }
         break
      case 'cron_expression':
         if (repeatConfig.cronExpression != null) {
            findBlockById(blocks, 'repeatConfig.cronExpression')
               .element.initial_value = repeatConfig.cronExpression
         }
         break
   }
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
      if (user !== process.env.ADMIN_USER_ID) {
         filter.creator = user
      }
      const count = await ReportConfiguration.countDocuments(filter)
      if (offset >= count) {
         state.page = 1
         offset = 0
      }
      state.count = count
      const reportConfigurations = await ReportConfiguration.find(filter).skip(offset).limit(LIMIT)

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
         // report type
         listItemDetail[2].fields[0].text += report.reportType
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
         // cancel next sending button
         listItemDetail[3].elements[3].value = report._id
      }

      // list items
      const listItemTemplate = loadBlocks('report/list-item-template')[0]
      const listItems = reportConfigurations.map(report => {
         const icon = report.status === 'ENABLED' ? ':white_check_mark:' : ':black_square_for_stop:'
         const content = `*${report.title} - ${report.reportType}* ${icon}\n${displayTimeSetting(report, tz)}`
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
      try {
         await listReports(false, body.message?.ts, ack, body, client)
      } catch (e) {
         await ack()
         await client.chat.postMessage({
            channel: body.user.id,
            blocks: [],
            text: 'Failed to open report configs list. ' +
               'Please contact developers to resolve it.'
         })
         throw e
      }
   })

   // Choose report to display detail
   app.action('action_choose_report_item', async ({ ack, body, payload, say, client }) => {
      const ts = body.message.ts
      const state = await getState(ts)

      try {
         const selected = payload.value
         logger.info('choose report id ' + selected)
         if (state.selectedId === selected) {
            state.selectedId = null
         } else {
            state.selectedId = selected
         }
         await saveState(state)
         await listReports(true, ts, ack, body, client)
      } catch (e) {
         await ack()
         await client.chat.postMessage({
            channel: body.user.id,
            blocks: [],
            text: 'Failed to update report configs list. ' +
               'Please contact developers to resolve it.'
         })
         throw e
      }
   })

   // previous 5 reports
   app.action({
      block_id: 'block_list_pagination',
      action_id: 'action_previous_page'
   }, async ({ ack, body, client }) => {
      const ts = body.message.ts
      const state = await getState(ts)

      try {
         if (state.page > 1) {
            state.page -= 1
            await saveState(state)
            await listReports(true, ts, ack, body, client)
         } else {
            await ack()
         }
      } catch (e) {
         await ack()
         await client.chat.postMessage({
            channel: body.user.id,
            blocks: [],
            text: 'Failed to update report configs list. ' +
               'Please contact developers to resolve it.'
         })
         throw e
      }
   })

   // next 5 reports
   app.action({
      block_id: 'block_list_pagination',
      action_id: 'action_next_page'
   }, async ({ ack, body, client }) => {
      const ts = body.message.ts
      const state = await getState(ts)

      try {
         const count = await ReportConfiguration.countDocuments()
         if (state.page * LIMIT < count) {
            state.page += 1
            await saveState(state)
            await listReports(true, ts, ack, body, client)
         } else {
            await ack()
         }
      } catch (e) {
         await ack()
         await client.chat.postMessage({
            channel: body.user.id,
            blocks: [],
            text: 'Failed to update report configs list. ' +
               'Please contact developers to resolve it.'
         })
         throw e
      }
   })

   // change report status
   app.action('action_change_report_status', async ({ ack, body, payload, client }) => {
      const ts = body.message.ts
      const state = await getState(ts)

      try {
         const id = state.selectedId
         const status = payload.value
         logger.info(`change report status, id: ${id}, status: ${status}`)
         if (!id) {
            throw new Error('report id is null')
         }
         await ReportConfiguration.updateOne({ _id: id }, { status })
         const report = await ReportConfiguration.findById(id)
         if (report.status === 'ENABLED') {
            registerSchedule(report)
         } else {
            unregisterSchedule(id)
         }
         await listReports(true, ts, ack, body, client)
      } catch (e) {
         await ack()
         await client.chat.postMessage({
            channel: body.user.id,
            blocks: [],
            text: 'Failed to update report configs list. ' +
               'Please contact developers to resolve it.'
         })
         throw e
      }
   })

   // display remove modal
   app.action({
      block_id: 'block_list_detail_actions',
      action_id: 'action_remove_report'
   }, async ({ ack, body, payload, client }) => {
      try {
         const id = payload.value
         logger.info(`display remove report confirm modal, id: ${id}`)
         if (!id) {
            throw Error('id is null when remove report')
         }
         const report = await ReportConfiguration.findById(id)
         const blocks = loadBlocks('modal/delete')
         blocks[0].text.text += `*${report.title}*?`
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
      } catch (e) {
         await ack()
         await client.chat.postMessage({
            channel: body.user.id,
            blocks: [],
            text: 'Failed to open remove confirmation modal. ' +
               'Please contact developers to resolve it.'
         })
         throw e
      }
   })

   // confirm remove
   app.view('view_remove_confirmation', async ({ ack, body, payload, client }) => {
      const ts = payload.private_metadata
      const state = await getState(ts)
      try {
         const id = state.selectedId
         logger.info(`remove report, id: ${id} ts: ${ts}`)
         if (!id) {
            throw Error('id is null when remove report')
         }
         await ReportConfiguration.deleteOne({ _id: id })
         unregisterSchedule(id)
         // await client.chat.postMessage({
         //     channel: body.user.id,
         //     blocks: [],
         //     text: 'Removed successful.'
         // })
         await listReports(true, ts, ack, body, client)
      } catch (e) {
         await ack()
         await client.chat.postMessage({
            channel: body.user.id,
            blocks: [],
            text: 'Failed to delete the report configuration, ' +
               'please contact developers to resolve it.'
         })
         throw e
      }
   })

   // display edit modal
   app.action({
      block_id: 'block_list_detail_actions',
      action_id: 'action_edit_report'
   }, async ({ ack, body, payload, client }) => {
      try {
         const id = payload.value
         if (!id) {
            throw new Error('report id is null when edit report')
         }
         logger.info(`edit report, id: ${id}`)
         const user = body.user?.id
         if (user == null) {
            throw new Error('User is none in body, can not list the reports.')
         }
         const tz = await getUserTz(user)
         const report = await ReportConfiguration.findById(id)
         logger.info('open edit report config modal')
         logger.info(report)

         const reportModalBasic = loadBlocks('modal/report-basic')
         const reportModalReportType = loadBlocks(`report_type/${report.reportType}`)
         const reportModalAdvanced = loadBlocks('modal/report-advanced')
         const reportModalRecurrence = loadBlocks('modal/report-recurrence')
         const reportModalRepeatType = loadBlocks(`repeat_type/${report.repeatConfig.repeatType}`)
         const reportModalTime = loadBlocks('modal/report-time')
         const blocks = reportModalBasic.concat(reportModalReportType).concat(reportModalAdvanced)
            .concat(reportModalRecurrence).concat(reportModalRepeatType).concat(reportModalTime)
         findBlockById(blocks, 'title').element.initial_value = report.title
         if (report.conversations.length > 0) {
            findBlockById(blocks, 'conversations').element.initial_conversations =
               report.conversations
         }
         if (report.mentionUsers.length > 0) {
            findBlockById(blocks, 'mentionUsers').element.initial_users = report.mentionUsers
         }
         if (report.repeatConfig.startDate != null) {
            findBlockById(blocks, 'repeatConfig.startDate').element.initial_date =
               formatDate(report.repeatConfig.startDate)
         }
         if (report.repeatConfig.endDate != null) {
            findBlockById(blocks, 'repeatConfig.endDate').element.initial_date =
               formatDate(report.repeatConfig.endDate)
         }

         const reportTypeBlock = findBlockById(blocks, 'reportType')
         reportTypeBlock.element.action_id = 'action_report_type_edit'
         const reportTypeOption = reportTypeBlock.element.options
            .find(option => option.value === report.reportType)
         if (reportTypeOption != null) {
            reportTypeBlock.element.initial_option = reportTypeOption
         }

         const repeatTypeBlock = findBlockById(blocks, 'repeatConfig.repeatType')
         repeatTypeBlock.element.action_id = 'action_repeat_type_edit'
         const repeatTypeOption = repeatTypeBlock.element.options
            .find(option => option.value === report.repeatConfig.repeatType)
         if (repeatTypeOption != null) {
            repeatTypeBlock.element.initial_option = repeatTypeOption
         }
         initReportTypeBlocks(report, blocks)
         setTimeSettingInitialValue(report, blocks, tz)
         if (ack) {
            await ack()
         }
         await client.views.open({
            trigger_id: body.trigger_id,
            view: {
               type: 'modal',
               callback_id: 'view_edit_report',
               private_metadata: body.message.ts,
               title: {
                  type: 'plain_text',
                  text: 'Edit your report'
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
         await ack()
         await client.chat.postMessage({
            channel: body.user.id,
            blocks: [],
            text: 'Failed to open edit report configuration modal. ' +
               'Please contact developers to resolve it.'
         })
         throw e
      }
   })

   // confirm edit
   app.view('view_edit_report', async ({ ack, body, payload, view, client }) => {
      const ts = payload.private_metadata
      const state = await getState(ts)

      try {
         const id = state.selectedId
         logger.info(`edit report, id: ${id}`)
         if (!id) {
            throw new Error('report id is null when editing report config')
         }
         const user = body.user.id
         const tz = await getUserTz(user)
         const oldReport = await ReportConfiguration.findById(id)
         if (!oldReport) {
            return
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
         registerSchedule(report)
         logger.info(`Edit successful. report id ${id}`)
         await listReports(true, ts, ack, body, client)
      } catch (e) {
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
      }
   })

   // confirm cancel next report sending
   app.action('action_cancel_next_report', async ({ ack, body, payload, client }) => {
      const ts = body.message.ts
      const state = await getState(ts)
      try {
         const id = state.selectedId
         logger.info(`cancel next report sending, id: ${id} ts: ${ts}`)
         if (!id) {
            throw new Error('report id is null')
         }
         await cancelNextInvocation(id)
         await listReports(true, ts, ack, body, client)
      } catch (e) {
         await ack()
         await client.chat.postMessage({
            channel: body.user.id,
            blocks: [],
            text: 'Failed to cancel next sending report.' +
               'Please contact developers to resolve it.'
         })
         throw e
      }
   })

   const updateModal = async ({ ack, payload, body, client }) => {
      const ts = body.view.private_metadata
      const state = await getState(ts)
      const id = state.selectedId
      logger.info('change repeat type id ' + id)
      if (!id) {
         throw new Error('report id is null')
      }
      const reportType = body.view.state.values?.reportType
         ?.action_report_type_edit?.selected_option?.value
      const repeatType = body.view.state.values['repeatConfig.repeatType']
         ?.action_repeat_type_edit?.selected_option?.value
      logger.info(`select report type ${reportType} of report scheduler`)
      logger.info(`select repeat type ${repeatType} of report scheduler`)

      const reportModalBasic = loadBlocks('modal/report-basic')
      const reportModalReportType = loadBlocks(`report_type/${reportType}`)
      const reportModalAdvanced = loadBlocks('modal/report-advanced')
      const reportModalRecurrence = loadBlocks('modal/report-recurrence')
      const reportModalTime = loadBlocks('modal/report-time')
      const reportModalRepeatType = loadBlocks(`repeat_type/${repeatType}`)
      const blocks = reportModalBasic.concat(reportModalReportType).concat(reportModalAdvanced)
         .concat(reportModalRecurrence).concat(reportModalRepeatType).concat(reportModalTime)
      const reportTypeBlock = findBlockById(blocks, 'reportType')
      reportTypeBlock.element.action_id = 'action_report_type_edit'
      const repeatTypeBlock = findBlockById(blocks, 'repeatConfig.repeatType')
      repeatTypeBlock.element.action_id = 'action_repeat_type_edit'
      await ack()
      await client.views.update({
         view_id: body.view.id,
         hash: body.view.hash,
         view: {
            type: 'modal',
            callback_id: 'view_edit_report',
            private_metadata: ts,
            title: {
               type: 'plain_text',
               text: 'Edit your report'
            },
            blocks,
            submit: {
               type: 'plain_text',
               text: 'Submit'
            }
         }
      })
   }

   // change report type
   app.action({
      block_id: 'reportType',
      action_id: 'action_report_type_edit'
   }, async (event) => {
      try {
         await updateModal(event)
      } catch (e) {
         await event.ack()
         await event.client.chat.postMessage({
            channel: event.body.user.id,
            blocks: [],
            text: 'Failed to cancel next sending report.' +
               'Please contact developers to resolve it.'
         })
         throw e
      }
   })

   // change repet type
   app.action({
      block_id: 'repeatConfig.repeatType',
      action_id: 'action_repeat_type_edit'
   }, async (event) => {
      try {
         await updateModal(event)
      } catch (e) {
         await event.ack()
         await event.client.chat.postMessage({
            channel: event.body.user.id,
            blocks: [],
            text: 'Failed to cancel next sending report.' +
               'Please contact developers to resolve it.'
         })
         throw e
      }
   })
}