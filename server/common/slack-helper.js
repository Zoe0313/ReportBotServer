import logger from './logger.js'

const userTzCache = {}

export const getUserTz = async (client, userId) => {
   try {
      if (userId == null) {
         throw new Error(`user id is null`)
      }
      if (userTzCache[userId] != null) {
         return userTzCache[userId]
      }
      const userInfo = await client.users.info({ user: userId })
      const tz = userInfo?.user?.tz
      if (tz != null) {
         userTzCache[userId] = tz
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

export const getConversationsName = async (client, conversationIds) => {
   try {
      return conversationIds.map(channel => {
         if (channel.startsWith('C')) {
            return `<#${channel}>`
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