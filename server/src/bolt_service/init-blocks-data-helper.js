import logger from '../../common/logger.js'
import {
   LoadBlocks, FindBlockById, GetUsersName
} from '../../common/slack-helper.js'
import {
   ConvertTimeWithTz, FormatDateTime, FormatDate, ParseDateWithTz,
   GetDayOfThisWeek, FormatDateWithTz
} from '../../common/utils.js'
import cloneDeep from 'lodash/cloneDeep.js'
import {
   ReportConfiguration, FlattenMembers
} from '../model/report-configuration.js'
import { TeamGroup } from '../model/team-group.js'
import cronParser from 'cron-parser'

const WEEK = {
   1: 'Monday',
   2: 'Tuesday ',
   3: 'Wednesday ',
   4: 'Thursday',
   5: 'Friday',
   6: 'Saturday',
   0: 'Sunday'
}

const MEMBERS_CONDITION_HINT = {
   include: 'Including ',
   exclude: 'Excluding '
}

const MEMBERS_FILTER_HINT = {
   selected: 'only selected users',
   direct_reporters: 'selected users and direct reporters of selected users',
   all_reporters: 'selected users and all direct & indirect reporters of selected users'
}

function InitRecurrenceSettingValue(report, blocks, options, tz) {
   const isNew = options?.isNew
   if (report.repeatConfig?.startDate != null) {
      FindBlockById(blocks, 'repeatConfig.startDate').element.initial_date =
         FormatDate(report.repeatConfig.startDate)
   } else if (isNew) {
      FindBlockById(blocks, 'repeatConfig.startDate').element.initial_date =
         FormatDate(new Date())
   }
   if (report.repeatConfig?.endDate != null) {
      FindBlockById(blocks, 'repeatConfig.endDate').element.initial_date =
         FormatDate(report.repeatConfig.endDate)
   }
   if (report.repeatConfig?.repeatType == null) {
      return
   }
   const repeatTypeBlock = FindBlockById(blocks, 'repeatConfig.repeatType')
   const repeatTypeOption = repeatTypeBlock.element.options
      .find(option => option.value === report.repeatConfig.repeatType)
   if (repeatTypeOption != null) {
      repeatTypeBlock.element.initial_option = repeatTypeOption
   }
   const repeatConfig = report.repeatConfig
   if (repeatConfig == null) {
      return
   }
   const { time, dayOffset } = ConvertTimeWithTz(repeatConfig.time, repeatConfig.tz, tz)
   const dayOfWeek = repeatConfig.dayOfWeek?.map(day => {
      return (day + dayOffset) > 6 ? 0 : ((day + dayOffset) < 0 ? 6 : (day + dayOffset))
   }) || []
   const dayOfMonth = repeatConfig.dayOfMonth
      ? (repeatConfig.dayOfMonth + dayOffset) > 31
         ? 1
         : ((repeatConfig.dayOfMonth + dayOffset) < 1 ? 31 : (repeatConfig.dayOfMonth + dayOffset))
      : null

   switch (repeatConfig.repeatType) {
      case 'not_repeat':
         const date = ParseDateWithTz(`${repeatConfig.date} ${repeatConfig.time}`, repeatConfig.tz)
         const dateStr = FormatDateTime(date, tz)
         if (dateStr != null && dateStr.split(' ').length === 2) {
            FindBlockById(blocks, 'repeatConfig.date')
               .element.initial_date = dateStr.split(' ')[0]
            FindBlockById(blocks, 'repeatConfig.time')
               .element.initial_time = dateStr.split(' ')[1]
         }
         break
      case 'hourly':
         if (repeatConfig.minsOfHour != null) {
            FindBlockById(blocks, 'repeatConfig.minsOfHour')
               .element.initial_value = repeatConfig.minsOfHour.toString()
         }
         break
      case 'daily':
         if (time != null) {
            FindBlockById(blocks, 'repeatConfig.time')
               .element.initial_time = time
         }
         break
      case 'weekly':
         const dayOfWeekOptions = FindBlockById(blocks, 'repeatConfig.dayOfWeek')
            .element.options
            .filter(option => dayOfWeek?.includes(parseInt(option.value)))
         if (dayOfWeekOptions.length > 0) {
            FindBlockById(blocks, 'repeatConfig.dayOfWeek')
               .element.initial_options = dayOfWeekOptions
         }
         if (time != null) {
            FindBlockById(blocks, 'repeatConfig.time')
               .element.initial_time = time
         }
         break
      case 'monthly':
         if (dayOfMonth != null) {
            FindBlockById(blocks, 'repeatConfig.dayOfMonth')
               .element.initial_value = dayOfMonth.toString()
         }
         if (time != null) {
            FindBlockById(blocks, 'repeatConfig.time')
               .element.initial_time = time
         }
         break
      case 'cron_expression':
         if (repeatConfig.cronExpression != null) {
            FindBlockById(blocks, 'repeatConfig.cronExpression')
               .element.initial_value = repeatConfig.cronExpression
         }
         break
   }
}

