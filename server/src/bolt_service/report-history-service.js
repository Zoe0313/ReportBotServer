import { formatDateTime } from '../../common/utils.js'
import logger from '../../common/logger.js'
import {
   loadBlocks, getConversationsName, getUserTz, findBlockById, tryAndHandleError
} from '../../common/slack-helper.js'
import { ReportHistory, REPORT_HISTORY_STATUS } from '../model/report-history.js'
import { ReportHistoryState } from '../model/report-history-state.js'
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
      const tz = await getUserTz(user)
      const t0 = performance.now()

      let offset = (state.page - 1) * LIMIT
      const filterReport = body?.state?.values['block_history_filter_basic' + state.filterBlockId]
         ?.action_filter_by_report?.selected_option?.value
      const filterConversation = body?.state?.values['block_history_filter_basic' +
         state.filterBlockId]?.action_filter_by_conversation?.selected_conversation
      const filterStartDate = body?.state?.values['block_history_filter_date' + state.filterBlockId]
         ?.action_filter_by_start_date?.selected_date
      const filterEndDate = body?.state?.values['block_history_filter_date' + state.filterBlockId]
         ?.action_filter_by_end_date?.selected_date
      const filters = { creator: user }
      if (filterReport && filterReport !== 'all') {
         filters.title = filterReport
      }
      if (filterConversation) {
         filters.conversations = filterConversation
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
      logger.info(JSON.stringify(filters))
      const count = await ReportHistory.countDocuments(filters)
      if (offset >= count) {
         state.page = 1
         offset = 0
      }
      const [reportHistories, allReportHistories] = await Promise.all([
         ReportHistory.find(filters).skip(offset).limit(LIMIT).sort({
            sentTime: -1
         }),
         ReportHistory.find({ creator: user })
      ])
      state.count = count
      // list filter
      const listFilter = loadBlocks('report_history/list-filter')
      listFilter[1].block_id = 'block_history_filter_basic' + state.filterBlockId.toString()
      listFilter[2].block_id = 'block_history_filter_date' + state.filterBlockId.toString()
      if (allReportHistories.length > 0) {
         // dedup title of report history
         listFilter[1].elements[0].options = [...new Set(allReportHistories.map(reportHistory => {
            return reportHistory.title
         }))].map(title => ({
            text: {
               type: 'plain_text',
               text: title
            },
            value: title
         }))
      }
      // list header
      const listHeader = loadBlocks('report_history/list-header')
      listHeader[0].text.text = `There are ${count} notification histories after conditions applied.`
      // list item detail
      let listItemDetail = loadBlocks('report_history/list-item-detail')
      const selectedHistory = reportHistories.find((reportHistory) => {
         return reportHistory._id.toString() === state.selectedId
      })
      logger.debug(selectedHistory)
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
         const detailsBlock = findBlockById(listItemDetail, 'block_report_history_details')
         const contentBlock = findBlockById(listItemDetail, 'block_report_history_content')
         detailsBlock.fields[0].text += selectedHistory.title
         detailsBlock.fields[1].text += selectedHistory.status
         detailsBlock.fields[2].text += selectedHistory.reportType
         detailsBlock.fields[3].text += formatDateTime(selectedHistory.sentTime, tz)
         detailsBlock.fields[4].text += conversations
         detailsBlock.fields[5].text += mentionUsers
         contentBlock.text.text += selectedHistory.content.substr(0, 2000)
         if (selectedHistory.content.length > 2000) {
            contentBlock.text.text += `...(not display full message due to length limitation)`
         }
         // if the message has been deleted in the slack channels, do not display the delete button
         if (selectedHistory.tsMap == null || selectedHistory.tsMap.size === 0) {
            const deleteButtonBlockIndex = listItemDetail.findIndex(block => {
               return block.block_id === 'block_report_history_actions'
            })
            listItemDetail.splice(deleteButtonBlockIndex, 1)
         }
      }
      // list items
      const listItemTemplate = loadBlocks('report_history/list-item-template')[0]
      const listItems = reportHistories.map(history => {
         const content = `*${history.title} - ${history.reportType}* ` +
            `was sent at ${formatDateTime(history.sentTime, tz)}`
         const listItem = cloneDeep(listItemTemplate)
         listItem.text.text = content
         listItem.accessory.value = history._id
         if (history._id.toString() === state.selectedId) {
            listItem.accessory.style = 'primary'
            listItem.accessory.text.text = 'Close'
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
      const blocks = listHeader.concat(listFilter).concat(listItems)
         .concat(listItemDetail).concat(listPagination)
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
      tryAndHandleError({ ack, body, client }, async() => {
         await listReportHistories(false, body.message?.ts, ack, body, client)
      }, 'Failed to display notification sent history list.')
   })

   app.action('action_clear_filters', async ({ ack, body, client }) => {
      const ts = body.message.ts

      tryAndHandleError({ ack, body, client }, async() => {
         const state = await getState(ts)
         state.filterBlockId += 1
         await saveState(state)
         await listReportHistories(true, ts, ack, body, client)
         await client.chat.postMessage({
            channel: body.user.id,
            thread_ts: ts,
            blocks: [],
            text: `Clear all filters successful.`
         })
      }, 'Failed to clear filters of history list.')
   })

   app.action('action_filter_by_report', async ({ ack, body, client }) => {
      tryAndHandleError({ ack, body, client }, async() => {
         await listReportHistories(true, body.message?.ts, ack, body, client)
      }, 'Failed to change filter of notification config.')
   })

   app.action('action_filter_by_conversation', async ({ ack, body, client }) => {
      tryAndHandleError({ ack, body, client }, async() => {
         await listReportHistories(true, body.message?.ts, ack, body, client)
      }, 'Failed to change filter of converstaion.')
   })

   app.action('action_filter_by_start_date', async ({ ack, body, client }) => {
      tryAndHandleError({ ack, body, client }, async() => {
         await listReportHistories(true, body.message?.ts, ack, body, client)
      }, 'Failed to change filter of sent start date.')
   })

   app.action('action_filter_by_end_date', async ({ ack, body, client }) => {
      tryAndHandleError({ ack, body, client }, async() => {
         await listReportHistories(true, body.message?.ts, ack, body, client)
      }, 'Failed to change filter of sent end date.')
   })

   // Choose report history to display detail
   app.action('action_choose_report_history_item', async ({ ack, body, payload, client }) => {
      const ts = body.message.ts

      tryAndHandleError({ ack, body, client }, async() => {
         const state = await getState(ts)
         const selectedId = payload.value
         logger.info('choose report id ' + selectedId)
         if (state.selectedId === selectedId) {
            state.selectedId = null
         } else {
            state.selectedId = selectedId
         }
         await saveState(state)
         await listReportHistories(true, ts, ack, body, client)
      }, 'Failed to view detail of notification history.')
   })

   // previous 5 reports
   app.action({
      block_id: 'block_history_list_pagination',
      action_id: 'action_previous_page'
   }, async ({ ack, body, client }) => {
      const ts = body.message.ts

      tryAndHandleError({ ack, body, client }, async() => {
         const state = await getState(ts)
         if (state.page > 1) {
            state.page -= 1
            await saveState(state)
            await listReportHistories(true, ts, ack, body, client)
         } else {
            await ack()
         }
      }, 'Failed to display previous 5 notification history.')
   })

   // jump to page
   app.action({
      block_id: 'block_history_list_pagination',
      action_id: 'action_cur_page'
   }, async ({ ack, body, payload, client }) => {
      const ts = body.message.ts

      tryAndHandleError({ ack, body, client }, async() => {
         const state = await getState(ts)
         const page = parseInt(payload.selected_option.value)
         if (page != null && !isNaN(page)) {
            state.page = page
            await saveState(state)
            await listReportHistories(true, ts, ack, body, client)
         } else {
            await ack()
         }
      }, 'Failed to jump page.')
   })

   // next 5 reports
   app.action({
      block_id: 'block_history_list_pagination',
      action_id: 'action_next_page'
   }, async ({ ack, body, client }) => {
      const ts = body.message.ts

      tryAndHandleError({ ack, body, client }, async() => {
         const state = await getState(ts)
         const count = state.count
         if (state.page * LIMIT < count) {
            state.page += 1
            await saveState(state)
            await listReportHistories(true, ts, ack, body, client)
         } else {
            await ack()
         }
      }, 'Failed to display next 5 notification history.')
   })

   // delete report message in slack conversations/channels
   app.action({
      block_id: 'block_report_history_actions',
      action_id: 'action_delete_report_message'
   }, async ({ ack, body, client }) => {
      const ts = body.message.ts
      const state = await getState(ts)

      tryAndHandleError({ ack, body, client }, async() => {
         const selectedHistory = await ReportHistory.findOne({ _id: state.selectedId })
         if (selectedHistory == null) {
            throw new Error(`can not find the history since no history with id ${state.selectedId}`)
         }
         logger.info(`start to delete report message ${selectedHistory._id} at ${ts}`)
         logger.info(JSON.stringify(selectedHistory.tsMap))
         if (selectedHistory.tsMap == null || selectedHistory.tsMap.size === 0) {
            await ack()
         } else {
            await ack()
            const reqList = []
            selectedHistory.tsMap.forEach((ts, conversation) => {
               const req = client.chat.delete({
                  channel: conversation,
                  ts: ts
               }).then(res => {
                  logger.info(`succeed to delete report message ${selectedHistory} in ` +
                     `slack channel ${conversation} at timestamp ` + `${ts}.`)
                  return res
               }).catch(e => {
                  logger.error(`failed to delete report message ${selectedHistory} in ` +
                     `slack channel ${conversation} at timestamp ${ts}. ` +
                     `Error message: ${e}`)
                  return null
               })
               reqList.push(req)
            })
            const results = await Promise.all(reqList)
            logger.info(`Delete message results for ${selectedHistory}: ${JSON.stringify(results)}`)
            results.forEach(result => {
               if (result != null && result.ok && result.channel != null) {
                  selectedHistory.tsMap.delete(result.channel)
               }
            })
            // if all messages in slack channels were deleted, update the status to DELETED
            if (selectedHistory.tsMap.size === 0) {
               selectedHistory.status = REPORT_HISTORY_STATUS.DELETED
               await client.chat.postMessage({
                  channel: body.user.id,
                  thread_ts: ts,
                  blocks: [],
                  text: `Delete sent notification in selected conversations successful.`
               })
            }
            await selectedHistory.save()
            await listReportHistories(true, ts, ack, body, client)
         }
      }, 'Failed to delete sent notification in selected conversations.')
   })
}
