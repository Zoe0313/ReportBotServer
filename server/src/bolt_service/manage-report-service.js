import { loadBlocks, formatDate, formatDateTime, getConversationsName } from '../utils.js'
import { ReportConfiguration, REPORT_STATUS } from '../model/report-configuration.js'
import { ReportConfigurationState } from '../model/report-configuration-state.js'
import { registerSchedule, unregisterSchedule, nextInvocation, cancelNextInvocation } from '../scheduler-adapter.js'
import _ from 'lodash'
import { performance } from 'perf_hooks'
import logger from '../logger.js'

const WEEK = {
   1: 'Monday',
   2: 'Tuesday ',
   3: 'Wednesday ',
   4: 'Thursday',
   5: 'Friday',
   6: 'Saturday',
   0: 'Sunday',
}

const REPORT_STATUS_DISPLAY = {
   CREATED: 'Created',
   DRAFT: ':x: Draft',
   DISABLED: ':x: Disabled',
   ENABLED: ':white_check_mark: Enabled',
}

function displayTimeSetting(report) {
   const repeatConfig = report.repeatConfig
   const dayOfWeekStr = repeatConfig.dayOfWeek ? repeatConfig.dayOfWeek.map(day => WEEK[day]).join(', ') : 'Empty'
   switch (repeatConfig.repeatType) {
      case 'not_repeat': return `Not Repeat - ${formatDate(repeatConfig.date)} ${repeatConfig.time}`
      case 'hourly': return `Hourly - ${repeatConfig.minsOfHour} mins of every hour`
      case 'daily': return `Daily - ${repeatConfig.time} of every day`
      case 'weekly': return `Weekly - ${dayOfWeekStr} - ${repeatConfig.time}`
      case 'monthly': return `Monthly - ${repeatConfig.dayOfMonth}th of every month - ${repeatConfig.time}`
      case 'cron_expression': return `Cron Expression - ${repeatConfig.cronExpression}`
      default: return 'Unknown'
   }
}

function setReportDetailInitialValue(report, findBlockById) {
   switch (report.reportType) {
      case 'bugzilla':
         findBlockById('block_report_link').element.initial_value = report.reportLink
         break
      case 'perforce':
         findBlockById('block_report_link').element.initial_value = report.reportLink
         break
      case 'svs':
         findBlockById('block_report_link').element.initial_value = report.reportLink
         break
      case 'fastsvs':
         findBlockById('block_report_link').element.initial_value = report.reportLink
         break
      case 'text':
         findBlockById('block_report_link').element.initial_value = report.reportLink
         break
      case 'customized':
         findBlockById('block_report_link').element.initial_value = report.reportLink
         break
   }
}

function setTimeSettingInitialValue(report, findBlockById) {
   const repeatConfig = report.repeatConfig
   switch (repeatConfig.repeatType) {
      case 'not_repeat':
         findBlockById('block_date').element.initial_date = formatDate(repeatConfig.date)
         findBlockById('block_time').element.initial_time = repeatConfig.time
         break
      case 'hourly':
         findBlockById('block_mins_of_hour').element.initial_value = repeatConfig.minsOfHour.toString()
         break
      case 'daily':
         findBlockById('block_time').element.initial_time = repeatConfig.time
         break
      case 'weekly':
         const dayOfWeekOptions = findBlockById('block_day_of_week')
            .element.options.filter(option => repeatConfig.dayOfWeek.includes(parseInt(option.value)))
         findBlockById('block_day_of_week').element.initial_options = dayOfWeekOptions
         findBlockById('block_time').element.initial_time = repeatConfig.time
         break
      case 'monthly':
         findBlockById('block_day_of_month').element.initial_value = repeatConfig.dayOfMonth.toString()
         findBlockById('block_time').element.initial_time = repeatConfig.time
         break
      case 'cron_expression':
         findBlockById('block_cron_expression').element.initial_value = repeatConfig.cronExpression
         break
   }
}