export async function InitReportBlocks(report, view, blocks, options, tz) {
   const isInit = options?.isInit
   const isNew = options?.isNew
   const reportTypeBlock = FindBlockById(blocks, 'reportType')
   const reportType = report.reportType || 'bugzilla'
   if (isInit) {
      const reportTypeOption = reportTypeBlock.element.options
         .find(option => option.value === reportType)
      if (reportTypeOption != null) {
         reportTypeBlock.element.initial_option = reportTypeOption
      }

      if (report.title?.length > 0) {
         FindBlockById(blocks, 'title').element.initial_value = report.title
      }
      if (report.conversations?.length > 0) {
         FindBlockById(blocks, 'conversations').element.initial_conversations =
            report.conversations
      }
      InitRecurrenceSettingValue(report, blocks, options, tz)
   }
   const reportSpecConfig = report.reportSpecConfig

   let perforceSpecConfig
   if (report.reportType === 'perforce_checkin') {
      perforceSpecConfig = 'perforceCheckIn'
   } else if (report.reportType === 'perforce_review_check') {
      perforceSpecConfig = 'perforceReviewCheck'
   }
   switch (reportType) {
      case 'bugzilla':
         if (isInit && reportSpecConfig?.bugzillaLink?.length > 0) {
            FindBlockById(blocks, 'reportSpecConfig.bugzillaLink')
               .element.initial_value = reportSpecConfig.bugzillaLink
         }
         break
      case 'text':
         if (isInit && reportSpecConfig?.text?.length > 0) {
            FindBlockById(blocks, 'reportSpecConfig.text')
               .element.initial_value = reportSpecConfig.text
         }
         break
      case 'bugzilla_by_assignee':
         if (isInit && reportSpecConfig?.bugzillaAssignee?.length > 0) {
            FindBlockById(blocks, 'reportSpecConfig.bugzillaAssignee')
               .element.initial_conversations = reportSpecConfig.bugzillaAssignee
         }
         break
      case 'perforce_checkin':
      case 'perforce_review_check':
         if (isInit && reportSpecConfig[perforceSpecConfig]?.branches?.length > 0) {
            FindBlockById(blocks, `reportSpecConfig.${perforceSpecConfig}.branches`)
               .element.initial_options = reportSpecConfig[perforceSpecConfig].branches
                  .map(branch => ({
                     text: {
                        type: 'plain_text',
                        text: branch
                     },
                     value: branch
                  }))
         }
         if (perforceSpecConfig === 'perforceCheckIn') {
            const isNeedCheckinApproved = reportSpecConfig[perforceSpecConfig]
               ?.needCheckinApproved || 'Yes'
            const needCheckinApprovedBlock = FindBlockById(blocks,
               `reportSpecConfig.${perforceSpecConfig}.needCheckinApproved`)
            const needCheckinApprovedOption = needCheckinApprovedBlock.element.options
               .find(option => option.value === isNeedCheckinApproved)
            if (needCheckinApprovedOption != null) {
               needCheckinApprovedBlock.element.initial_option = needCheckinApprovedOption
            } else {
               needCheckinApprovedBlock.element.initial_option = isNeedCheckinApproved
            }
         }
         if (isInit) {
            const teams = await TeamGroup.find({
               code: { $in: reportSpecConfig[perforceSpecConfig].teams }
            })
            if (teams.length > 0) {
               FindBlockById(blocks, `reportSpecConfig.${perforceSpecConfig}.teams`)
                  .element.initial_options = teams
                     .map(team => ({
                        text: {
                           type: 'plain_text',
                           text: team.name
                        },
                        value: team.code
                     }))
            } else if (!isNew) {
               FindBlockById(blocks, `reportSpecConfig.${perforceSpecConfig}.teams`)
                  .element.initial_options = undefined
            }
         }
         const membersFilters = reportSpecConfig[perforceSpecConfig]?.membersFilters || []
         if (options?.addMembersFilter) {
            membersFilters.push({
               condition: 'include',
               type: 'single',
               members: []
            })
         }
         if (membersFilters.length > 0) {
            const membersFilterTemplate = LoadBlocks('report_type/perforce-member-template')
            const membersFilterBlocksList = membersFilters.map((membersFilter, index) => {
               const membersFilterBlocks = cloneDeep(membersFilterTemplate)
               // add index for every member filter remove block
               membersFilterBlocks[0].block_id = `block_remove_member_filter_${index}`
               membersFilterBlocks[1].block_id = `reportSpecConfig.${perforceSpecConfig}.membersFilters[${index}]`
               membersFilterBlocks[2].block_id = `reportSpecConfig.${perforceSpecConfig}.membersFilters[${index}].members`
               // update index of member filter remove block
               membersFilterBlocks[0].accessory.value = `${index}`
               membersFilterBlocks[2].hint.text = MEMBERS_CONDITION_HINT[membersFilter.condition] +
                  MEMBERS_FILTER_HINT[membersFilter.type]
               if (isInit) {
                  const conditionOption = membersFilterBlocks[1].elements[0].options
                     .find(option => option.value === membersFilter.condition)
                  membersFilterBlocks[1].elements[0].initial_option = conditionOption
                  const typeOption = membersFilterBlocks[1].elements[1].options
                     .find(option => option.value === membersFilter.type)
                  membersFilterBlocks[1].elements[1].initial_option = typeOption
                  membersFilterBlocks[2].element.initial_users = membersFilter.members
               }
               return membersFilterBlocks
            })
            if (options?.removeMembersFilter != null) {
               logger.info(`remove member filter ${options.removeMembersFilter.index}`)
               membersFilterBlocksList.splice(options.removeMembersFilter.index, 1)
            }
            membersFilterBlocksList.forEach((membersFilterBlocks, index) => {
               membersFilterBlocks[0].text.text = `*Members filter ${index + 1}*`
            })
            const membersFilterBlocks = membersFilterBlocksList.flat()
            const index = blocks.findIndex(
               block => block.block_id === 'block_add_member_filter')
            if (index >= 0) {
               blocks.splice(index, 0, ...membersFilterBlocks)
            }
         }
         break
      // case 'svs':
      //    FindBlockById(blocks, 'reportSpecConfig.bugzillaLink')
      //       .element.initial_value = reportSpecConfig.bugzillaLink
      //    break
      case 'nanny_reminder':
         if (isInit) {
            if (reportSpecConfig?.nannyAssignee?.length > 0) {
               FindBlockById(blocks, 'reportSpecConfig.nannyAssignee')
                  .element.initial_conversations = reportSpecConfig.nannyAssignee
            }
            if (reportSpecConfig?.text?.length > 0) {
               FindBlockById(blocks, 'reportSpecConfig.text')
                  .element.initial_value = reportSpecConfig.text
            }
         }
         const previewNannyRosterBlock = FindBlockById(blocks, 'previewNannyRoster')
         if (reportSpecConfig?.nannyAssignee?.length > 0 && !isInit) {
            previewNannyRosterBlock.elements[0].text = await GenerateNannyRoster(report, false, tz)
         } else {
            previewNannyRosterBlock.elements[0].text = 'Preview nanny duty roster'
         }
         break
      default:
         throw new Error(`report type ${report.reportType} is not supported`)
   }

   const advancedBlocks = LoadBlocks('modal/report-advanced').filter(block => {
      return block.block_id != null && block.block_id !== 'advancedOptions'
   })
   const advancedOptionBlock = FindBlockById(blocks, 'advancedOptions')
   const oldAdvancedOptionBlock = FindBlockById(view?.blocks || [], 'advancedOptions')
   const isAdvancedOptionInitOpen =
      report.mentionUsers?.length > 0 || report.mentionGroups?.length > 0 ||
      (report.skipEmptyReport === 'Yes' && (report.reportType === 'bugzilla' ||
      report.reportType === 'bugzilla_by_assignee' || report.reportType === 'perforce_checkin'))

   const displayAdvancedOptions = () => {
      if (report.mentionUsers?.length > 0) {
         FindBlockById(blocks, 'mentionUsers').element.initial_users = report.mentionUsers
      }
      if (report.mentionGroups?.length > 0) {
         FindBlockById(blocks, 'mentionGroups').element.initial_options = report.mentionGroups
      }
      if (report.reportType === 'bugzilla' || report.reportType === 'bugzilla_by_assignee' ||
         report.reportType === 'perforce_checkin') {
         const isSkipEmptyReport = report.skipEmptyReport || 'No'
         const skipEmptyReportBlock = FindBlockById(blocks, 'skipEmptyReport')
         const skipEmptyReportOption = skipEmptyReportBlock.element.options
            .find(option => option.value === isSkipEmptyReport)
         if (skipEmptyReportOption != null) {
            skipEmptyReportBlock.element.initial_option = skipEmptyReportOption
         } else {
            skipEmptyReportBlock.element.initial_option = isSkipEmptyReport
         }
      } else {
         const blockIndex = blocks.findIndex(block => block.block_id === 'skipEmptyReport')
         blocks.splice(blockIndex, 1)
      }
      advancedOptionBlock.accessory.text.text = 'delete'
      advancedOptionBlock.accessory.value = 'delete'
      advancedOptionBlock.accessory.style = 'danger'
   }
   const hideAdvancedOptions = () => {
      advancedBlocks.map(block => block.block_id).forEach(blockId => {
         const blockIndex = blocks.findIndex(block => block.block_id === blockId)
         blocks.splice(blockIndex, 1)
      })
      advancedOptionBlock.accessory.text.text = 'open'
      advancedOptionBlock.accessory.value = 'open'
      advancedOptionBlock.accessory.style = 'primary'
   }
   if ((isInit && isAdvancedOptionInitOpen) ||
      options?.advancedOption === 'open') {
      displayAdvancedOptions()
   } else if ((isInit && !isAdvancedOptionInitOpen) ||
      options?.advancedOption === 'delete') {
      hideAdvancedOptions()
   } else if (oldAdvancedOptionBlock?.accessory?.value === 'delete') {
      displayAdvancedOptions()
   } else if (oldAdvancedOptionBlock?.accessory?.value === 'open') {
      hideAdvancedOptions()
   }
   // initialize selected private channel ids in admin config
   if (isInit && report.adminConfig?.channels?.length > 0) {
      const adminInputChannelIDs = FindBlockById(blocks, 'adminConfig.channels')
      if (typeof adminInputChannelIDs !== 'undefined' && adminInputChannelIDs != null) {
         adminInputChannelIDs.element.initial_options = report.adminConfig.channels
            .map(channel => ({
               text: {
                  type: 'plain_text',
                  text: channel
               },
               value: channel
            }))
      }
   }
}

