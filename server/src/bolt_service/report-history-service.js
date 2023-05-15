import { FormatDateTime } from '../../common/utils.js'
import logger from '../../common/logger.js'
import {
   LoadBlocks, GetConversationsName, GetUserTz, FindBlockById, TryAndHandleError
} from '../../common/slack-helper.js'
import { ReportHistory, REPORT_HISTORY_STATUS } from '../model/report-history.js'
import { ReportHistoryState } from '../model/report-history-state.js'
import cloneDeep from 'lodash/cloneDeep.js'
import { performance } from 'perf_hooks'
import { matchSorter } from 'match-sorter'

const LIMIT = 5

async function GetState(ts) {
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

async function SaveState(state) {
   if (state != null) {
      await ReportHistoryState.updateOne({ _id: state._id }, state)
   } else {
      throw new Error('State should not be null.')
   }
}

export function RegisterReportHistoryServiceHandler(app) {
   const ListReportHistories = async (isUpdate, ts, ack, body, client) => {
      logger.info('display or update list, ts ' + ts)
      const state = await GetState(ts)
      logger.info(`history state: ${JSON.stringify(state)}`)
      const user = body.user?.id
      if (user == null) {
         throw new Error('User is none in body, can not list the reports.')
      }
      const tz = await GetUserTz(user)
      const t0 = performance.now()

      let offset = (state.page - 1) * LIMIT

      const filterTitles = body?.state?.values['block_history_filter_title' + state.filterBlockId]
         ?.action_filter_by_title?.selected_options.map(selectedOption => {
            return selectedOption.value
         })
      const filterConversation = body?.state?.values['block_history_filter_basic' +
         state.filterBlockId]?.action_filter_by_conversation?.selected_conversation
      const filterStartDate = body?.state?.values['block_history_filter_date' + state.filterBlockId]
         ?.action_filter_by_start_date?.selected_date
      const filterEndDate = body?.state?.values['block_history_filter_date' + state.filterBlockId]
         ?.action_filter_by_end_date?.selected_date
      const filters = { creator: user }
      if (Array.isArray(filterTitles) && filterTitles.length > 0) {
         filters.title = { $in: filterTitles }
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
      const realCount = await ReportHistory.countDocuments(filters)
      let count = realCount
      if (realCount > 500) {
         count = 500
      }
      if (offset >= count) {
         state.page = 1
         offset = 0
      }
      const reportHistories = await ReportHistory.find(filters)
         .skip(offset).limit(LIMIT).sort({
            sentTime: -1
         })
      state.count = count
      // list filter
      const listFilter = LoadBlocks('report_history/list-filter')
      listFilter[1].block_id = 'block_history_filter_title' + state.filterBlockId.toString()
      listFilter[2].block_id = 'block_history_filter_basic' + state.filterBlockId.toString()
      listFilter[3].block_id = 'block_history_filter_date' + state.filterBlockId.toString()
      // list header
      const listHeader = LoadBlocks('report_history/list-header')
      listHeader[0].text.text = `There are ${realCount} notification histories after conditions applied.`
      // list item detail
      let listItemDetail = LoadBlocks('report_history/list-item-detail')
      const selectedHistory = reportHistories.find((reportHistory) => {
         return reportHistory._id.toString() === state.selectedId
      })
      logger.debug(selectedHistory)
      if (state.selectedId == null || selectedHistory == null) {
         state.selectedId = null
         listItemDetail = []
      } else {
         const [conversations, mentionUsers] = await Promise.all([
            GetConversationsName(selectedHistory.conversations),
            GetConversationsName(selectedHistory.mentionUsers)
         ])
         logger.info(conversations)
         logger.info(mentionUsers)
         const detailsBlock = FindBlockById(listItemDetail, 'block_report_history_details')
         const contentBlock = FindBlockById(listItemDetail, 'block_report_history_content')
         detailsBlock.fields[0].text += selectedHistory.title
         detailsBlock.fields[1].text += selectedHistory.status
         detailsBlock.fields[2].text += selectedHistory.reportType
         detailsBlock.fields[3].text += FormatDateTime(selectedHistory.sentTime, tz)
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
      const listItemTemplate = LoadBlocks('report_history/list-item-template')[0]
      const listItems = reportHistories.map(history => {
         const content = `*${history.title} - ${history.reportType}* ` +
            `was sent at ${FormatDateTime(history.sentTime, tz)}`
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
      let listPagination = LoadBlocks('report_history/list-pagination')
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
      await SaveState(state)
   }

   // List all reports
   app.action({
      block_id: 'block_welcome',
      action_id: 'action_history'
   }, async ({ ack, body, client }) => {
      TryAndHandleError({ ack, body, client }, async() => {
         await ListReportHistories(false, body.message?.ts, ack, body, client)
      }, 'Failed to display notification sent history list.')
   })

   app.action('action_clear_filters', async ({ ack, body, client }) => {
      const ts = body.message.ts

      TryAndHandleError({ ack, body, client }, async() => {
         const state = await GetState(ts)
         state.filterBlockId += 1
         await SaveState(state)
         await ListReportHistories(true, ts, ack, body, client)
         await client.chat.postMessage({
            channel: body.user.id,
            thread_ts: ts,
            blocks: [],
            text: `Clear all filters successful.`
         })
      }, 'Failed to clear filters of history list.')
   })

   app.action('action_filter_by_title', async ({ ack, body, client }) => {
      TryAndHandleError({ ack, body, client }, async() => {
         logger.info(`action_filter_by_title body: ${JSON.stringify(body)}`)
         await ListReportHistories(true, body.message?.ts, ack, body, client)
      }, 'Failed to change filter of notification title.')
   })

   app.action('action_filter_by_conversation', async ({ ack, body, client }) => {
      TryAndHandleError({ ack, body, client }, async() => {
         await ListReportHistories(true, body.message?.ts, ack, body, client)
      }, 'Failed to change filter of conversation.')
   })

   app.action('action_filter_by_start_date', async ({ ack, body, client }) => {
      TryAndHandleError({ ack, body, client }, async() => {
         await ListReportHistories(true, body.message?.ts, ack, body, client)
      }, 'Failed to change filter of sent start date.')
   })

   app.action('action_filter_by_end_date', async ({ ack, body, client }) => {
      TryAndHandleError({ ack, body, client }, async() => {
         await ListReportHistories(true, body.message?.ts, ack, body, client)
      }, 'Failed to change filter of sent end date.')
   })

   // Choose report history to display detail
   app.action('action_choose_report_history_item', async ({ ack, body, payload, client }) => {
      const ts = body.message.ts

      TryAndHandleError({ ack, body, client }, async() => {
         const state = await GetState(ts)
         const selectedId = payload.value
         logger.info('choose report id ' + selectedId)
         if (state.selectedId === selectedId) {
            state.selectedId = null
         } else {
            state.selectedId = selectedId
         }
         await SaveState(state)
         await ListReportHistories(true, ts, ack, body, client)
      }, 'Failed to view detail of notification history.')
   })

   // previous 5 reports
   app.action({
      block_id: 'block_history_list_pagination',
      action_id: 'action_previous_page'
   }, async ({ ack, body, client }) => {
      const ts = body.message.ts

      TryAndHandleError({ ack, body, client }, async() => {
         const state = await GetState(ts)
         if (state.page > 1) {
            state.page -= 1
            await SaveState(state)
            await ListReportHistories(true, ts, ack, body, client)
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

      TryAndHandleError({ ack, body, client }, async() => {
         const state = await GetState(ts)
         const page = parseInt(payload.selected_option.value)
         if (page != null && !isNaN(page)) {
            state.page = page
            await SaveState(state)
            await ListReportHistories(true, ts, ack, body, client)
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

      TryAndHandleError({ ack, body, client }, async() => {
         const state = await GetState(ts)
         const count = state.count
         if (state.page * LIMIT < count) {
            state.page += 1
            await SaveState(state)
            await ListReportHistories(true, ts, ack, body, client)
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
      const state = await GetState(ts)

      TryAndHandleError({ ack, body, client }, async() => {
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
            await ListReportHistories(true, ts, ack, body, client)
         }
      }, 'Failed to delete sent notification in selected conversations.')
   })

   // Responding to the external_select options request for history filter report title
   app.options('action_filter_by_title', async ({ ack, options }) => {
      const keyword = options.value
      const user = options.user?.id
      logger.info(`keyword: ${keyword}, get all notification titles of user ${user} in db.`)
      const t0 = performance.now()
      // In order to query db more quickly, we add "{ title: 1, _id: 0 }" here.
      // refer to https://stackoverflow.com/questions/25589113/
      // how-to-select-a-single-field-for-all-documents-in-a-mongodb-collection
      const allTitles = [...new Set((await ReportHistory.find({ creator: user },
         { title: 1, _id: 0 })).map(reportHistory => {
         return reportHistory.title
      }).flat())]
      logger.debug(`get titles in db cost ${performance.now() - t0}`)
      // match keyword and sort by score
      // refer to match-sorter https://www.npmjs.com/package/match-sorter
      if (allTitles != null && allTitles.length > 0) {
         const sortedTitlesWithLimit = matchSorter(allTitles, keyword).slice(0, 10)
         logger.debug(`sort titles cost ${performance.now() - t0}`)
         logger.info(`0 - 10 titles stored are ${sortedTitlesWithLimit}`)
         const options = sortedTitlesWithLimit.map(title => ({
            text: {
               type: 'plain_text',
               text: title
            },
            value: title
         }))
         await ack({
            options: options
         })
         logger.debug(`ack titles cost ${performance.now() - t0}`)
      } else {
         await ack()
      }
   })
}
