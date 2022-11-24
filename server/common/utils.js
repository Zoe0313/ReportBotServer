import moment from 'moment-timezone'
import logger from './logger.js'
import mergeWith from 'lodash/mergeWith.js'
import { exec } from 'child_process'

export function FormatDate(date) {
   if (date == null || date === '') {
      return ''
   }
   try {
      return moment(date).format('YYYY-MM-DD')
   } catch (e) {
      logger.warn(e)
      return ''
   }
}

export function FormatDateTime(date, tz) {
   if (date == null || date === '') {
      return ''
   }
   try {
      // 2021-01-01 08:00 Asia/Shanghai => 2021-01-01 00:00 UTC => 2021-01-01 00:00
      return moment(date).tz(tz || 'Asia/Shanghai').format('YYYY-MM-DD HH:mm')
   } catch (e) {
      logger.warn(e)
      return ''
   }
}

export function ParseDateWithTz(dateStr, tz) {
   if (dateStr == null) {
      return null
   }
   try {
      // 2021-01-01 08:00 => 2021-01-01 08:00 Asia/Shanghai
      return moment.tz(dateStr, tz || 'Asia/Shanghai').toDate()
   } catch (e) {
      logger.warn(e)
      return null
   }
}

export function ConvertTimeWithTz(timeStr, oldTz, curTz) {
   if (timeStr == null) {
      return { time: null, dayOffset: 0 }
   }
   try {
      const todayWithConfigTime = FormatDate(new Date()) + ' ' + timeStr
      const dateWithOldTZ = ParseDateWithTz(todayWithConfigTime, oldTz)
      const dateWithNewTZ = FormatDateTime(dateWithOldTZ, curTz)
      const timeWithNewTZ = dateWithNewTZ.split(' ')[1]
      return {
         time: timeWithNewTZ,
         dayOffset: new Date(dateWithNewTZ).getDate() - new Date(todayWithConfigTime).getDate()
      }
   } catch (e) {
      logger.warn(e)
      return { time: timeStr, dayOffset: 0 }
   }
}

export function Merge(object, source) {
   return mergeWith(object, source, (object, source) => {
      if (Array.isArray(object)) {
         return source
      }
   })
}

export function ExecCommand(cmd, timeout) {
   return new Promise((resolve, reject) => {
      exec(cmd, { timeout }, (error, stdout, stderr) => {
         if (error) {
            logger.error(`failed to execute command ${cmd}, error message: ${stderr}`)
            reject(error)
         } else {
            resolve(stdout)
         }
      })
   })
}

export function GetDayOfThisWeek(date, dayOfWeek) {
   const oneDayTime = 24 * 60 * 60 * 1000
   const nowTime = date.getTime()
   const day = date.getDay()
   const dayOfWeekTime = nowTime - (day - dayOfWeek) * oneDayTime
   return new Date(dayOfWeekTime)
}

export function FormatDateWithTz(date, tz) {
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