export function DisplayTimeSetting(report, tz) {
   const repeatConfig = report.repeatConfig
   const { time, dayOffset } = ConvertTimeWithTz(repeatConfig.time, repeatConfig.tz, tz)
   const dayOfWeekStr = repeatConfig.dayOfWeek?.map(day => {
      return (day + dayOffset) > 6 ? 0 : ((day + dayOffset) < 0 ? 6 : (day + dayOffset))
   })?.map(day => WEEK[day])?.join(', ') || 'Empty'
   const dayOfMonth = (repeatConfig.dayOfMonth + dayOffset) > 31
      ? 1
      : ((repeatConfig.dayOfMonth + dayOffset) < 1 ? 31 : (repeatConfig.dayOfMonth + dayOffset))

   switch (repeatConfig.repeatType) {
      case 'not_repeat': {
         const date = ParseDateWithTz(`${repeatConfig.date} ${repeatConfig.time}`, repeatConfig.tz)
         return `Not Repeat - ${FormatDateTime(date, tz)}`
      }
      case 'hourly': return `Hourly - ${repeatConfig.minsOfHour} mins of every hour`
      case 'daily': return `Daily - ${time} of every day`
      case 'weekly': return `Weekly - ${dayOfWeekStr} - ${time}`
      case 'monthly': return `Monthly - ${dayOfMonth}th of every month - ${time}`
      case 'cron_expression': return `Cron Expression - ${repeatConfig.cronExpression}`
      default: return 'Unknown'
   }
}