const getState = async (ts) => {
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

const saveState = async (state) => {
   if (state != null) {
      await ReportConfigurationState.updateOne({ _id: state._id }, state)
   }
}

const limit = 5

export function manageReportService(app) {
   const listReports = async (isUpdate, ts, ack, body, client) => {
      logger.info('display or update list, ts ' + ts)
      const state = await getState(ts)
      const user = body.user?.id
      try {
         let offset = (state.page - 1) * limit
         const filter = {
            status: { $ne: REPORT_STATUS.CREATED }
         }
         if (user != null && user != process.env.ADMIN_SLACK_USER) {
            filter.creator = user
         }
         const count = await ReportConfiguration.countDocuments(filter)
         if (offset >= count) {
            state.page = 1
            offset = 0
         }
         state.count = count
         const reportConfigurations = await ReportConfiguration.find(filter).skip(offset).limit(limit)
         // list header
         const listHeader = loadBlocks('report/list-header')
         listHeader[1].text.text = `There are *${count} reports* in your account.`
         // list item detail
         let listItemDetail = loadBlocks('report/list-item-detail')
         const report = await ReportConfiguration.findById(state.selectedId)
         if (state.selectedId == null || report == null) {
            state.selectedId == null
            listItemDetail = []
         } else {
            const [conversations, reportUsers] = await Promise.all([
               getConversationsName(client, report.conversations),
               getConversationsName(client, report.reportUsers)
            ])
            logger.info(conversations)
            logger.info(reportUsers)
            const nextReportSendingTime = formatDateTime(new Date(await nextInvocation(report._id)))
            logger.info(nextReportSendingTime)
            listItemDetail[0].text.text = `*Title: ${report.title}*`
            listItemDetail[1].fields[0].text += report.reportType
            listItemDetail[1].fields[1].text += REPORT_STATUS_DISPLAY[report.status]
            listItemDetail[1].fields[2].text += conversations
            listItemDetail[1].fields[3].text += reportUsers
            listItemDetail[1].fields[4].text += formatDate(report.startDate)
            listItemDetail[1].fields[5].text += formatDate(report.endDate)
            listItemDetail[1].fields[6].text += displayTimeSetting(report)
            listItemDetail[1].fields[7].text += nextReportSendingTime

            listItemDetail[2].elements[0].value = report._id
            listItemDetail[2].elements[1].value = report._id
            listItemDetail[2].elements[2].value = report._id
         }
         // list items
         const listItemTemplate = loadBlocks('report/list-item-template')[0]
         const listItems = reportConfigurations.map(report => {
            const icon = report.status === 'ENABLED' ? ':white_check_mark:' : ':x:'
            const content = `*${report.title} - ${report.reportType}* ${icon}\n${displayTimeSetting(report)}`
            const listItem = _.cloneDeep(listItemTemplate)
            listItem.text.text = content
            listItem.accessory.value = report._id
            if (report._id == state.selectedId) {
               listItem.accessory.style = 'primary'
            }
            return listItem
         })
         // list pagination
         let listPagination = loadBlocks('report/list-pagination')
         const listPaginationElements = []
         if (state.page > 1) {
            listPaginationElements.push(listPagination[0].elements[0])
         }
         if (state.page * limit < count) {
            listPaginationElements.push(listPagination[0].elements[1])
         }
         if (listPaginationElements.length > 0) {
            listPagination[0].elements = listPaginationElements
         } else {
            listPagination = []
         }
         const blocks = listHeader.concat(listItemDetail).concat(listItems).concat(listPagination)
         if (ack) await ack()
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
      } catch (e) {
         logger.error(e)
         await client.chat.postMessage({
            channel: user,
            text: e.message,
            blocks: []
         })
      }
   }

   // List all reports
   app.action({
      'block_id': 'block_welcome',
      'action_id': 'action_list'
   }, async ({ ack, body, client }) => {
      await listReports(false, body.message?.ts, ack, body, client)
   })

   // Choose report to display detail
   app.action('action_choose_report_item', async ({ ack, body, payload, say, client }) => {
      const ts = body.message.ts
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
   })

   // previous 5 reports
   app.action({
      'block_id': 'block_list_pagination',
      'action_id': 'action_previous_page'
   }, async ({ ack, body, client }) => {
      const ts = body.message.ts
      const state = await getState(ts)
      if (state.page > 1) {
         state.page -= 1
         await saveState(state)
         await listReports(true, ts, ack, body, client)
      } else {
         await ack()
      }
   })

   // next 5 reports
   app.action({
      'block_id': 'block_list_pagination',
      'action_id': 'action_next_page'
   }, async ({ ack, body, client }) => {
      const ts = body.message.ts
      const state = await getState(ts)
      const count = await ReportConfiguration.countDocuments()
      if (state.page * limit < count) {
         state.page += 1
         await saveState(state)
         await listReports(true, ts, ack, body, client)
      } else {
         await ack()
      }
   })

   // display remove modal
   app.action({
      'block_id': 'block_list_detail_actions',
      'action_id': 'action_remove_report'
   }, async ({ ack, body, payload, client }) => {
      const id = payload.value
      logger.info(`display remove report confirm modal, id: ${id}`)
      if (!id) {
         return
      }
      try {
         const report = await ReportConfiguration.findById(id)
         const blocks = loadBlocks('modal/delete')
         blocks[0].text.text += `*${report.title}*`
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
         logger.error(e)
      }
   })

   // confirm remove
   app.view('view_remove_confirmation', async ({ ack, body, payload, client }) => {
      const ts = payload.private_metadata
      const state = await getState(ts)
      const id = state.selectedId
      logger.info(`remove report, id: ${id} ts: ${ts}`)
      if (!id) {
         return
      }
      try {
         await ReportConfiguration.deleteOne({ _id: id })
         unregisterSchedule(id)
         // await client.chat.postMessage({
         //     channel: body.user.id,
         //     blocks: [],
         //     text: 'Removed successful.'
         // })
         await listReports(true, ts, ack, body, client)
      } catch (e) {
         logger.error(e)
         await client.chat.postMessage({
            channel: body.user.id,
            blocks: [],
            text: e.message
         })
      }
   })

   // display edit modal
   app.action({
      'block_id': 'block_list_detail_actions',
      'action_id': 'action_edit_report'
   }, async ({ ack, body, payload, client }) => {
      await ack()
      const id = payload.value
      logger.info(`edit report, id: ${id}`)
      if (!id) {
         return
      }
      try {
         const report = await ReportConfiguration.findById(id)
         logger.info('open edit report config modal')
         logger.info(report)

         const reportModalBasic = loadBlocks('modal/report-basic')
         const reportModalReportType = loadBlocks(`report_type/${report.reportType}`)
         const reportModalTime = loadBlocks('modal/report-time')
         const reportModalRepeatType = loadBlocks(`repeat_type/${report.repeatConfig.repeatType}`)
         const blocks = reportModalBasic.concat(reportModalReportType)
            .concat(reportModalTime).concat(reportModalRepeatType)
         const findBlockById = (blockId) => blocks.find(block => block.block_id === blockId)
         findBlockById('block_title').element.initial_value = report.title
         findBlockById('block_conversation').element.initial_conversations = report.conversations
         findBlockById('block_report_users').element.initial_users = report.reportUsers
         findBlockById('block_start_date').element.initial_date = formatDate(report.startDate)
         findBlockById('block_end_date').element.initial_date = formatDate(report.endDate)

         const reportTypeBlock = findBlockById('block_report_type')
         reportTypeBlock.element.action_id = 'action_report_type_edit'
         const reportTypeOption = reportTypeBlock.element.options
            .find(option => option.value === report.reportType)
         reportTypeBlock.element.initial_option = reportTypeOption

         const repeatTypeBlock = findBlockById('block_repeat_type')
         repeatTypeBlock.element.action_id = 'action_repeat_type_edit'
         const repeatTypeOption = repeatTypeBlock.element.options
            .find(option => option.value === report.repeatConfig.repeatType)
         repeatTypeBlock.element.initial_option = repeatTypeOption
         setReportDetailInitialValue(report, findBlockById)
         setTimeSettingInitialValue(report, findBlockById)
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
            submit_disabled: true,
         })
      } catch (e) {
         logger.error(e)
      }
   })

   // confirm edit
   app.view('view_edit_report', async ({ ack, body, payload, view, client }) => {
      const ts = payload.private_metadata
      const state = await getState(ts)
      const id = state.selectedId
      logger.info(`edit report, id: ${id}`)
      if (!id) {
         return
      }
      const user = body['user']['id']
      const inputObj = {}
      const inputValues = Object.values(view['state']['values'])
      inputValues.forEach(actions => {
         Object.keys(actions).forEach(actionKey => {
            inputObj[actionKey] = actions[actionKey]
         })
      })
      logger.info(inputObj)
      const parseIntNullable = (num) => num ? parseInt(num) : null
      const oldReport = await ReportConfiguration.findById(id)
      if (!oldReport) {
         return
      }
      const report = {
         _id: id,
         title: inputObj.action_title?.value,
         reportType: inputObj.action_report_type_edit?.selected_option?.value,
         reportLink: inputObj.action_report_link?.value,
         conversations: inputObj.action_conversation?.selected_conversations,
         reportUsers: inputObj.action_report_users?.selected_users,
         startDate: inputObj.action_start_date?.selected_date,
         endDate: inputObj.action_end_date?.selected_date,
         repeatConfig: {
            repeatType: inputObj.action_repeat_type_edit?.selected_option?.value,
            cronExpression: inputObj.action_cron_expression?.value,
            date: inputObj.action_date?.selected_date,
            time: inputObj.action_time?.selected_time,
            dayOfMonth: parseIntNullable(inputObj.action_day_of_month?.value),
            dayOfWeek: inputObj.action_day_of_week?.selected_options
               ?.map(option => parseIntNullable(option.value)),
            minsOfHour: parseIntNullable(inputObj.action_mins_of_hour?.value),
         }
      }
      logger.info(report)

      try {
         await ReportConfiguration.updateOne({ _id: id }, report)
         const newReport = await ReportConfiguration.findById(id)
         registerSchedule(newReport)
         logger.info(`Edit successful. report id ${id}`)
         // await client.chat.postMessage({
         //     channel: body.user.id,
         //     blocks: [],
         //     text: 'Edited successful.'
         // })
         await listReports(true, ts, ack, body, client)
      } catch (e) {
         logger.error(e)
         await client.chat.postMessage({
            channel: user,
            text: e.message
         })
      }
   })

   // confirm cancel next report sending
   app.action('action_cancel_next_report', async ({ ack, body, payload, client }) => {
      const ts = body.message.ts
      const state = await getState(ts)
      const id = state.selectedId
      logger.info(`cancel next report sending, id: ${id} ts: ${ts}`)
      if (!id) {
         return
      }
      try {
         await cancelNextInvocation(id)
         await listReports(true, ts, ack, body, client)
      } catch (e) {
         logger.error(e)
         await client.chat.postMessage({
            channel: body.user.id,
            blocks: [],
            text: e.message
         })
      }
   })

   const updateModal = async ({ ack, payload, body, client }) => {
      const ts = body.view.private_metadata
      const state = await getState(ts)
      const id = state.selectedId
      logger.info('change repeat type id ' + id)
      if (!id) {
         return
      }
      try {
         const reportType = body.view.state.values
            ?.block_report_type?.action_report_type_edit?.selected_option?.value
         const repeatType = body.view.state.values
            ?.block_repeat_type?.action_repeat_type_edit?.selected_option?.value
         logger.info(`select report type ${reportType} of report scheduler`)
         logger.info(`select repeat type ${repeatType} of report scheduler`)

         const reportModalBasic = loadBlocks('modal/report-basic')
         const reportModalReportType = loadBlocks(`report_type/${reportType}`)
         const reportModalTime = loadBlocks('modal/report-time')
         const reportModalRepeatType = loadBlocks(`repeat_type/${repeatType}`)
         const blocks = reportModalBasic.concat(reportModalReportType)
            .concat(reportModalTime).concat(reportModalRepeatType)
         const findBlockById = (blockId) => blocks.find(block => block.block_id === blockId)
         const reportTypeBlock = findBlockById('block_report_type')
         reportTypeBlock.element.action_id = 'action_report_type_edit'
         const repeatTypeBlock = findBlockById('block_repeat_type')
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
      } catch (e) {
         logger.error(e)
      }
   }

   // change report type
   app.action({
      'block_id': 'block_report_type',
      'action_id': 'action_report_type_edit'
   }, async (event) => {
      await updateModal(event)
   })

   // change repet type
   app.action({
      'block_id': 'block_repeat_type',
      'action_id': 'action_repeat_type_edit'
   }, async (event) => {
      await updateModal(event)
   })

   // change report status
   app.action('action_change_report_status', async ({ ack, body, payload, client }) => {
      const ts = body.message.ts
      const state = await getState(ts)
      const id = state.selectedId
      const status = payload.selected_option.value
      logger.info(`change report status, id: ${id}, status: ${status}`)
      if (!id) {
         return
      }
      await ReportConfiguration.updateOne({ _id: id }, { status })
      const report = await ReportConfiguration.findById(id)
      if (report.status === 'ENABLED') {
         registerSchedule(report)
      } else {
         unregisterSchedule(id)
      }
      await listReports(true, ts, ack, body, client)
   })
}