import logger from './logger.js'
import fs from 'fs'
import cloneDeep from 'lodash/cloneDeep.js'
import set from 'lodash/set.js'
import assert from 'assert'
import path from 'path'
import { PerforceInfo } from '../src/model/perforce-info.js'
import {
   UpdateUserInfo, GetVMwareIdBySlackId
} from '../src/model/user-info.js'

let slackClient = null
const userTzCache = {}
const blocksCache = {}
const slashCmdUsagesCache = {}
let vSANUserIdCache = {}

export function InitSlackClient(client) {
   slackClient = client
}

export const GetUserTz = async (userId) => {
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

export const UpdateUserTzCache = (userId, tz) => {
   assert(userId != null, 'user Id is null when updating user tz cache.')

   if (userTzCache[userId] != null) {
      assert(tz != null, 'timezone is null when updating user tz cache')
      logger.info(`user ${userId} timezone is updated from ${userTzCache[userId]} to ${tz}`)
      userTzCache[userId] = tz
      logger.info(`${userId} update timezone to ${tz} caused by user_change event`)
   }
}

export async function VerifyBranchInProject(project, branches) {
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

export async function VerifyBotInChannel(channel) {
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

export function GetConversationsName(conversationIds) {
   if (conversationIds == null) {
      return ''
   }
   return conversationIds.map(channel => {
      // if conversation is a channel
      if (channel.startsWith('C')) {
         return `<#${channel}>`
      } else if (channel.startsWith('U') || channel.startsWith('W')) {
         // if conversation is a user
         // some users can start with 'w`, please refer to
         // https://api.slack.com/changelog/2016-08-11-user-id-format-changes
         return `<@${channel}>`
      } else if (channel.startsWith('S')) {
         // if conversation is a user group
         return `<!subteam^${channel}>`
      }
      return `<#${channel}>`
   }).join(', ')
}

export async function GetUsersName(users) {
   return await Promise.all(users.map(slackId => {
      if (slackId.startsWith('U') || slackId.startsWith('W')) {
         return GetVMwareIdBySlackId(slackId)
      }
      return slackId
   }))
}

// get all private channel list which vSANSlackbot in it
export async function GetConversationsList(cursor, types) {
   assert(slackClient != null, 'slackClient is not initialized in slack helper.')
   try {
      const response = await slackClient.conversations.list({
         cursor,
         types,
         limit: 200
      })
      assert(response?.ok === true, 'Failed to get slack conversations list.')
      logger.info('got conversations list ' + response.ok)
      const nextCursor = response.response_metadata.next_cursor
      logger.info(`nextCursor: ${nextCursor}`)
      let nextConversationList = []
      if (nextCursor != null && nextCursor !== '') {
         // pause 10s for the rate limits of Slack web Api
         await new Promise(resolve => setTimeout(resolve, 10000))
         nextConversationList = await GetConversationsList(nextCursor)
      }
      return response.channels.map(channel => {
         return {
            slackId: channel.id,
            channelName: channel.name || ''
         }
      }).concat(nextConversationList)
   } catch (e) {
      logger.error(`Can not get slack conversations list due to ${JSON.stringify(e)}`)
      return []
   }
}

// get and store all slack user info list in VMware - do not user this function for now
export async function GetUserList(cursor) {
   assert(slackClient != null, 'slackClient is not initialized in slack helper.')
   try {
      logger.info('Start to get user list from slack client...')
      const response = await slackClient.users.list({
         cursor,
         deleted: false,
         team_id: 'T024JFTN4',
         limit: 1000
      })
      assert(response?.ok === true, 'Failed to get slack user list.')
      logger.info('got user list' + response.ok)
      let nextUserList = []
      const nextCursor = response.response_metadata.next_cursor
      logger.info(response.members.length)
      logger.info(`nextCursor: ${nextCursor}`)
      if (nextCursor != null && nextCursor !== '') {
         // pause 10s for the rate limits of Slack web Api
         await new Promise(resolve => setTimeout(resolve, 10000))
         nextUserList = await GetUserList(nextCursor)
      }
      return response.members.map(member => {
         return {
            slackId: member.id,
            userName: member.name || '',
            fullName: member.real_name || member.profile?.real_name || ''
         }
      }).concat(nextUserList)
   } catch (e) {
      logger.error(`Can not get slack user info due to ${JSON.stringify(e)}`)
      return []
   }
}

// get the user information by VMware ID and update the User-Info db,
// including the Slack ID, user VMware ID and full name.
export async function LookUpUserByName(userName) {
   assert(slackClient != null, 'slackClient is not initialized in slack helper.')
   try {
      if (userName == null || userName === '') {
         logger.debug(`This user VMware ID is not given.`)
         return {}
      }
      logger.info(`Start to get user ${userName} profile through the user VMware ID`)
      const response = await slackClient.users.lookupByEmail({ email: `${userName}@vmware.com` })
      logger.info(JSON.stringify(response))
      const userInfo = {
         slackId: response.user.id,
         userName: response.user.name,
         fullName: response.user.real_name || ''
      }
      // check if the user exists in the UserInfo collection and update
      UpdateUserInfo([userInfo])
      logger.info(`Insert the user ${userName} info into the db successfully.`)
      return userInfo
   } catch (e) {
      if (e.data?.ok !== true && e.data?.error === 'users_not_found') {
         logger.debug(`Invalid user VMware ID ${userName}. Please check the ID is correct.`)
      } else {
         logger.error(`Can not get slack user info by name due to ${JSON.stringify(e)}`)
      }
      return {}
   }
}
export function LoadBlocks(name) {
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

export function TransformInputValuesToObj(values) {
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

export function FindBlockById(blocks, blockId) {
   return blocks.find(block => block.block_id === blockId)
}

export async function TryAndHandleError({ ack, body, client }, func, errorHandler) {
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

export function LoadSlashCommandUsage(name) {
   if (name.endsWith('null') || name.endsWith('undefined')) {
      return ''
   }
   if (slashCmdUsagesCache[name]) {
      return slashCmdUsagesCache[name]
   } else {
      const usageFilePath = path.join(path.resolve(), '..') +
         `/persist/slash_cmd_usage/${name}.txt`
      const usage = fs.readFileSync(usageFilePath).toString()
      slashCmdUsagesCache[name] = usage
      return usage
   }
}