export async function UpdateFlattenMembers(report) {
   let reportSpecConfig
   if (report.reportType === 'perforce_checkin') {
      reportSpecConfig = report.reportSpecConfig.perforceCheckIn
   } else if (report.reportType === 'perforce_review_check') {
      reportSpecConfig = report.reportSpecConfig.perforceReviewCheck
   } else {
      return
   }
   logger.debug(JSON.stringify(reportSpecConfig.membersFilters))
   const teams = await TeamGroup.find({
      code: { $in: reportSpecConfig.teams }
   })
   const selectedTeamsMembers = teams.map(team => team.members).flat()
   const currentReport = await ReportConfiguration.findById(report._id)
   return FlattenMembers(reportSpecConfig.membersFilters, selectedTeamsMembers)
      .then(async allMembers => {
         switch (report.reportType) {
            case 'perforce_checkin':
               currentReport.reportSpecConfig.perforceCheckIn.flattenMembers = allMembers
               break
            case 'perforce_review_check':
               currentReport.reportSpecConfig.perforceReviewCheck.flattenMembers = allMembers
               break
            default:
               throw new Error(`report type ${report.reportType} is not supported`)
         }
         await currentReport.save()
         logger.debug(`new report config: ${JSON.stringify(await ReportConfiguration.findById(report._id))}`)
      })
}

