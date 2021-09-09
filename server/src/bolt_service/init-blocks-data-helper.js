import logger from '../../common/logger.js'
import {
   loadBlocks, findBlockById
} from '../../common/slack-helper.js'
import {
   convertTimeWithTz, formatDateTime, formatDate, parseDateWithTz
} from '../../common/utils.js'
import cloneDeep from 'lodash/cloneDeep.js'

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

function initRecurrenceSettingValue(report, blocks, tz) {
   if (report.repeatConfig?.startDate != null) {
      findBlockById(blocks, 'repeatConfig.startDate').element.initial_date =
         formatDate(report.repeatConfig.startDate)
   }
   if (report.repeatConfig?.endDate != null) {
      findBlockById(blocks, 'repeatConfig.endDate').element.initial_date =
         formatDate(report.repeatConfig.endDate)
   }
   if (report.repeatConfig?.repeatType == null) {
      return
   }
   const repeatTypeBlock = findBlockById(blocks, 'repeatConfig.repeatType')
   const repeatTypeOption = repeatTypeBlock.element.options
      .find(option => option.value === report.repeatConfig.repeatType)
   if (repeatTypeOption != null) {
      repeatTypeBlock.element.initial_option = repeatTypeOption
   }
   const repeatConfig = report.repeatConfig
   if (repeatConfig == null) {
      return
   }
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

export function initReportBlocks(report, blocks, options, tz) {
   const isInit = options?.isInit
   const reportTypeBlock = findBlockById(blocks, 'reportType')
   const reportType = report.reportType || 'bugzilla'
   if (isInit) {
      const reportTypeOption = reportTypeBlock.element.options
         .find(option => option.value === reportType)
      if (reportTypeOption != null) {
         reportTypeBlock.element.initial_option = reportTypeOption
      }

      if (report.title?.length > 0) {
         findBlockById(blocks, 'title').element.initial_value = report.title
      }
      if (report.conversations?.length > 0) {
         findBlockById(blocks, 'conversations').element.initial_conversations =
            report.conversations
      }
      if (report.mentionUsers?.length > 0) {
         findBlockById(blocks, 'mentionUsers').element.initial_users = report.mentionUsers
      }
      initRecurrenceSettingValue(report, blocks, tz)
   }
   const reportSpecConfig = report.reportSpecConfig
   switch (reportType) {
      case 'bugzilla':
         if (isInit && reportSpecConfig?.bugzillaLink?.length > 0) {
            findBlockById(blocks, 'reportSpecConfig.bugzillaLink')
               .element.initial_value = reportSpecConfig.bugzillaLink
         }
         break
      case 'text':
         if (isInit && reportSpecConfig?.text?.length > 0) {
            findBlockById(blocks, 'reportSpecConfig.text')
               .element.initial_value = reportSpecConfig.text
         }
         break
      case 'perforce_checkin':
         if (isInit && reportSpecConfig?.perforceCheckIn?.branches?.length > 0) {
            findBlockById(blocks, 'reportSpecConfig.perforceCheckIn.branches')
               .element.initial_options = reportSpecConfig.perforceCheckIn.branches
                  .map(branch => ({
                     text: {
                        type: 'plain_text',
                        text: branch
                     },
                     value: branch
                  }))
         }
         const membersFilters = reportSpecConfig?.perforceCheckIn?.membersFilters || []
         if (options?.addMembersFilter) {
            membersFilters.push({
               condition: 'include',
               type: 'single',
               members: []
            })
         }
         if (membersFilters.length > 0) {
            const membersFilterTemplate = loadBlocks('report_type/perforce-member-template')
            const membersFilterBlocksList = membersFilters.map((membersFilter, index) => {
               const membersFilterBlocks = cloneDeep(membersFilterTemplate)
               // add index for every member filter remove block
               membersFilterBlocks[0].block_id = `block_remove_member_filter_${index}`
               membersFilterBlocks[1].block_id = `reportSpecConfig.perforceCheckIn.membersFilters[${index}]`
               membersFilterBlocks[2].block_id = `reportSpecConfig.perforceCheckIn.membersFilters[${index}].members`
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
               block => block.block_id === 'block_perforce_add_member_filter')
            if (index >= 0) {
               blocks.splice(index, 0, ...membersFilterBlocks)
            }
         }
         break
      // case 'svs':
      //    findBlockById(blocks, 'reportSpecConfig.bugzillaLink')
      //       .element.initial_value = reportSpecConfig.bugzillaLink
      //    break
      // case 'fastsvs':
      //    findBlockById(blocks, 'reportSpecConfig.bugzillaLink')
      //       .element.initial_value = reportSpecConfig.bugzillaLink
      //    break
      // case 'customized':
      //    findBlockById(blocks, 'reportSpecConfig.bugzillaLink')
      //       .element.initial_value = reportSpecConfig.bugzillaLink
      //    break
      default:
         throw new Error(`report type ${report.reportType} is not supported`)
   }
}

export function displayTimeSetting(report, tz) {
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
