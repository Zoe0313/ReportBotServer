import {
   FormatDate, FormatDateTime, Merge
} from '../../common/utils.js'
import logger from '../../common/logger.js'
import {
   LoadBlocks, GetConversationsName, GetUserTz,
   TransformInputValuesToObj, FindBlockById, TryAndHandleError
} from '../../common/slack-helper.js'
import {
   DisplayTimeSetting, UpdateFlattenMembers,
   GenerateNannyRoster
} from './init-blocks-data-helper.js'
import {
   ReportConfiguration, REPORT_STATUS
} from '../model/report-configuration.js'
import { ReportConfigurationState } from '../model/report-configuration-state.js'
import {
   RegisterScheduler, UnregisterScheduler, NextInvocation, CancelNextInvocation, InvokeNow
} from '../scheduler-adapter.js'
import { UpdateModal } from './create-report-service.js'
import cloneDeep from 'lodash/cloneDeep.js'
import mongoose from 'mongoose'
import { matchSorter } from 'match-sorter'
import { performance } from 'perf_hooks'

const LIMIT = 5

const REPORT_STATUS_DISPLAY = {
   CREATED: 'Created',
   DRAFT: ':black_square_for_stop: Draft',
   DISABLED: ':black_square_for_stop: Disabled',
   ENABLED: ':white_check_mark: Enabled',
   REMOVED: ':black_square_for_stop: REMOVED'
}

async function GetState(ts) {
   let state = await ReportConfigurationState.findOne({ ts })
   if (state == null) {
      state = ReportConfigurationState({
         ts,
         page: 1,
         count: null,
         channel: null,
         filterBlockId: 1, // dynamic block id to implement clear filters
         selectedId: null
      })
      await state.save()
   }
   return state
}

async function SaveState(state) {
   if (state != null) {
      await ReportConfigurationState.updateOne({ _id: state._id }, state)
   } else {
      throw new Error('State should not be null.')
   }
}

