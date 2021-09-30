import logger from './logger.js'
import fs from 'fs'
import cloneDeep from 'lodash/cloneDeep.js'
import set from 'lodash/set.js'
import assert from 'assert'
import { PerforceInfo } from '../src/model/perforce-info.js'

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

   if (userTzCache[userId] != null) {
      assert(tz != null, 'timezone is null when updating user tz cache')
      logger.info(`user ${userId} timezone is updated from ${userTzCache[userId]} to ${tz}`)
      userTzCache[userId] = tz
      logger.info(`${userId} update timezone to ${tz} caused by user_change event`)
   }
}

export async function verifyBranchInProject(project, branches) {
   if (project == null || project === '') {
      logger.error(`project is null when verifying the branches info`)
      return false
   }
   const branchesInfo = await PerforceInfo.findOne({ project }).branches
   let flag = true
   branches.forEach(branch => {
      if (!branchesInfo.includes(branch)) {
         flag = false
      }
   })
   return flag
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

export async function getUsersName(users) {
   return await Promise.all(users.map(user => {
      return slackClient.users.info({ user }).then(res => {
         return res.user.name
      })
   }))
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
   const getInputValueOfPayload = (payload) => {
      let inputValue = null
      if (payload.selected_option != null) {
         inputValue = payload.selected_option.value
      } else if (payload.selected_options != null) {
         inputValue = payload.selected_options
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
      return inputValue
   }
   Object.keys(values).forEach(blockKey => {
      const blockValue = values[blockKey]
      if (Object.keys(blockValue).length === 1) {
         const payload = Object.values(blockValue)[0]
         const inputValue = getInputValueOfPayload(payload)
         set(inputObj, blockKey, inputValue)
      } else {
         Object.keys(blockValue).forEach(actionKey => {
            const payload = blockValue[actionKey]
            const inputValue = getInputValueOfPayload(payload)
            set(inputObj, `${blockKey}.${actionKey}`, inputValue)
         })
      }
   })
   return inputObj
}

export function findBlockById(blocks, blockId) {
   return blocks.find(block => block.block_id === blockId)
}

export async function tryAndHandleError({ ack, body, client }, func, errorHandler) {
   try {
      await func()
   } catch (e) {
      if (typeof errorHandler === 'function') {
         logger.info('trigger custom error handler')
         await errorHandler(e)
         await ack()
      } else if (typeof errorHandler === 'string' || errorHandler instanceof String) {
         logger.info(`trigger default error handler with message ${errorHandler}`)
         await ack()
         await client.chat.postMessage({
            channel: body.user.id,
            thread_ts: body.message?.ts,
            text: (errorHandler || 'Failed to open create report configuration modal.') +
               ' Please contact developers to resolve it.'
         })
         throw e
      }
   }
}
