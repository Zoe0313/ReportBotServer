import fs from 'fs'
import moment from 'moment-timezone'
import _ from 'lodash'
import logger from './logger.js'

const blocksCache = {}

export function loadBlocks(name) {
   if (name.endsWith('null') || name.endsWith('undefined')) {
      return []
   }
   if (blocksCache[name]) {
      return _.cloneDeep(blocksCache[name])
   } else {
      const blocks = JSON.parse(fs.readFileSync(`src/blocks/${name}.json`))['blocks']
      blocksCache[name] = blocks
      return _.cloneDeep(blocks)
   }
}

export function formatDate(date) {
   if (date == null) {
      return ''
   }
   try {
      return moment(date).tz('Asia/Shanghai').format('YYYY-MM-DD')
   } catch (e) {
      logger.error(e)
      return ''
   }
}

export function formatDateTime(date) {
   if (date == null) {
      return ''
   }
   try {
      return moment(date).tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm')
   } catch (e) {
      logger.error(e)
      return ''
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