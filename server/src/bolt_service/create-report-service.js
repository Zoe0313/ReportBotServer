import logger from '../../common/logger.js'
import { FormatDate, Merge } from '../../common/utils.js'
import {
   LoadBlocks, GetUserTz, TransformInputValuesToObj,
   TryAndHandleError
} from '../../common/slack-helper.js'
import { InitReportBlocks, UpdateFlattenMembers } from './init-blocks-data-helper.js'
import {
   ReportConfiguration, REPORT_STATUS
} from '../model/report-configuration.js'
import { PerforceInfo } from '../model/perforce-info.js'
import { TeamGroup } from '../model/team-group.js'
import { RegisterScheduler } from '../scheduler-adapter.js'
import mongoose from 'mongoose'
import { matchSorter } from 'match-sorter'
import { performance } from 'perf_hooks'

export async function UpdateModal({ ack, body, client }, options) {
   const isInit = options?.isInit || false
   const isNew = options?.isNew || false
   const ts = isInit ? body.message?.ts : body.view?.private_metadata

   const user = body.user?.id
   if (user == null) {
      throw new Error('User is none in body, can not list the reports.')
   }
   const tz = await GetUserTz(user)

   let report = null
   if (isInit && isNew) {
      report = {}
   } else if (isInit && !isNew) {
      report = await ReportConfiguration.findById(options?.id)
   } else {
      report = TransformInputValuesToObj(body.view.state.values)
   }
   const reportType = report.reportType || 'bugzilla'
   const repeatType = report.repeatConfig?.repeatType
   logger.info(`select report type ${reportType} of report scheduler`)
   logger.info(`select repeat type ${repeatType} of report scheduler`)

   const reportModalBasic = LoadBlocks('modal/report-basic')
   const reportModalReportType = LoadBlocks(`report_type/${reportType}`)
   const reportModalAdvanced = LoadBlocks('modal/report-advanced')
   const reportModalRecurrence = LoadBlocks('modal/report-recurrence')
   const reportModalRepeatType = repeatType != null ? LoadBlocks(`repeat_type/${repeatType}`) : []
   const reportModalTime = LoadBlocks('modal/report-time')
   const blocks = reportModalBasic.concat(reportModalReportType).concat(reportModalAdvanced)
      .concat(reportModalRecurrence).concat(reportModalRepeatType).concat(reportModalTime)
   await InitReportBlocks(report, body.view, blocks, options, tz)
   if (ack) {
      await ack()
   }
   let callbackId = body.view?.callback_id
   if (isInit) {
      callbackId = isNew ? 'view_create_report' : 'view_edit_report'
   }
   let title = body.view?.title?.text
   if (isInit) {
      title = isNew ? 'New Notification' : 'Edit Notification'
   }
   const viewOption = {
      trigger_id: isInit ? body.trigger_id : undefined,
      view_id: isInit ? undefined : body.view.id,
      hash: isInit ? undefined : body.view.hash,
      view: {
         type: 'modal',
         callback_id: callbackId,
         private_metadata: ts,
         title: {
            type: 'plain_text',
            text: title
         },
         blocks,
         submit: {
            type: 'plain_text',
            text: 'Submit'
         }
      }
   }
   isInit ? await client.views.open(viewOption) : await client.views.update(viewOption)
}

