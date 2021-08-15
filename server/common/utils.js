import fs from 'fs'
import moment from 'moment-timezone'
import cloneDeep from 'lodash/cloneDeep.js'
import logger from './logger.js'

const blocksCache = {}

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

export function formatDate(date, tz) {
   if (date == null || date === '') {
      return ''
   }
   try {
      return moment(date).tz(tz || 'Asia/Shanghai').format('YYYY-MM-DD')
   } catch (e) {
      logger.warn(e)
      return ''
   }
}

export function formatDateTime(date, tz) {
   if (date == null || date === '')
      return ''
   try {
      return moment(date).tz(tz || 'Asia/Shanghai').format('YYYY-MM-DD HH:mm')
   } catch (e) {
      logger.warn(e)
      return ''
   }
}

export function parseDateWithTz(dateStr, tz) {
   if (dateStr == null)
      return null
   try {
      return moment.tz(dateStr, tz || 'Asia/Shanghai').toDate()
   } catch (e) {
      logger.warn(e)
      return null
   }
}

export function convertTimeWithTz(timeStr, oldTz, curTz) {
   if (timeStr == null)
      return null
   try {
      const todayWithConfigTime = formatDate(new Date()) + ' ' + timeStr
      const dateWithOldTZ = parseDateWithTz(todayWithConfigTime, oldTz)
      const timeWithNewTZ = formatDateTime(dateWithOldTZ, curTz).split(' ')[1]
      return timeWithNewTZ
   } catch (e) {
      logger.warn(e)
      return timeStr
   }
}
