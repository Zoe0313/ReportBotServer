import logger from './logger.js'
import fs from 'fs'
import cloneDeep from 'lodash/cloneDeep.js'

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
      const blocks = JSON.parse(fs.readFileSync(`src/blocks/${name}.json`))['blocks']
      blocksCache[name] = blocks
      return cloneDeep(blocks)
   }
}

export function initReportTypeBlocks(report, blocks) {
   if (report == null || report.reportType == null) {
      const reportTypeBlock = findBlockById(blocks, 'block_report_type')
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
               findBlockById(blocks, 'block_report_link').element.initial_value = reportSpecConfig.bugzillaLink
            }
            break
         case 'perforce':
            findBlockById(blocks, 'block_report_link').element.initial_value = reportSpecConfig.bugzillaLink
            break
         case 'svs':
            findBlockById(blocks, 'block_report_link').element.initial_value = reportSpecConfig.bugzillaLink
            break
         case 'fastsvs':
            findBlockById(blocks, 'block_report_link').element.initial_value = reportSpecConfig.bugzillaLink
            break
         case 'text':
            findBlockById(blocks, 'block_report_link').element.initial_value = reportSpecConfig.bugzillaLink
            break
         case 'customized':
            findBlockById(blocks, 'block_report_link').element.initial_value = reportSpecConfig.bugzillaLink
            break
         default:
            throw new Error(`report type ${report.reportType} is not supported`)
      }
   }
}


export function findBlockById(blocks, blockId) {
   return blocks.find(block => block.block_id === blockId)
}