export function RegisterManageReportServiceHandler(app) {
   const ListReports = async (isUpdate, ts, ack, body, client) => {
      logger.info('display or update list, ts ' + ts)
      const state = await GetState(ts)
      const user = body.user?.id
      if (user == null) {
         throw new Error('User is none in body, can not list the reports.')
      }
      const tz = await GetUserTz(user)
      const t0 = performance.now()

      let offset = (state.page - 1) * LIMIT
      const filter = {
         $and: [
            { status: { $ne: REPORT_STATUS.CREATED } },
            { status: { $ne: REPORT_STATUS.REMOVED } }
         ]
      }
      if (!process.env.ADMIN_USER_ID.includes(user)) {
         filter.creator = user
      } else {
         const filterTitles = body?.state?.values['block_report_filter_title' + state.filterBlockId]
            ?.action_report_filter_by_title?.selected_options.map(selectedOption => {
               return selectedOption.value
            })
         const filterConversation = body?.state?.values['block_report_filter_basic' +
            state.filterBlockId]?.action_report_filter_by_conversation?.selected_conversation
         const filterCreator = body?.state?.values['block_report_filter_basic' +
            state.filterBlockId]?.action_report_filter_by_creator?.selected_user
         if (Array.isArray(filterTitles) && filterTitles.length > 0) {
            filter.title = { $in: filterTitles }
         }
         if (filterConversation) {
            filter.conversations = filterConversation
         }
         if (filterCreator) {
            filter.creator = filterCreator
         }
         logger.info(JSON.stringify(filter))
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

      // list filter
      let listFilter = []
      if (process.env.ADMIN_USER_ID.includes(user)) {
         listFilter = LoadBlocks('report/list-filter')
         listFilter[1].block_id = 'block_report_filter_title' + state.filterBlockId.toString()
         listFilter[2].block_id = 'block_report_filter_basic' + state.filterBlockId.toString()
      }
      // list header
      const listHeader = LoadBlocks('report/list-header')
      listHeader[0].text.text = `There are ${count} notifications in your account.`

      // list item detail
      let listItemDetail = LoadBlocks('report/list-item-detail')
      const report = await ReportConfiguration.findById(state.selectedId)
      if (state.selectedId == null || report == null) {
         state.selectedId = null
         listItemDetail = []
      } else {
         const [conversations, mentionUsers] = await Promise.all([
            GetConversationsName(report.conversations),
            GetConversationsName(report.mentionUsers?.concat(
               report.mentionGroups?.map(group => group.value) || []) || [])
         ])
         logger.info(conversations)
         logger.info(mentionUsers)
         const nextInvocationTime = await NextInvocation(report._id)
         const nextReportSendingTime = nextInvocationTime
            ? FormatDateTime(new Date(nextInvocationTime), tz)
            : 'No longer executed'
         logger.info(nextReportSendingTime)

         // report title
         listItemDetail[1].text.text = `*Title: ${report.title}*`
         if (process.env.ADMIN_USER_ID.includes(user)) {
            listItemDetail[1].text.text += `  created by ${GetConversationsName([report.creator])}`
         }
         // report type
         const reportTypeOptions = FindBlockById(LoadBlocks('modal/report-basic'), 'reportType')
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
         listItemDetail[2].fields[4].text += FormatDate(report.repeatConfig.startDate)
         // scheduler end date
         listItemDetail[2].fields[5].text += FormatDate(report.repeatConfig.endDate)
         // repeat config summary
         listItemDetail[2].fields[6].text += DisplayTimeSetting(report, tz)
         // next sending time
         listItemDetail[2].fields[7].text += nextReportSendingTime

         // edit button
         listItemDetail[3].elements[0].value = report._id
         // remove button
         listItemDetail[3].elements[1].value = report._id
         // enable or disable button, only display one button
         listItemDetail[3].elements.splice(report.status === REPORT_STATUS.ENABLED ? 2 : 3, 1)
         // send the notification to me button
         listItemDetail[3].elements[3].value = report._id
      }

      // list items
      const listItemTemplate = LoadBlocks('report/list-item-template')[0]
      const listItems = reportConfigurations.map(report => {
         const creator = process.env.ADMIN_USER_ID.includes(user) ? ` - ${GetConversationsName([report.creator])}` : ''
         const icon = report.status === 'ENABLED' ? ':white_check_mark:' : ':black_square_for_stop:'
         const content = `*${report.title} - ${report.reportType}*${creator} ${icon}\n${DisplayTimeSetting(report, tz)}`
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
      let listPagination = LoadBlocks('report/list-pagination')
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
      const blocks = listHeader.concat(listFilter).concat(listItems)
         .concat(listItemDetail).concat(listPagination)
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
         logger.debug(`${performance.now() - t0} cost`)
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
      action_id: 'action_list'
   }, async ({ ack, body, client }) => {
      TryAndHandleError({ ack, body, client }, async () => {
         await ListReports(false, body.message?.ts, ack, body, client)
      }, 'Failed to open notification configs list.')
   })

   // Choose report to display detail
   app.action('action_choose_report_item', async ({ ack, body, payload, say, client }) => {
      const ts = body.message.ts

      TryAndHandleError({ ack, body, client }, async () => {
         const state = await GetState(ts)
         const selected = payload.value
         logger.info('choose report id ' + selected)
         if (state.selectedId === selected) {
            state.selectedId = null
         } else {
            state.selectedId = selected
         }
         await SaveState(state)
         await ListReports(true, ts, ack, body, client)
      }, 'Failed to view notification detail.')
   })

   // previous 5 reports
   app.action({
      block_id: 'block_list_pagination',
      action_id: 'action_previous_page'
   }, async ({ ack, body, client }) => {
      const ts = body.message.ts

      TryAndHandleError({ ack, body, client }, async () => {
         const state = await GetState(ts)
         if (state.page > 1) {
            state.page -= 1
            await SaveState(state)
            await ListReports(true, ts, ack, body, client)
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

      TryAndHandleError({ ack, body, client }, async () => {
         const state = await GetState(ts)
         const count = await ReportConfiguration.countDocuments()
         if (state.page * LIMIT < count) {
            state.page += 1
            await SaveState(state)
            await ListReports(true, ts, ack, body, client)
         } else {
            await ack()
         }
      }, 'Failed to display next 5 notification.')
   })

   // change report status
   app.action('action_change_report_status', async ({ ack, body, payload, client }) => {
      const ts = body.message.ts
      const status = payload.value
      TryAndHandleError({ ack, body, client }, async () => {
         const state = await GetState(ts)
         const id = state.selectedId
         logger.info(`change report status, id: ${id}, status: ${status}`)
         if (!id) {
            throw new Error('report id is null')
         }
         await ReportConfiguration.updateOne({ _id: id }, { status })
         const report = await ReportConfiguration.findById(id)
         if (report.status === 'ENABLED') {
            RegisterScheduler(report)
         } else {
            UnregisterScheduler(id)
         }
         await ListReports(true, ts, ack, body, client)
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
      TryAndHandleError({ ack, body, client }, async () => {
         const id = payload.value
         logger.info(`display remove report confirm modal, id: ${id}`)
         if (!id) {
            throw Error('id is null when remove report')
         }
         const report = await ReportConfiguration.findById(id)
         const blocks = LoadBlocks('modal/confirmation')
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

      TryAndHandleError({ ack, body, client }, async () => {
         const state = await GetState(ts)
         const id = state.selectedId
         logger.info(`remove report, id: ${id} ts: ${ts}`)
         if (!id) {
            throw Error('id is null when remove report')
         }
         await ReportConfiguration.updateOne({ _id: id }, { status: REPORT_STATUS.REMOVED })
         UnregisterScheduler(id)
         await ListReports(true, ts, ack, body, client)
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
      TryAndHandleError({ ack, body, client }, async () => {
         const ts = body.message.ts
         const state = await GetState(ts)
         const id = state.selectedId
         if (!id) {
            throw new Error('report id is null')
         }
         await UpdateModal({ ack, body, client }, { isInit: true, id })
      }, 'Failed to open edit notification modal.')
   })

   // confirm edit
   app.view('view_edit_report', async ({ ack, body, payload, view, client }) => {
      const ts = payload.private_metadata
      TryAndHandleError({ ack, body, client }, async () => {
         const state = await GetState(ts)
         const id = state.selectedId
         logger.info(`edit report, id: ${id}`)
         if (!id) {
            throw new Error('report id is null when editing report config')
         }
         const user = body.user.id
         const tz = await GetUserTz(user)
         const oldReport = await ReportConfiguration.findById(id)
         if (!oldReport) {
            throw new Error(`cannot find report ${id} in db`)
         }
         const inputObj = TransformInputValuesToObj(view.state.values)
         logger.info(`inputObj: ${JSON.stringify(inputObj)}`)
         const baseFields = inputObj.reportSpecConfig.jira?.basefields
            ?.map(option => option.value) || []
         const customFields = inputObj.reportSpecConfig.jira?.customfields
            ?.split(',')?.map(v => v.trim()) || []
         const jiraFields = Array.from(new Set(baseFields.concat(customFields)))
         const nannyRoster = await GenerateNannyRoster(inputObj, false, tz)
         const report = Merge(oldReport, Merge(inputObj, {
            mentionUsers: inputObj.mentionUsers || [],
            mentionGroups: inputObj.mentionGroups || [],
            skipEmptyReport: inputObj.skipEmptyReport || 'No',
            reportSpecConfig: {
               perforceCheckIn: {
                  branches: inputObj.reportSpecConfig.perforceCheckIn?.branches
                     ?.map(option => option.value),
                  teams: inputObj.reportSpecConfig.perforceCheckIn?.teams
                     ?.map(option => option.value),
                  needCheckinApproved: inputObj.reportSpecConfig.perforceCheckIn
                     ?.needCheckinApproved || 'Yes'
               },
               perforceReviewCheck: {
                  branches: inputObj.reportSpecConfig.perforceReviewCheck?.branches
                     ?.map(option => option.value),
                  teams: inputObj.reportSpecConfig.perforceReviewCheck?.teams
                     ?.map(option => option.value)
               },
               nannyRoster: nannyRoster,
               jira: {
                  fields: jiraFields
               }
            },
            repeatConfig: {
               tz,
               dayOfWeek: inputObj.repeatConfig.dayOfWeek?.map(option => option.value),
               date: FormatDate(inputObj.repeatConfig.date),
               startDate: inputObj.repeatConfig?.startDate || null,
               endDate: inputObj.repeatConfig?.endDate || null
            },
            adminConfig: {
               channels: inputObj.adminConfig?.channels?.map(option => option.value)
            }
         }))
         logger.info(report)
         await report.save()
         await ack()
         if (report.reportType === 'perforce_checkin' ||
            report.reportType === 'perforce_review_check') {
            UpdateFlattenMembers(report)
         }
         RegisterScheduler(report)
         logger.info(`Edit successful. report id ${id}`)
         await ListReports(true, ts, ack, body, client)
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
      cancel_next: 'cancel next invocation of notification'
   }

   // display confirmation modal for more actions overflow
   app.action({
      block_id: 'block_list_detail_title',
      action_id: 'action_report_more_actions'
   }, async ({ ack, body, payload, client }) => {
      const action = payload.selected_option.value
      const ts = body.message.ts

      TryAndHandleError({ ack, body, client }, async () => {
         const state = await GetState(ts)
         const id = state.selectedId
         if (!id) {
            throw Error('id is null when remove report')
         }
         logger.info(`display confirmation modal, action: ${action}, id: ${id}`)
         const report = await ReportConfiguration.findById(id)
         const blocks = LoadBlocks('modal/confirmation')
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

   app.action('action_invoke_to_me_now', async ({ ack, body, payload, client }) => {
      const ts = body.message.ts
      const status = payload.value
      TryAndHandleError({ ack, body, client }, async () => {
         const state = await GetState(ts)
         const id = state.selectedId
         logger.info(`Invoke the notification to me now, id: ${id}, status: ${status}`)
         if (!id) {
            throw new Error('report id is null')
         }
         const report = await ReportConfiguration.findById(id)
         if (report.status === 'ENABLED') {
            InvokeNow(id, body.user.id)
            await ack()
         }
      }, `Failed to send notification to me now.`)
   })

   // confirm cancel next report sending
   app.view('view_more_action_confirmation', async ({ ack, body, client }) => {
      logger.info(`view_more_action_confirmation private_metadata: ${body.view.private_metadata}`)
      const privateMetadata = JSON.parse(body.view.private_metadata)
      const action = privateMetadata.action
      TryAndHandleError({ ack, body, client }, async () => {
         const id = privateMetadata.id
         if (!id) {
            throw new Error('report id is null')
         }
         const ts = privateMetadata.ts
         logger.info(`execute ${action}, id: ${id}`)
         switch (action) {
            case 'invoke_now':
               InvokeNow(id)
               await ack()
               break
            case 'invoke_to_me_now':
               InvokeNow(id, body.user.id)
               await ack()
               break
            case 'cancel_next':
               await CancelNextInvocation(id)
               await ListReports(true, ts, ack, body, client)
               break
            default:
               throw new Error('unknow action for action_report_more_actions')
         }
      }, `Failed to ${actionText[action]}.`)
   })

   app.action('action_report_clear_filters', async ({ ack, body, client }) => {
      const ts = body.message.ts

      TryAndHandleError({ ack, body, client }, async() => {
         const state = await GetState(ts)
         state.filterBlockId += 1
         await SaveState(state)
         await ListReports(true, ts, ack, body, client)
         await client.chat.postMessage({
            channel: body.user.id,
            thread_ts: ts,
            blocks: [],
            text: `Clear all filters successful.`
         })
      }, 'Failed to clear filters of notification list.')
   })

   app.action('action_report_filter_by_title', async ({ ack, body, client }) => {
      TryAndHandleError({ ack, body, client }, async() => {
         await ListReports(true, body.message?.ts, ack, body, client)
      }, 'Failed to change filter of report title.')
   })

   app.action('action_report_filter_by_conversation', async ({ ack, body, client }) => {
      TryAndHandleError({ ack, body, client }, async() => {
         await ListReports(true, body.message?.ts, ack, body, client)
      }, 'Failed to change filter of report conversation.')
   })

   app.action('action_report_filter_by_creator', async ({ ack, body, client }) => {
      TryAndHandleError({ ack, body, client }, async() => {
         await ListReports(true, body.message?.ts, ack, body, client)
      }, 'Failed to change filter of report creator.')
   })

   app.options('action_report_filter_by_title', async ({ ack, options }) => {
      const keyword = options.value
      logger.info(`keyword: ${keyword}, get all notification titles in db.`)
      const t0 = performance.now()
      const filter = {
         $and: [
            { status: { $ne: REPORT_STATUS.CREATED } },
            { status: { $ne: REPORT_STATUS.REMOVED } }
         ]
      }
      const allTitles = [...new Set((await ReportConfiguration.find(filter,
         { title: 1, _id: 0 })).map(report => {
         return report.title
      }).flat())]
      logger.debug(`get titles in db cost ${performance.now() - t0}`)
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