export function RegisterCreateReportServiceHandler(app) {
   // New report message configuration
   app.action({
      block_id: 'block_welcome',
      action_id: 'action_create'
   }, async ({ ack, body, client }) => {
      TryAndHandleError({ ack, body, client }, async () => {
         logger.info('open create report config modal')
         await UpdateModal({ ack, body, client }, { isInit: true, isNew: true })
      }, 'Failed to open create report configuration modal.')
   })

   app.action({
      block_id: 'repeatConfig.repeatType',
      action_id: 'action_repeat_type'
   }, async (event) => {
      TryAndHandleError(event, async () => {
         await UpdateModal(event)
      }, 'Failed to change repeat type.')
   })

   app.action({
      block_id: 'reportType',
      action_id: 'action_report_type'
   }, async (event) => {
      TryAndHandleError(event, async () => {
         await UpdateModal(event)
      }, 'Failed to change notification type.')
   })

   // Precheck and create a report request
   app.view('view_create_report', async ({ ack, body, view, client }) => {
      TryAndHandleError({ ack, body, client }, async () => {
         const user = body.user.id
         const tz = await GetUserTz(user)
         const inputObj = TransformInputValuesToObj(view.state.values)
         const report = new ReportConfiguration(
            Merge(inputObj, {
               creator: user,
               status: REPORT_STATUS.CREATED,
               mentionUsers: inputObj.mentionUsers || [],
               mentionGroups: inputObj.mentionGroups || [],
               reportSpecConfig: {
                  perforceCheckIn: {
                     branches: inputObj.reportSpecConfig.perforceCheckIn?.branches
                        ?.map(option => option.value),
                     teams: inputObj.reportSpecConfig.perforceCheckIn?.teams
                        ?.map(option => option.value)
                  },
                  perforceReviewCheck: {
                     branches: inputObj.reportSpecConfig.perforceReviewCheck?.branches
                        ?.map(option => option.value),
                     teams: inputObj.reportSpecConfig.perforceReviewCheck?.teams
                        ?.map(option => option.value)
                  }
               },
               repeatConfig: {
                  tz,
                  dayOfWeek: inputObj.repeatConfig.dayOfWeek?.map(option => option.value),
                  date: FormatDate(inputObj.repeatConfig.date)
               }
            })
         )
         logger.debug(report)
         logger.debug(inputObj.mentionGroups)

         const saved = await report.save()

         // if perforce_checkin type, flatten member list and save to report configuration
         if (report.reportType === 'perforce_checkin' ||
            report.reportType === 'perforce_review_check') {
            UpdateFlattenMembers(report)
         }
         RegisterScheduler(report)

         logger.info(`Create successful. saved report id ${saved._id}`)
         const blocks = LoadBlocks('precheck-report')
         // create inited status report
         blocks.find(block => block.block_id === 'block_create_last')
            .elements.forEach(element => { element.value = saved._id })
         await ack()
         await client.chat.postMessage({
            channel: user,
            blocks: blocks,
            text: 'Precheck your new report'
         })
      }, async (e) => {
         logger.debug(e)
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
               thread_ts: body.message.ts,
               text: 'Failed to open precheck confirmation. ' +
                  'Please contact developers to resolve it.'
            })
            throw e
         }
      })
   })

   // Listen to the action_create_done action
   app.action({
      block_id: 'block_create_last',
      action_id: 'action_create_done'
   }, async ({ ack, payload, body, client }) => {
      TryAndHandleError({ ack, body, client }, async () => {
         await ack()
         // change to enable status
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
         RegisterScheduler(report)
         const blocks = LoadBlocks('done-create')
         await client.chat.update({
            channel: body.channel.id,
            ts,
            blocks: blocks,
            text: 'Create and enable new report configuration!'
         })
      }, 'Failed to save and enable notiifcation configuration.')
   })

   // Listen to the action_create_save action
   app.action({
      block_id: 'block_create_last',
      action_id: 'action_create_save'
   }, async ({ ack, payload, body, client }) => {
      TryAndHandleError({ ack, body, client }, async () => {
         await ack()
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
      }, 'Failed to save notiifcation configuration as draft.')
   })

   // Listen to the action_create_cancel action
   app.action({
      block_id: 'block_create_last',
      action_id: 'action_create_cancel'
   }, async ({ ack, payload, body, client }) => {
      TryAndHandleError({ ack, body, client }, async () => {
         await ack()
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
      }, 'Failed to cancel this report configuration.')
   })

   // Responding to the external_select options request for perforce branches
   app.options('action_select_branches', async ({ ack, options }) => {
      const t0 = performance.now()
      const keyword = options.value
      logger.info(`keyword: ${keyword}, get all perforce braneches in db`)
      const allBranches = (await PerforceInfo.find())
         .map(perforceInfo => {
            return perforceInfo.branches
               .map(branch => `${perforceInfo.project}/${branch}`)
         }).flat()
      logger.debug(`get branches in db cost ${performance.now() - t0}`)

      // match keyword and sort by score
      // refer to match-sorter https://www.npmjs.com/package/match-sorter
      if (allBranches != null && allBranches.length > 0) {
         const sortedBranchesWithLimit = matchSorter(allBranches, keyword).slice(0, 20)
         logger.debug(`sort branches cost ${performance.now() - t0}`)
         logger.info(`0 - 20 branches stored are ${sortedBranchesWithLimit}`)
         const options = sortedBranchesWithLimit.map(branch => ({
            text: {
               type: 'plain_text',
               text: branch
            },
            value: branch
         }))
         await ack({
            options: options
         })
         logger.debug(`ack branches cost ${performance.now() - t0}`)
      } else {
         await ack()
      }
   })

   // Responding to multi_external_select options request for teams
   app.options('action_select_teams', async ({ ack, options, payload }) => {
      const t0 = performance.now()
      const keyword = options.value
      logger.info(`keyword: ${keyword}, get all team lists in db`)
      const allTeams = await TeamGroup.find()
      const allTeamNames = allTeams.map(team => team.name)
      logger.debug(`get all team names ${allTeamNames} in db cost ${performance.now() - t0}`)

      // match keyword and sort by score
      // refer to match-sorter https://www.npmjs.com/package/match-sorter
      if (allTeamNames != null && allTeamNames.length > 0) {
         const sortedTeamNamesWithLimit = matchSorter(allTeamNames, keyword).slice(0, 20)
         logger.debug(`sort team names cost ${performance.now() - t0}`)
         logger.info(`0 - 20 teams stored are ${sortedTeamNamesWithLimit}`)
         const teamNameOptions = sortedTeamNamesWithLimit.map(teamName => ({
            text: {
               type: 'plain_text',
               text: teamName
            },
            value: allTeams.find(team => team.name === teamName)?.code
         })).filter(option => option.value != null)
         await ack({
            options: teamNameOptions
         })
         logger.debug(`ack team names cost ${performance.now() - t0}`)
      } else {
         await ack()
      }
   })

   // Listern to add member filter
   app.action({
      block_id: 'block_add_member_filter',
      action_id: 'action_add_member_filter'
   }, async (event) => {
      TryAndHandleError(event, async () => {
         await UpdateModal(event, { addMembersFilter: true })
      }, 'Fail to add new members filter.')
   })

   // Listen to member filter condition
   app.action({
      block_id: /^reportSpecConfig\.(.*)\.membersFilters[[0-9]*]/,
      action_id: 'condition'
   }, async (event) => {
      TryAndHandleError(event, async () => {
         await UpdateModal(event)
      }, 'Failed to change condition of members filter.')
   })

   // Listen to member filter type
   app.action({
      block_id: /^reportSpecConfig\.(.*)\.membersFilters[[0-9]*]/,
      action_id: 'type'
   }, async (event) => {
      TryAndHandleError(event, async () => {
         await UpdateModal(event)
      }, 'Failed to change type of members filter.')
   })

   // Listen to remove member filter button and update modal
   app.action({
      block_id: /^block_remove_member_filter_[0-9]*/,
      action_id: 'action_remove_member_filter'
   }, async (event) => {
      TryAndHandleError(event, async () => {
         await UpdateModal(event, { removeMembersFilter: { index: parseInt(event.payload.value) } })
      }, 'Fail to remove members filter.')
   })

   // Listen to advanced option button and update modal
   app.action({
      block_id: 'advancedOptions',
      action_id: 'action_advanced_options'
   }, async (event) => {
      TryAndHandleError(event, async () => {
         await UpdateModal(event, { advancedOption: event.payload.value })
      }, 'Fail to open advanced options.')
   })

   let slackUserGroups = []
   // Listen to select slack user group option and show group list
   app.options('action_mention_groups', async ({ ack, options, payload, client }) => {
      const t0 = performance.now()
      const keyword = options.value
      logger.info(`keyword: ${keyword}, get all user groups in slack`)
      if (slackUserGroups == null || slackUserGroups.length === 0) {
         slackUserGroups = (await client.usergroups.list()).usergroups
      }
      const sortedUserGroupsWithLimit = matchSorter(
         slackUserGroups.map(group => group.name), keyword).slice(0, 20)
      logger.debug(`sort slack user group names cost ${performance.now() - t0}`)
      logger.info(`0 - 20 slack user groups stored are ${sortedUserGroupsWithLimit}`)
      const userGroupOptions = sortedUserGroupsWithLimit.map(groupName => ({
         text: {
            type: 'plain_text',
            text: groupName
         },
         value: slackUserGroups.find(group => group.name === groupName)?.id
      })).filter(option => option.value != null)
      await ack({
         options: userGroupOptions
      })
      logger.debug(`ack slack user group cost ${performance.now() - t0}`)
      slackUserGroups = (await client.usergroups.list()).usergroups
   })
}
