import { formatDateTime } from '../../common/utils.js'
import logger from '../../common/logger.js'
import { loadBlocks, getConversationsName, getUserTz } from '../../common/slack-helper.js'
import { ReportHistory } from '../model/report-history.js'
import { ReportHistoryState } from '../model/report-history-state.js'
import { ReportConfiguration, REPORT_STATUS } from '../model/report-configuration.js'
import cloneDeep from 'lodash/cloneDeep.js'
import { performance } from 'perf_hooks'

const LIMIT = 5

async function getState(ts) {
   let state = await ReportHistoryState.findOne({ ts })
   if (state == null) {
      state = ReportHistoryState({
         ts,
         page: 1,
         count: null,
         channel: null,
         filterBlockId: 1, // dynamic block id to implement clear filters,
         selectedId: null
      })
      await state.save()
   }
   return state
}

async function saveState(state) {
   if (state != null) {
      await ReportHistoryState.updateOne({ _id: state._id }, state)
   } else {
      throw new Error('State should not be null.')
   }
}

export function registerReportHistoryServiceHandler(app) {
   const listReportHistories = async (isUpdate, ts, ack, body, client) => {
      logger.info('display or update list, ts ' + ts)
      const state = await getState(ts)
      const user = body.user?.id
      if (user == null) {
         throw new Error('User is none in body, can not list the reports.')
      }
      const tz = await getUserTz(client, user)
      const t0 = performance.now()

      let offset = (state.page - 1) * LIMIT
      const filterReport = body?.state?.values[state.filterBlockId]
         ?.action_filter_by_report?.selected_option?.value
      const filterConversation = body?.state?.values[state.filterBlockId]
         ?.action_filter_by_conversation?.selected_conversation
      const filterReportUser = body?.state?.values[state.filterBlockId]
         ?.action_filter_by_report_user?.selected_user
      const filterStartDate = body?.state?.values[state.filterBlockId]
         ?.action_filter_by_start_date?.selected_date
      const filterEndDate = body?.state?.values[state.filterBlockId]
         ?.action_filter_by_end_date?.selected_date
      const filters = { creator: user }
      if (filterReport && filterReport !== 'all') {
         filters.reportConfigId = filterReport
      }
      if (filterConversation) {
         filters.conversations = filterConversation
      }
      if (filterReportUser) {
         filters.mentionUsers = filterReportUser
      }
      if (filterStartDate || filterEndDate) {
         filters.sentTime = {}
         if (filterStartDate) {
            filters.sentTime.$gte = filterStartDate
         }
         if (filterEndDate) {
            filters.sentTime.$lte = filterEndDate
         }
      }
      const count = await ReportHistory.countDocuments(filters)
      if (offset >= count) {
         state.page = 1
         offset = 0
      }
      const [reportHistories, allReportConfigurations] = await Promise.all([
         ReportHistory.find(filters).skip(offset).limit(LIMIT).sort({
            sentTime: -1
         }),
         ReportConfiguration.find({ creator: user, status: { $ne: REPORT_STATUS.CREATED } })
      ])
      state.count = count
      // list filter
      const listFilter = loadBlocks('report_history/list-filter')
      listFilter[1].block_id = state.filterBlockId.toString()
      if (allReportConfigurations.length > 0) {
         listFilter[1].elements[0].options = allReportConfigurations.map(report => ({
            text: {
               type: 'plain_text',
               text: report.title
            },
            value: report._id
         }))
      }
      // list header
      const listHeader = loadBlocks('report_history/list-header')
      listHeader[0].text.text = `There are ${count} report histories in your account after conditions applied.`
      // list item detail
      let listItemDetail = loadBlocks('report_history/list-item-detail')
      const selectedHistory = await ReportHistory.findOne({ ...filters, _id: state.selectedId })
      if (state.selectedId == null || selectedHistory == null) {
         state.selectedId = null
         listItemDetail = []
      } else {
         const [conversations, mentionUsers] = await Promise.all([
            getConversationsName(selectedHistory.conversations),
            getConversationsName(selectedHistory.mentionUsers)
         ])
         logger.info(conversations)
         logger.info(mentionUsers)
         listItemDetail[0].text.text = `*Title: ${selectedHistory.title}*`
         listItemDetail[1].fields[0].text += selectedHistory.reportType
         listItemDetail[1].fields[1].text += formatDateTime(selectedHistory.sentTime, tz)
         listItemDetail[1].fields[2].text += conversations
         listItemDetail[1].fields[3].text += mentionUsers
         listItemDetail[2].text.text += selectedHistory.content.substr(0, 1000)
      }
      // list items
      const listItemTemplate = loadBlocks('report_history/list-item-template')[0]
      const listItems = reportHistories.map(history => {
         const content = `*${history.title} - ${history.reportType}*\n` +
            `Sent at ${formatDateTime(history.sentTime, tz)}`
         const listItem = cloneDeep(listItemTemplate)
         listItem.text.text = content
         listItem.accessory.value = history._id
         if (history._id === state.selectedId) {
            listItem.accessory.style = 'primary'
         }
         return listItem
      })
      // list pagination
      let listPagination = loadBlocks('report_history/list-pagination')
      const listPaginationElements = []
      if (state.page > 1) {
         listPaginationElements.push(listPagination[0].elements[0])
      }
      if (LIMIT < count) {
         const maxPage = (count - 1) / LIMIT + 1
         const option = listPagination[0].elements[1].options[0]
         for (let i = 2; i <= maxPage; i++) {
            const newOption = cloneDeep(option)
            newOption.text.text = i.toString()
            newOption.value = i.toString()
            listPagination[0].elements[1].options.push(newOption)
         }
         listPagination[0].elements[1].initial_option = listPagination[0].elements[1].options
            .find(option => option.value === state.page.toString())
         listPaginationElements.push(listPagination[0].elements[1])
      }
      if (state.page * LIMIT < count) {
         listPaginationElements.push(listPagination[0].elements[2])
      }
      if (listPaginationElements.length > 0) {
         listPagination[0].elements = listPaginationElements
      } else {
         listPagination = []
      }
      if (ack) {
         await ack()
      }
      const blocks = listHeader.concat(listFilter).concat(listItemDetail)
         .concat(listItems).concat(listPagination)
      if (isUpdate) {
         state.channel = body.channel ? body.channel.id : state.channel
         await client.chat.update({
            channel: state.channel,
            ts,
            text: 'Manage all reports',
            blocks
         })
         logger.info(`${performance.now() - t0} cost`)
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
      action_id: 'action_history'
   }, async ({ ack, body, client }) => {
      try {
         await listReportHistories(false, body.message?.ts, ack, body, client)
      } catch (e) {
         await client.chat.postMessage({
            channel: body.user.id,
            blocks: [],
            text: 'Failed to display report sent history list. ' +
               'Please contact developers to resolve it.'
         })
         throw e
      }
   })

   app.action('action_clear_filters', async ({ ack, body, client }) => {
      const state = await getState(body.message?.ts)
      try {
         state.filterBlockId += 1
         await saveState(state)
         await listReportHistories(true, body.message?.ts, ack, body, client)
      } catch (e) {
         await client.chat.postMessage({
            channel: body.user.id,
            blocks: [],
            text: 'Failed to update report sent history list. ' +
               'Please contact developers to resolve it.'
         })
         throw e
      }
   })

   app.action('action_filter_by_report', async ({ ack, body, client }) => {
      try {
         await listReportHistories(true, body.message?.ts, ack, body, client)
      } catch (e) {
         await client.chat.postMessage({
            channel: body.user.id,
            blocks: [],
            text: 'Failed to update report sent history list. ' +
               'Please contact developers to resolve it.'
         })
         throw e
      }
   })

   app.action('action_filter_by_conversation', async ({ ack, body, client }) => {
      try {
         await listReportHistories(true, body.message?.ts, ack, body, client)
      } catch (e) {
         await client.chat.postMessage({
            channel: body.user.id,
            blocks: [],
            text: 'Failed to update report sent history list. ' +
               'Please contact developers to resolve it.'
         })
         throw e
      }
   })

   app.action('action_filter_by_report_user', async ({ ack, body, client }) => {
      try {
         await listReportHistories(true, body.message?.ts, ack, body, client)
      } catch (e) {
         await client.chat.postMessage({
            channel: body.user.id,
            blocks: [],
            text: 'Failed to update report sent history list. ' +
               'Please contact developers to resolve it.'
         })
         throw e
      }
   })

   app.action('action_filter_by_start_date', async ({ ack, body, client }) => {
      try {
         await listReportHistories(true, body.message?.ts, ack, body, client)
      } catch (e) {
         await client.chat.postMessage({
            channel: body.user.id,
            blocks: [],
            text: 'Failed to update report sent history list. ' +
               'Please contact developers to resolve it.'
         })
         throw e
      }
   })

   app.action('action_filter_by_end_date', async ({ ack, body, client }) => {
      try {
         await listReportHistories(true, body.message?.ts, ack, body, client)
      } catch (e) {
         await client.chat.postMessage({
            channel: body.user.id,
            blocks: [],
            text: 'Failed to update report sent history list. ' +
               'Please contact developers to resolve it.'
         })
         throw e
      }
   })

   // Choose report history to display detail
   app.action('action_choose_report_history_item', async ({ ack, body, payload, client }) => {
      const ts = body.message.ts
      const state = await getState(ts)

      try {
         const selectedId = payload.value
         logger.info('choose report id ' + selectedId)
         if (state.selectedId === selectedId) {
            state.selectedId = null
         } else {
            state.selectedId = selectedId
         }
         await saveState(state)
         await listReportHistories(true, ts, ack, body, client)
      } catch (e) {
         await client.chat.postMessage({
            channel: body.user.id,
            blocks: [],
            text: 'Failed to update report sent history list. ' +
               'Please contact developers to resolve it.'
         })
         throw e
      }
   })

   // previous 5 reports
   app.action({
      block_id: 'block_history_list_pagination',
      action_id: 'action_previous_page'
   }, async ({ ack, body, client }) => {
      const ts = body.message.ts
      const state = await getState(ts)

      try {
         if (state.page > 1) {
            state.page -= 1
            await saveState(state)
            await listReportHistories(true, ts, ack, body, client)
         } else {
            await ack()
         }
      } catch (e) {
         await client.chat.postMessage({
            channel: body.user.id,
            blocks: [],
            text: 'Failed to update report sent history list. ' +
               'Please contact developers to resolve it.'
         })
         throw e
      }
   })

   // jump to page
   app.action({
      block_id: 'block_history_list_pagination',
      action_id: 'action_cur_page'
   }, async ({ ack, body, payload, client }) => {
      const ts = body.message.ts
      const state = await getState(ts)

      try {
         const page = parseInt(payload.selected_option.value)
         if (page != null && !isNaN(page)) {
            state.page = page
            await saveState(state)
            await listReportHistories(true, ts, ack, body, client)
         } else {
            await ack()
         }
      } catch (e) {
         await client.chat.postMessage({
            channel: body.user.id,
            blocks: [],
            text: 'Failed to update report sent history list. ' +
               'Please contact developers to resolve it.'
         })
         throw e
      }
   })

   // next 5 reports
   app.action({
      block_id: 'block_history_list_pagination',
      action_id: 'action_next_page'
   }, async ({ ack, body, client }) => {
      const ts = body.message.ts
      const state = await getState(ts)

      try {
         const count = state.count
         if (state.page * LIMIT < count) {
            state.page += 1
            await saveState(state)
            await listReportHistories(true, ts, ack, body, client)
         } else {
            await ack()
         }
      } catch (e) {
         await client.chat.postMessage({
            channel: body.user.id,
            blocks: [],
            text: 'Failed to update report sent history list. ' +
               'Please contact developers to resolve it.'
         })
         throw e
      }
   })
}