const RecycleAssignees = function(assignees) {
   const result = []
   for (let i = 1; i < assignees.length; i++) {
      result.push(assignees[i])
   }
   result.push(assignees[0])
   return result
}

export async function GenerateNannyRoster(report, isRecycle, tz) {
   if (report.reportType !== 'nanny_reminder') {
      return ''
   }
   let assigneeIDs = report.reportSpecConfig.nannyAssignee
   if (!assigneeIDs || assigneeIDs.length <= 1) {
      return 'The number of nanny assignee should be greater than 1.'
   }
   if (isRecycle) {
      assigneeIDs = RecycleAssignees(assigneeIDs)
      report.reportSpecConfig.nannyAssignee = assigneeIDs
   }
   const assignees = await GetUsersName(assigneeIDs)
   const result = []
   const repeatConfig = report.repeatConfig
   if (repeatConfig.repeatType === 'not_repeat') {
      if (repeatConfig.date == null) {
         return 'Please select a date for your notification'
      } else if (repeatConfig.time == null) {
         return 'Please select a time for your notification'
      }
      const date = ParseDateWithTz(`${repeatConfig.date} ${repeatConfig.time}`, tz)
      result.push({ nanny: assignees[0], start: FormatDateTime(date, tz), end: '??' })
   } else if (repeatConfig.repeatType === 'hourly') {
      const startDate = new Date()
      startDate.setMinutes(0)
      const endDate = new Date()
      endDate.setMinutes(59)
      for (const assignee of assignees) {
         result.push({
            nanny: assignee,
            start: FormatDateTime(startDate, tz),
            end: FormatDateTime(endDate, tz)
         })
         startDate.setHours(startDate.getHours() + 1)
         endDate.setHours(endDate.getHours() + 1)
      }
   } else if (repeatConfig.repeatType === 'daily') {
      const startDate = new Date()
      for (const assignee of assignees) {
         result.push({
            nanny: assignee,
            start: FormatDateWithTz(startDate, tz),
            end: ''
         })
         startDate.setDate(startDate.getDate() + 1)
      }
   } else if (repeatConfig.repeatType === 'weekly') {
      const now = new Date()
      const startDate = GetDayOfThisWeek(now, 1)
      const endDate = GetDayOfThisWeek(now, 7)
      for (const assignee of assignees) {
         result.push({
            nanny: assignee,
            start: FormatDateWithTz(startDate, tz),
            end: FormatDateWithTz(endDate, tz)
         })
         startDate.setDate(startDate.getDate() + 7)
         endDate.setDate(endDate.getDate() + 7)
      }
   } else if (repeatConfig.repeatType === 'monthly') {
      const now = new Date()
      const startDate = new Date(now.getFullYear(), now.getMonth(), 1)
      let endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      for (const assignee of assignees) {
         result.push({
            nanny: assignee,
            start: FormatDateWithTz(startDate, tz),
            end: FormatDateWithTz(endDate, tz)
         })
         startDate.setMonth(startDate.getMonth() + 1)
         endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0)
      }
   } else if (repeatConfig.repeatType === 'cron_expression') {
      if (repeatConfig.cronExpression == null) {
         return 'Please enter the crontab expression.'
      }
      try {
         cronParser.parseExpression(repeatConfig.cronExpression)
      } catch (e) {
         return 'Crontab expression error'
      }
      const interval = cronParser.parseExpression(repeatConfig.cronExpression)
      let startDate = new Date(interval.prev())
      let endDate = interval.hasNext() ? new Date(interval.next()) : ''
      let i = 0
      while (interval.hasNext()) {
         result.push({
            nanny: assignees[i],
            start: FormatDateTime(startDate, tz),
            end: FormatDateTime(endDate, tz)
         })
         i += 1
         if (i >= assignees.length) break
         const next = interval.next()
         startDate = new Date(endDate)
         endDate = new Date(next)
      }
      if (result.length === 0) {
         result.push({ nanny: assignees[0], start: FormatDateTime(startDate, tz), end: '??' })
      }
   }
   if (result.length === 0) {
      return 'Please select recurrence type first.'
   }
   let nannyRoster = ''
   for (const data of result) {
      if (data.end === '') {
         nannyRoster += `${data.nanny} serve day: ${data.start}\n`
      } else {
         nannyRoster += `${data.nanny} serve from ${data.start} to ${data.end}\n`
      }
   }
   return nannyRoster
}
