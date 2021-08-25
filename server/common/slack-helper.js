import logger from './logger.js'
import fs from 'fs'
import cloneDeep from 'lodash/cloneDeep.js'
import set from 'lodash/set.js'
import assert from 'assert'

let slackClient = null
const userTzCache = {}
const blocksCache = {}

export function initSlackClient(client) {
   slackClient = client
}

export const getUserTz = async (userId) => {
   assert(slackClient != null, 'slackClient is null in slack helper')
   assert(userId != null, 'user id is null')

   if (userTzCache[userId] != null) {
      return userTzCache[userId]
   }

   const userInfo = await slackClient.users.info({ user: userId })
   const tz = userInfo?.user?.tz

   if (tz != null) {
      userTzCache[userId] = tz
      return tz
   } else {
      throw new Error(`can not get tz of user ${userId}`)
   }
}

export const updateUserTzCache = (userId, tz) => {
   assert(userId != null, 'user Id is null when updating user tz cache.')
   assert(tz != null, 'timezone is null when updating user tz cache')

   if (userTzCache[userId] != null) {
      userTzCache[userId] = tz
   }
}

export async function verifyBotInChannel(channel) {
   assert(slackClient != null, 'slackClient is not initialized in slack helper.')

   try {
      const response = await slackClient.conversations.info({ channel })
      return response?.ok || false
   } catch (e) {
      logger.info(`can not check the private channel info due to ${JSON.stringify(e)}`)

      // if channel is private channel, will throw channel_not_found error directly
      if (e.data?.error === 'channel_not_found') {
         return false
      } else {
         throw e
      }
   }
}

export function getConversationsName(conversationIds) {
   if (conversationIds == null) {
      return ''
   }
   return conversationIds.map(channel => {
      // if conversation is a channel
      if (channel.startsWith('C')) {
         return `<#${channel}>`
      } else if (channel.startsWith('U') || channel.startsWith('W')) { // if conversation is a user
         // some users can start with 'w`, please refer to
         // https://api.slack.com/changelog/2016-08-11-user-id-format-changes
         return `<@${channel}>`
      }
      return `<#${channel}>`
   }).join(', ')
}

export function loadBlocks(name) {
   if (name.endsWith('null') || name.endsWith('undefined')) {
      return []
   }

   if (blocksCache[name]) {
      return cloneDeep(blocksCache[name])
   } else {
      const blocks = JSON.parse(fs.readFileSync(`src/blocks/${name}.json`)).blocks
      blocksCache[name] = blocks
      return cloneDeep(blocks)
   }
}

export function transformInputValuesToObj(values) {
   const inputObj = {}

   Object.keys(values).forEach(blockKey => {
      const payload = Object.values(values[blockKey])[0]
      let inputValue = null

      if (payload.selected_option != null) {
         inputValue = payload.selected_option.value
      } else if (payload.selected_options != null) {
         inputValue = payload.selected_options.map(option => option.value)
      } else if (payload.selected_conversations != null) {
         inputValue = payload.selected_conversations
      } else if (payload.selected_users != null) {
         inputValue = payload.selected_users
      } else if (payload.selected_conversation != null) {
         inputValue = payload.selected_conversation
      } else if (payload.selected_user != null) {
         inputValue = payload.selected_user
      } else if (payload.selected_date != null) {
         inputValue = payload.selected_date
      } else if (payload.selected_time != null) {
         inputValue = payload.selected_time
      } else {
         inputValue = payload.value
      }
      set(inputObj, blockKey, inputValue)
   })
   return inputObj
}

export function initReportTypeBlocks(report, blocks) {
   if (report == null || report.reportType == null) {
      const reportTypeBlock = findBlockById(blocks, 'reportType')
      const reportTypeOption = reportTypeBlock.element.options
         .find(option => option.value === 'bugzilla')
      if (reportTypeOption != null) {
         reportTypeBlock.element.initial_option = reportTypeOption
      } else {
         throw new Error('bugzilla option can not be found in the block.')
      }
   } else {
      const reportSpecConfig = report.reportSpecConfig

      switch (report.reportType) {
         case 'bugzilla':
            if (reportSpecConfig.bugzillaLink != null && reportSpecConfig.bugzillaLink.length > 0) {
               findBlockById(blocks, 'reportSpecConfig.bugzillaLink')
                  .element.initial_value = reportSpecConfig.bugzillaLink
            }
            break
         // case 'perforce':
         //    findBlockById(blocks, 'reportSpecConfig.bugzillaLink')
         //       .element.initial_value = reportSpecConfig.bugzillaLink
         //    break
         // case 'svs':
         //    findBlockById(blocks, 'reportSpecConfig.bugzillaLink')
         //       .element.initial_value = reportSpecConfig.bugzillaLink
         //    break
         // case 'fastsvs':
         //    findBlockById(blocks, 'reportSpecConfig.bugzillaLink')
         //       .element.initial_value = reportSpecConfig.bugzillaLink
         //    break
         // case 'text':
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
}

export function findBlockById(blocks, blockId) {
   return blocks.find(block => block.block_id === blockId)
}
