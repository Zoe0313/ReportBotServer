import logger from './logger.js'
import fs from 'fs'
import cloneDeep from 'lodash/cloneDeep.js'
import set from 'lodash/set.js'

const userTzCache = {}
const blocksCache = {}

export const getUserTz = async (client, userId) => {
   try {
      if (userId == null) {
         throw new Error(`user id is null`)
      }
      // if (userTzCache[userId] != null) {
      //    return userTzCache[userId]
      // }
      const userInfo = await client.users.info({ user: userId })
      const tz = userInfo?.user?.tz
      if (tz != null) {
         // userTzCache[userId] = tz
         return tz
      } else {
         throw new Error(`can not get tz of user ${userId}`)
      }
   } catch (e) {
      logger.error(e)
      throw e
   }
}

export const updateUserTzCache = (userId, tz) => {
   if (userId != null) {
      userTzCache[userId] = tz
   }
}

export const getConversationsName = async (conversationIds) => {
   if (conversationIds == null) {
      return ''
   }
   try {
      return conversationIds.map(channel => {
         // if conversation is a channel
         if (channel.startsWith('C')) {
            return `<#${channel}>`
            // if conversation is a user
         } else if (channel.startsWith('U')) {
            return `<@${channel}>`
         } else {
            return `<#${channel}>`
         }
      }).join(', ')
   } catch (e) {
      return conversationIds
   }
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
         case 'perforce':
            findBlockById(blocks, 'reportSpecConfig.bugzillaLink')
               .element.initial_value = reportSpecConfig.bugzillaLink
            break
         case 'svs':
            findBlockById(blocks, 'reportSpecConfig.bugzillaLink')
               .element.initial_value = reportSpecConfig.bugzillaLink
            break
         case 'fastsvs':
            findBlockById(blocks, 'reportSpecConfig.bugzillaLink')
               .element.initial_value = reportSpecConfig.bugzillaLink
            break
         case 'text':
            findBlockById(blocks, 'reportSpecConfig.bugzillaLink')
               .element.initial_value = reportSpecConfig.bugzillaLink
            break
         case 'customized':
            findBlockById(blocks, 'reportSpecConfig.bugzillaLink')
               .element.initial_value = reportSpecConfig.bugzillaLink
            break
         default:
            throw new Error(`report type ${report.reportType} is not supported`)
      }
   }
}

export function findBlockById(blocks, blockId) {
   return blocks.find(block => block.block_id === blockId)
}
